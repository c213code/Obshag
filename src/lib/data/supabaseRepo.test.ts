import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { RepoError } from "./repo";
import { createSupabaseRepo, mapDbError } from "./supabaseRepo";

type Result = { data: unknown; error: { code?: string; message?: string } | null };

/** A chainable fake of the parts of supabase-js the repo uses. */
function fakeClient(opts: { rpc?: Record<string, Result>; tables?: Record<string, Result>; user?: { id: string; email: string } | null } = {}) {
  const calls: Array<{ fn: string; args: unknown }> = [];
  /** Every builder call, in order: `households.select(*)`, `members.eq(household_id,h1)`, `purchases.order(created_at,{...})`. */
  const queries: string[] = [];
  const chain = (table: string, result: Result) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order"]) {
      q[m] = (...args: unknown[]) => {
        queries.push(`${table}.${m}(${args.map((a) => JSON.stringify(a)).join(",")})`);
        return q;
      };
    }
    q.single = async () => result;
    q.maybeSingle = async () => result;
    q.then = (resolve: (r: Result) => unknown) => resolve(result);
    return q;
  };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: opts.user ? { user: opts.user } : null } }),
      signUp: vi.fn(async (): Promise<{ data: { user: unknown; session: unknown }; error: unknown }> => ({
        data: { user: { id: "u1", email: "a@x.kz", identities: [{}] }, session: { access_token: "t" } },
        error: null,
      })),
      signInWithPassword: vi.fn(async (): Promise<{ data: { user: unknown }; error: unknown }> => ({
        data: { user: { id: "u1", email: "a@x.kz" } },
        error: null,
      })),
      signOut: vi.fn(async () => ({ error: null })),
    },
    rpc: async (fn: string, args: unknown) => {
      calls.push({ fn, args });
      return opts.rpc?.[fn] ?? { data: null, error: null };
    },
    from: (table: string) => chain(table, opts.tables?.[table] ?? { data: [], error: null }),
  };
  return { client: client as unknown as SupabaseClient, calls, queries, auth: client.auth };
}

