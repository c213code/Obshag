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
      signInWithOtp: vi.fn(async () => ({ error: null })),
      verifyOtp: vi.fn(async () => ({ data: { user: { id: "u1", email: "a@x.kz" } }, error: null })),
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
    expect(mapDbError({ code: "P0001", message: "join_failed" }).code).toBe("join_failed");
    expect(mapDbError({ code: "P0001", message: "profile_required" }).code).toBe("profile_required");
    expect(mapDbError({ message: "boom" }).code).toBe("unknown");
  });

  it("auth: otp request/verify validate input and call supabase auth", async () => {
    const { client, auth } = fakeClient();
    const repo = createSupabaseRepo(client);
    await expect(repo.requestOtp("nope")).rejects.toMatchObject({ code: "invalid" });
    await repo.requestOtp(" A@X.kz ");
    expect(auth.signInWithOtp).toHaveBeenCalledWith({ email: "a@x.kz", options: { shouldCreateUser: true } });
    await expect(repo.verifyOtp("a@x.kz", "12")).rejects.toMatchObject({ code: "otp_failed" });
    expect(await repo.verifyOtp("a@x.kz", "123456")).toEqual({ user_id: "u1", email: "a@x.kz" });
    expect(auth.verifyOtp).toHaveBeenCalledWith({ email: "a@x.kz", token: "123456", type: "email" });
    await repo.signOut();
    expect(auth.signOut).toHaveBeenCalled();
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
});