describe("supabaseRepo", () => {
  it("maps errors to repo codes", () => {
    expect(mapDbError({ code: "28000" }).code).toBe("unauthenticated");
    expect(mapDbError({ code: "42501" }).code).toBe("forbidden");
    expect(mapDbError({ code: "23514" }).code).toBe("invalid");
    expect(mapDbError({ code: "23514", message: "stale_settlement" }).code).toBe("stale");
    expect(mapDbError({ code: "P0001", message: "rate_limited" }).code).toBe("rate_limited");
    expect(mapDbError({ code: "P0001", message: "join_failed" }).code).toBe("join_failed");
    expect(mapDbError({ code: "P0001", message: "profile_required" }).code).toBe("profile_required");
    expect(mapDbError({ message: "boom" }).code).toBe("unknown");
  });

  it("auth: sign up and sign in validate input and call supabase auth with email + password", async () => {
    const { client, auth } = fakeClient();
    const repo = createSupabaseRepo(client);
    await expect(repo.signUp("nope", "password123")).rejects.toMatchObject({ code: "invalid" });
    await expect(repo.signUp("a@x.kz", "short")).rejects.toMatchObject({ code: "weak_password" });
    expect(auth.signUp).not.toHaveBeenCalled();
    expect(await repo.signUp(" A@X.kz ", "password123")).toEqual({ user_id: "u1", email: "a@x.kz" });
    expect(auth.signUp).toHaveBeenCalledWith({ email: "a@x.kz", password: "password123" });
    await expect(repo.signIn("a@x.kz", "")).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(await repo.signIn("a@x.kz", "password123")).toEqual({ user_id: "u1", email: "a@x.kz" });
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: "a@x.kz", password: "password123" });
    await repo.signOut();
    expect(auth.signOut).toHaveBeenCalled();
  });

  it("auth errors map to repo codes; an existing account behind 'Confirm email' is email_taken, no session is unknown", async () => {
    const failWith = (error: { code?: string; status?: number }) => {
      const f = fakeClient();
      f.auth.signUp.mockResolvedValueOnce({ data: { user: null, session: null }, error });
      f.auth.signInWithPassword.mockResolvedValueOnce({ data: { user: null }, error });
      return createSupabaseRepo(f.client);
    };
    const cases: Array<[{ code?: string; status?: number }, string]> = [
      [{ code: "invalid_credentials", status: 400 }, "invalid_credentials"],
      [{ code: "user_already_exists", status: 422 }, "email_taken"],
      [{ code: "email_exists", status: 422 }, "email_taken"],
      [{ code: "weak_password", status: 422 }, "weak_password"],
      [{ code: "over_request_rate_limit", status: 429 }, "rate_limited"],
      [{ status: 429 }, "rate_limited"],
      [{ code: "unexpected_failure", status: 500 }, "unknown"],
    ];
    for (const [error, code] of cases) {
      await expect(failWith(error).signUp("a@x.kz", "password123")).rejects.toMatchObject({ code });
      await expect(failWith(error).signIn("a@x.kz", "password123")).rejects.toMatchObject({ code });
    }
    const hidden = fakeClient();
    hidden.auth.signUp.mockResolvedValueOnce({ data: { user: { id: "u1", identities: [] }, session: null }, error: null });
    await expect(createSupabaseRepo(hidden.client).signUp("a@x.kz", "password123")).rejects.toMatchObject({ code: "email_taken" });
    const noSession = fakeClient();
    noSession.auth.signUp.mockResolvedValueOnce({ data: { user: { id: "u1", identities: [{}] }, session: null }, error: null });
    await expect(createSupabaseRepo(noSession.client).signUp("a@x.kz", "password123")).rejects.toMatchObject({ code: "unknown" });
  });

  it("getSession / getMe", async () => {
    const signedOut = createSupabaseRepo(fakeClient().client);
    expect(await signedOut.getSession()).toBeNull();
    await expect(signedOut.getMe()).rejects.toMatchObject({ code: "unauthenticated" });
    const profile = { id: "u1", display_name: "А", kaspi_phone: null, avatar_color: "blue", created_at: "x" };
    const repo = createSupabaseRepo(fakeClient({ user: { id: "u1", email: "a@x.kz" }, tables: { profiles: { data: profile, error: null } } }).client);
    expect(await repo.getSession()).toEqual({ user_id: "u1", email: "a@x.kz" });
    expect(await repo.getMe()).toEqual(profile);
  });

  it("writes go through RPCs with the parameter names the migration defines", async () => {
    const purchase = { id: "p1", household_id: "h1", payer_id: "u1", amount: 6000, description: "x", merchant: null, source: "manual", status: "shared", created_at: "t", shares: [{ purchase_id: "p1", household_id: "h1", debtor_id: "u2", amount: 3000, settled_at: null, settlement_id: null }] };
    const { client, calls } = fakeClient({
      rpc: {
        upsert_profile: { data: { id: "u1" }, error: null },
        create_household: { data: { id: "h1" }, error: null },
        create_purchase_with_shares: { data: purchase, error: null },
      },
    });
    const repo = createSupabaseRepo(client);
    await repo.upsertProfile({ display_name: " Ерасыл ", kaspi_phone: "8 700 123 45 67" });
    await repo.createHousehold(" Квартира 42 ");
    const created = await repo.createPurchase({ household_id: "h1", amount: 6000, description: " Хлеб ", participant_ids: ["u1", "u2"] });
    expect(created.shares[0]).toEqual({ purchase_id: "p1", debtor_id: "u2", amount: 3000, settled_at: null, settlement_id: null });
    expect(calls).toEqual([
      { fn: "upsert_profile", args: { p_name: "Ерасыл", p_phone: "+77001234567" } },
      { fn: "create_household", args: { household_name: "Квартира 42" } },
      { fn: "create_purchase_with_shares", args: { p_household_id: "h1", p_amount: 6000, p_description: "Хлеб", p_merchant: null, p_participant_ids: ["u1", "u2"] } },
    ]);
    await expect(repo.createPurchase({ household_id: "h1", amount: 0, description: "x", participant_ids: ["u1"] })).rejects.toMatchObject({ code: "invalid" });
    // fewer tenge than people would mean a 0 tenge share
    await expect(repo.createPurchase({ household_id: "h1", amount: 1, description: "x", participant_ids: ["u1", "u2"] })).rejects.toMatchObject({ code: "invalid" });
  });

  it("createPurchase is one RPC: no follow-up read can turn a saved purchase into a failure", async () => {
    const purchase = { id: "p1", household_id: "h1", payer_id: "u1", amount: 100, description: "x", merchant: null, source: "manual", status: "shared", created_at: "t", shares: [] };
    // the purchases table is broken on purpose: it must not even be touched
    const { client, queries } = fakeClient({
      rpc: { create_purchase_with_shares: { data: purchase, error: null } },
      tables: { purchases: { data: null, error: { code: "XX000", message: "read failed" } } },
    });
    const created = await createSupabaseRepo(client).createPurchase({ household_id: "h1", amount: 100, description: "x", participant_ids: ["u1"] });
    expect(created.id).toBe("p1");
    expect(queries).toEqual([]);
    const failing = createSupabaseRepo(fakeClient({ rpc: { create_purchase_with_shares: { data: null, error: { code: "42501", message: "nope" } } } }).client);
    await expect(failing.createPurchase({ household_id: "h1", amount: 100, description: "x", participant_ids: ["u1"] })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("never exposes raw database text in error messages", () => {
    const raw = 'duplicate key value violates unique constraint "households_invite_code_key" Key (invite_code)=(SECRET) already exists';
    for (const code of ["23505", "42501", "28000", "XX000"]) {
      const e = mapDbError({ code, message: raw });
      expect(e.message).not.toContain("SECRET");
      expect(e.message).not.toContain("constraint");
    }
  });

  it("reads select, filter and order exactly as the screens rely on (with tie-breakers)", async () => {
    const { client, queries } = fakeClient({
      tables: { households: { data: [], error: null }, members: { data: [], error: null }, purchases: { data: [], error: null } },
    });
    const repo = createSupabaseRepo(client);
    await repo.listHouseholds();
    await repo.listMembers("h1");
    await repo.listPurchases("h1");
    expect(queries).toEqual([
      'households.select("*")',
      'households.order("created_at",{"ascending":true})',
      'households.order("id",{"ascending":true})',
      'members.select("*, profile:profiles(*)")',
      'members.eq("household_id","h1")',
      'members.eq("active",true)',
      'members.order("joined_at",{"ascending":true})',
      'members.order("user_id",{"ascending":true})',
      'purchases.select("*, shares(*)")',
      'purchases.eq("household_id","h1")',
      'purchases.order("created_at",{"ascending":false})',
      'purchases.order("id",{"ascending":false})',
    ]);
  });

  it("join: null result and RPC errors are the same generic failure", async () => {
    const nullResult = createSupabaseRepo(fakeClient({ rpc: { join_household: { data: null, error: null } } }).client);
    const blank = createSupabaseRepo(fakeClient({ rpc: { join_household: { data: { id: null }, error: null } } }).client);
    const limited = createSupabaseRepo(fakeClient({ rpc: { join_household: { data: null, error: { code: "P0001", message: "join_failed" } } } }).client);
    const rls = createSupabaseRepo(fakeClient({ rpc: { join_household: { data: null, error: { code: "42501", message: "x" } } } }).client);
    for (const r of [nullResult, blank, limited, rls]) {
      const e = await r.joinHousehold("ABCDEFGHJK").catch((x: unknown) => x);
      expect(e).toBeInstanceOf(RepoError);
      expect(e).toMatchObject({ code: "join_failed", message: "Invalid or unavailable invite code" });
    }
    const needsProfile = createSupabaseRepo(fakeClient({ rpc: { join_household: { data: null, error: { code: "P0001", message: "profile_required" } } } }).client);
    await expect(needsProfile.joinHousehold("ABCDEFGHJK")).rejects.toMatchObject({ code: "profile_required" });
    const ok = createSupabaseRepo(fakeClient({ rpc: { join_household: { data: { id: "h1", name: "К" }, error: null } } }).client);
    await expect(ok.joinHousehold("abcd efgh jk")).resolves.toMatchObject({ id: "h1" });
  });

  it("reads reshape rows: members drop shares' household_id and orphan profiles", async () => {
    const m = { household_id: "h1", user_id: "u1", role: "admin", active: true, away_until: null, joined_at: "t", profile: { id: "u1", display_name: "А" } };
    const repo = createSupabaseRepo(
      fakeClient({
        tables: {
          members: { data: [m, { ...m, user_id: "u2", profile: null }], error: null },
          households: { data: [{ id: "h1" }], error: null },
          purchases: { data: [{ id: "p1", shares: [{ purchase_id: "p1", household_id: "h1", debtor_id: "u1", amount: 1, settled_at: null, settlement_id: null }] }], error: null },
        },
      }).client,
    );
    expect((await repo.listMembers("h1")).map((x) => x.user_id)).toEqual(["u1"]);
    expect(await repo.listHouseholds()).toEqual([{ id: "h1" }]);
    const [p] = await repo.listPurchases("h1");
    expect(p.shares[0]).not.toHaveProperty("household_id");
    const failing = createSupabaseRepo(fakeClient({ tables: { households: { data: null, error: { code: "42501" } } } }).client);
    await expect(failing.listHouseholds()).rejects.toMatchObject({ code: "forbidden" });
    const missing = createSupabaseRepo(fakeClient({ tables: { households: { data: null, error: null } } }).client);
    await expect(missing.listHouseholds()).rejects.toMatchObject({ code: "not_found" });
  });

  it("settlements: RPC names and arguments (no amount is ever sent), the read query, and error mapping", async () => {
    const row = { id: "s1", household_id: "h1", from_id: "u1", to_id: "u2", amount: 200, status: "marked", marked_at: "t", confirmed_at: null };
    const { client, calls, queries } = fakeClient({
      rpc: {
        mark_settlement: { data: row, error: null },
        confirm_settlement: { data: { ...row, status: "confirmed" }, error: null },
        cancel_settlement: { data: { ...row, status: "cancelled" }, error: null },
      },
      tables: {
        settlements: { data: [{ ...row, covered: [{ purchase_id: "p1", debtor_id: "u1", amount: 200, junk: 1 }] }], error: null },
        settlement_shares: { data: [{ purchase_id: "p1", debtor_id: "u1", amount: 200 }], error: null },
      },
    });
    const repo = createSupabaseRepo(client);
    const covered = [{ purchase_id: "p1", debtor_id: "u1", amount: 200 }];
    expect(await repo.markSettlement("h1", "u2")).toEqual({ ...row, covered });
    expect((await repo.confirmSettlement("s1")).status).toBe("confirmed");
    expect((await repo.cancelSettlement("s1")).status).toBe("cancelled");
    expect(calls).toEqual([
      { fn: "mark_settlement", args: { p_household_id: "h1", p_to: "u2" } },
      { fn: "confirm_settlement", args: { p_settlement_id: "s1" } },
      { fn: "cancel_settlement", args: { p_settlement_id: "s1" } },
    ]);
    queries.length = 0;
    expect(await repo.listSettlements("h1")).toEqual([{ ...row, covered }]);
    expect(queries).toEqual([
      'settlements.select("*, covered:settlement_shares(purchase_id, debtor_id, amount)")',
      'settlements.eq("household_id","h1")',
      'settlements.order("marked_at",{"ascending":false})',
      'settlements.order("id",{"ascending":true})',
    ]);

    const failing = (code: string) =>
      createSupabaseRepo(fakeClient({ rpc: { confirm_settlement: { data: null, error: { code, message: "raw db text" } } } }).client);
    await expect(failing("42501").confirmSettlement("s1")).rejects.toMatchObject({ code: "forbidden", message: "Not allowed" });
    await expect(failing("P0002").confirmSettlement("s1")).rejects.toMatchObject({ code: "not_found" });
    await expect(failing("23514").confirmSettlement("s1")).rejects.toMatchObject({ code: "invalid" });

    // the RPC succeeded but the follow-up read of the recorded set fails: still a success, with an empty record
    const flaky = createSupabaseRepo(
      fakeClient({
        rpc: { mark_settlement: { data: row, error: null } },
        tables: { settlement_shares: { data: null, error: { code: "08006" } } },
      }).client,
    );
    expect(await flaky.markSettlement("h1", "u2")).toEqual({ ...row, covered: [] });
    expect(mapDbError({ code: "P0002" }).code).toBe("not_found");
  });
});
