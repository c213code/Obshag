import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const A = "00000000-0000-0000-0000-00000000000a"; // payer
const B = "00000000-0000-0000-0000-00000000000b";
const C = "00000000-0000-0000-0000-00000000000c";
const X = "00000000-0000-0000-0000-0000000000f1"; // other household
const Z = "00000000-0000-0000-0000-0000000000f3"; // no household

const STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create schema extensions;
  create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;
const MIGRATIONS = ["0001_baseline.sql", "0002_slice1_rpcs.sql", "0003_slice3_settlements.sql", "0004_slice4_capture.sql"];

let db: PGlite;
let hh: string;
let otherHh: string;

async function as(user: string | null, role: "authenticated" | "anon" = "authenticated") {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ""}', false); set role ${role};`);
}
async function admin() {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
}
async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code });
}

async function rotate(user: string): Promise<string> {
  await as(user);
  return (await db.query<{ t: string }>(`select public.rotate_capture_token() as t`)).rows[0].t;
}
type Captured = {
  purchase_id: string;
  household_id: string;
  amount: number;
  merchant: string | null;
  subscriptions: Array<{ endpoint: string; p256dh: string; auth: string }>;
};
async function capture(token: string, amount = 6000, merchant: string | null = "Magnum", role: "anon" | "authenticated" = "anon"): Promise<Captured> {
  await as(null, role);
  return (await db.query<{ r: Captured }>(`select public.capture_purchase($1, $2, $3) as r`, [token, amount, merchant])).rows[0].r;
}
async function visible(user: string): Promise<string[]> {
  await as(user);
  return (await db.query<{ id: string }>(`select id from public.purchases order by id`)).rows.map((r) => r.id);
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUB);
  for (const file of MIGRATIONS) await db.exec(readFileSync(join(process.cwd(), "supabase/migrations", file), "utf8"));
  await db.exec(`insert into auth.users values ('${A}'),('${B}'),('${C}'),('${X}'),('${Z}');`);
  for (const [id, name] of [
    [A, "Ерасыл"],
    [B, "Айдос"],
    [C, "Даня"],
    [X, "Чужой"],
    [Z, "Никто"],
  ]) {
    await as(id);
    await db.query(`select public.upsert_profile($1, '+77001234567')`, [name]);
  }
  await as(A);
  const h = await db.query<{ id: string; invite_code: string }>(`select * from public.create_household('Квартира 42')`);
  hh = h.rows[0].id;
  for (const u of [B, C]) {
    await as(u);
    await db.query(`select public.join_household($1)`, [h.rows[0].invite_code]);
  }
  await as(X);
  otherHh = (await db.query<{ id: string }>(`select * from public.create_household('Чужая')`)).rows[0].id;
});
afterAll(async () => {
  await db.close();
});
// Test fixture reset: runs as the table owner against the in-memory test database only.
beforeEach(async () => {
  await admin();
  await db.exec(`truncate public.purchases cascade; truncate private.capture_ops; truncate public.push_subscriptions;
    update public.members set active = true where household_id = '${hh}';
    update public.members set active = false where household_id = '${otherHh}' and user_id <> '${X}';
    update public.profiles set default_household_id = null;`);
});

describe("rotate_capture_token", () => {
  it("returns a 43 char base64url token and stores only its sha256 hash", async () => {
    const token = await rotate(A);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await admin();
    const rows = (
      await db.query<{ token_hash: string; ok: boolean }>(
        `select token_hash, token_hash = encode(extensions.digest($1, 'sha256'), 'hex') as ok from public.capture_tokens where user_id = $2`,
        [token, A],
      )
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].ok).toBe(true);
    expect(rows[0].token_hash).not.toContain(token);
  });

  it("matches the node sha256 hex (the API and the database agree)", async () => {
    const token = await rotate(A);
    const { createHash } = await import("node:crypto");
    await admin();
    const { token_hash } = (await db.query<{ token_hash: string }>(`select token_hash from public.capture_tokens where user_id = $1`, [A])).rows[0];
    expect(token_hash).toBe(createHash("sha256").update(token).digest("hex"));
  });

  it("replaces the previous token: the old one stops working", async () => {
    const first = await rotate(A);
    const second = await rotate(A);
    expect(second).not.toBe(first);
    await expectCode(capture(first), "28000");
    expect((await capture(second)).amount).toBe(6000);
    await admin();
    expect((await db.query(`select 1 from public.capture_tokens where user_id = $1`, [A])).rows).toHaveLength(1);
  });

  it("clients never read the hash, only that a token exists", async () => {
    await rotate(A);
    await as(A);
    await expectCode(db.query(`select token_hash from public.capture_tokens`), "42501");
    expect((await db.query(`select user_id, created_at, last_used_at from public.capture_tokens`)).rows).toHaveLength(1);
  });

  it("is not callable by anon", async () => {
    await as(null, "anon");
    await expectCode(db.query(`select public.rotate_capture_token()`), "42501");
  });
});

describe("capture_purchase", () => {
  it("rejects an unknown or malformed token with the same generic 28000", async () => {
    await expectCode(capture("x".repeat(43)), "28000");
    await expectCode(capture("short"), "28000");
    await expectCode(capture(""), "28000");
  });

  it("stores a pending apple_pay purchase for the owner in the most recently joined household", async () => {
    const token = await rotate(B);
    const r = await capture(token, 6000, "  Magnum  ");
    expect(r.household_id).toBe(hh);
    await admin();
    const p = (await db.query<Record<string, unknown>>(`select * from public.purchases where id = $1`, [r.purchase_id])).rows[0];
    expect(p).toMatchObject({ payer_id: B, status: "pending", source: "apple_pay", amount: 6000, description: "Magnum", merchant: "Magnum" });
    expect((await db.query(`select 1 from public.shares where purchase_id = $1`, [r.purchase_id])).rows).toHaveLength(0);
    expect((await db.query<{ last_used_at: string | null }>(`select last_used_at from public.capture_tokens where user_id = $1`, [B])).rows[0].last_used_at).not.toBeNull();
  });

  it("uses «Покупка» without a merchant", async () => {
    const token = await rotate(A);
    const r = await capture(token, 500, null);
    await admin();
    const p = (await db.query<{ description: string; merchant: string | null }>(`select description, merchant from public.purchases where id = $1`, [r.purchase_id])).rows[0];
    expect(p).toEqual({ description: "Покупка", merchant: null });
  });

  it("honours default_household_id, falls back when the user left it, and raises no_household without one", async () => {
    await admin();
    const code = (await db.query<{ invite_code: string }>(`select invite_code from public.households where id = $1`, [otherHh])).rows[0].invite_code;
    await as(C);
    await db.query(`select public.join_household($1)`, [code]); // most recently joined
    const token = await rotate(C);
    expect((await capture(token)).household_id).toBe(otherHh);
    await as(C);
    await db.query(`select public.set_default_household($1)`, [hh]);
    expect((await capture(token)).household_id).toBe(hh);
    // leaves hh softly: the default no longer applies
    await admin();
    await db.exec(`update public.members set active = false where household_id = '${hh}' and user_id = '${C}'`);
    expect((await capture(token)).household_id).toBe(otherHh);
    // leaves both: nothing to capture into
    await admin();
    await db.exec(`update public.members set active = false where household_id = '${otherHh}' and user_id = '${C}'`);
    await expectCode(capture(token), "23514");

    const tz = await rotate(Z);
    await expectCode(capture(tz), "23514");
  });

  it("validates the amount and the merchant", async () => {
    const token = await rotate(A);
    for (const bad of [0, -5, 10_000_001]) await expectCode(capture(token, bad), "23514");
    await expectCode(capture(token, 100, "m".repeat(121)), "23514");
  });

  it("returns the owner's push subscriptions only", async () => {
    const token = await rotate(A);
    await as(A);
    await db.query(`select public.save_push_subscription('https://fcm.googleapis.com/a1', 'k1', 'a1')`);
    await as(B);
    await db.query(`select public.save_push_subscription('https://fcm.googleapis.com/b1', 'k2', 'a2')`);
    const r = await capture(token);
    expect(r.subscriptions).toEqual([{ endpoint: "https://fcm.googleapis.com/a1", p256dh: "k1", auth: "a1" }]);
  });

  it("allows 30 captures per hour and rate-limits the 31st; other users are not affected", async () => {
    const token = await rotate(A);
    const other = await rotate(B);
    for (let i = 0; i < 30; i++) await capture(token, 100 + i);
    await expectCode(capture(token, 1), "P0001");
    expect((await capture(other)).amount).toBe(6000);
    // the window slides: old entries stop counting
    await admin();
    await db.exec(`update private.capture_ops set at = now() - interval '61 minutes' where user_id = '${A}'`);
    expect((await capture(token, 7)).amount).toBe(7);
  });

  it("a failed (invalid amount) capture does not count against the limit", async () => {
    const token = await rotate(A);
    for (let i = 0; i < 40; i++) await expectCode(capture(token, 0), "23514");
    expect((await capture(token)).amount).toBe(6000);
  });

  it("dedupes a retry: same amount and merchant within 60 s returns the existing pending purchase", async () => {
    const token = await rotate(A);
    const first = await capture(token, 4200, "Magnum");
    const again = await capture(token, 4200, "Magnum");
    expect(again.purchase_id).toBe(first.purchase_id);
    expect(again.subscriptions).toEqual([]);
    expect((await capture(token, 4200, "Other")).purchase_id).not.toBe(first.purchase_id);
    expect((await capture(token, 4201, "Magnum")).purchase_id).not.toBe(first.purchase_id);
    await admin();
    await db.exec(`update public.purchases set created_at = now() - interval '2 minutes' where id = '${first.purchase_id}'`);
    expect((await capture(token, 4200, "Magnum")).purchase_id).not.toBe(first.purchase_id);
  });

  it("strips control and bidi characters from the merchant", async () => {
    const token = await rotate(A);
    const r = await capture(token, 100, "Mag\u202enum\u0007\u200f \u2066x\u2069");
    expect(r.merchant).toBe("Magnum x");
    expect((await capture(token, 101, "\u202e\u0007")).merchant).toBeNull();
  });
});

describe("pending visibility", () => {
  it("is visible to the payer only, never to housemates or outsiders, and its shares stay empty", async () => {
    const token = await rotate(A);
    const r = await capture(token);
    expect(await visible(A)).toContain(r.purchase_id);
    expect(await visible(B)).not.toContain(r.purchase_id);
    expect(await visible(C)).not.toContain(r.purchase_id);
    expect(await visible(X)).not.toContain(r.purchase_id);
  });

  it("a housemate cannot update or remove it either", async () => {
    const r = await capture(await rotate(A));
    await as(B);
    expect((await db.query(`update public.purchases set description = 'x' where id = $1 returning id`, [r.purchase_id])).rows).toHaveLength(0);
    expect((await db.query(`delete from public.purchases where id = $1 returning id`, [r.purchase_id])).rows).toHaveLength(0);
  });
});

describe("resolve_pending", () => {
  type Resolved = { id: string; status: string; description: string; amount: number; shares: Array<{ debtor_id: string; amount: number; settled_at: string | null }> };
  async function resolve(user: string, id: string, shared: boolean, desc: string | null, who: string[] = []): Promise<Resolved> {
    await as(user);
    return (await db.query<{ r: Resolved }>(`select public.resolve_pending($1, $2, $3, $4) as r`, [id, shared, desc, who])).rows[0].r;
  }

  it("shared: sets the description and creates the equal split (remainder to non-payers in order)", async () => {
    const r = await capture(await rotate(A), 1000);
    const res = await resolve(A, r.purchase_id, true, "Продукты", [A, B, C]);
    expect(res.status).toBe("shared");
    expect(res.description).toBe("Продукты");
    const byId = Object.fromEntries(res.shares.map((s) => [s.debtor_id, s]));
    expect(byId[A].amount).toBe(333); // payer: base, settled at once
    expect(byId[A].settled_at).not.toBeNull();
    expect(byId[B].amount).toBe(334);
    expect(byId[C].amount).toBe(333);
    expect(res.shares.reduce((s, x) => s + x.amount, 0)).toBe(1000);
    expect(await visible(B)).toContain(r.purchase_id);
    await as(B);
    expect((await db.query(`select * from public.shares where purchase_id = $1`, [r.purchase_id])).rows).toHaveLength(3);
  });

  it("personal: stays hidden from housemates and has no shares", async () => {
    const r = await capture(await rotate(A));
    const res = await resolve(A, r.purchase_id, false, "Кофе");
    expect(res).toMatchObject({ status: "personal", description: "Кофе" });
    expect(res.shares).toEqual([]);
    expect(await visible(B)).not.toContain(r.purchase_id);
    expect(await visible(A)).toContain(r.purchase_id);
  });

  it("keeps the captured description when none is given", async () => {
    const r = await capture(await rotate(A));
    expect((await resolve(A, r.purchase_id, false, "  ")).description).toBe("Magnum");
  });

  it("a non-payer cannot resolve (housemate, outsider, anon) and nothing changes", async () => {
    const r = await capture(await rotate(A));
    await expectCode(resolve(B, r.purchase_id, true, "x", [A, B]), "P0002");
    await expectCode(resolve(X, r.purchase_id, false, "x"), "P0002");
    await as(null, "anon");
    await expectCode(db.query(`select public.resolve_pending($1, false, 'x', '{}')`, [r.purchase_id]), "42501");
    await admin();
    expect((await db.query<{ status: string }>(`select status from public.purchases where id = $1`, [r.purchase_id])).rows[0].status).toBe("pending");
  });

  it("is idempotent per final state and refuses to flip a resolved purchase", async () => {
    const r = await capture(await rotate(A), 900);
    const first = await resolve(A, r.purchase_id, true, "Хлеб", [A, B, C]);
    const again = await resolve(A, r.purchase_id, true, "Другое", [A, B]);
    expect(again.description).toBe("Хлеб");
    expect(again.shares).toHaveLength(3);
    expect(again.shares).toEqual(first.shares);
    await expectCode(resolve(A, r.purchase_id, false, "x"), "23514");
    const r2 = await capture(await rotate(A), 900);
    await resolve(A, r2.purchase_id, false, "Моё");
    expect((await resolve(A, r2.purchase_id, false, "Моё")).status).toBe("personal");
    await expectCode(resolve(A, r2.purchase_id, true, "x", [A, B]), "23514");
  });

  it("validates participants like create_purchase_with_shares", async () => {
    const r = await capture(await rotate(A), 1000);
    await expectCode(resolve(A, r.purchase_id, true, "x", []), "23514");
    await expectCode(resolve(A, r.purchase_id, true, "x", [A, A]), "23514");
    await expectCode(resolve(A, r.purchase_id, true, "x", [A, X]), "23503");
    const tiny = await capture(await rotate(A), 2);
    await expectCode(resolve(A, tiny.purchase_id, true, "x", [A, B, C]), "23514");
    await admin();
    expect((await db.query<{ status: string }>(`select status from public.purchases where id = $1`, [r.purchase_id])).rows[0].status).toBe("pending");
  });

  it("create_purchase_with_shares still splits the same way after the refactor", async () => {
    await as(A);
    const res = (await db.query<{ r: Resolved }>(`select public.create_purchase_with_shares($1, 1000, 'Хлеб', null, $2) as r`, [hh, [A, B, C]])).rows[0].r;
    expect(res.status).toBe("shared");
    expect(res.shares.map((s) => s.amount).sort()).toEqual([333, 333, 334]);
  });
});

describe("set_default_household and save_push_subscription", () => {
  it("only a member can set the default household", async () => {
    await as(A);
    await expectCode(db.query(`select public.set_default_household($1)`, [otherHh]), "42501");
    await db.query(`select public.set_default_household($1)`, [hh]);
    expect((await db.query<{ d: string }>(`select default_household_id as d from public.profiles where id = $1`, [A])).rows[0].d).toBe(hh);
  });

  it("a client cannot write default_household_id directly", async () => {
    await as(A);
    await expectCode(db.query(`update public.profiles set default_household_id = $1 where id = $2`, [hh, A]), "42501");
  });

  it("saves by endpoint, moves it to the new owner and rejects non-https", async () => {
    await as(A);
    await db.query(`select public.save_push_subscription('https://fcm.googleapis.com/e', 'k', 'a')`);
    await as(B);
    await db.query(`select public.save_push_subscription('https://fcm.googleapis.com/e', 'k2', 'a2')`);
    await admin();
    const rows = (await db.query<{ user_id: string; p256dh: string }>(`select user_id, p256dh from public.push_subscriptions`)).rows;
    expect(rows).toEqual([{ user_id: B, p256dh: "k2" }]);
    await as(B);
    await expectCode(db.query(`select public.save_push_subscription('http://x/e', 'k', 'a')`), "23514");
  });
});

describe("push endpoint allowlist, cap and write path (S1)", () => {
  const BAD = ["https://evil.example/x", "https://169.254.169.254/latest", "https://fcm.googleapis.com.evil.io/x", "http://fcm.googleapis.com/x", "https://user@fcm.googleapis.com.evil.io/x"];
  const INS = (e: string) => `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ('${A}', '${e}', 'k', 'a')`;

  it("the RPC accepts the four push services and rejects every other host", async () => {
    await as(A);
    for (const ok of [
      "https://web.push.apple.com/Q1",
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://db5p.notify.windows.com/w/?token=abc",
    ])
      await db.query(`select public.save_push_subscription($1, 'k', 'a')`, [ok]);
    for (const bad of BAD) await expectCode(db.query(`select public.save_push_subscription($1, 'k', 'a')`, [bad]), "23514");
  });

  it("a direct insert or update is refused for authenticated, and the table CHECK holds for the owner role too", async () => {
    await as(A);
    await expectCode(db.query(INS("https://evil.example/x")), "42501");
    await expectCode(db.query(INS("https://fcm.googleapis.com/ok")), "42501");
    await db.query(`select public.save_push_subscription('https://fcm.googleapis.com/ok', 'k', 'a')`);
    await expectCode(db.query(`update public.push_subscriptions set endpoint = 'https://evil.example/x'`), "42501");
    await admin();
    await expectCode(db.query(INS("https://evil.example/x")), "23514");
  });

  it("anon cannot save a subscription", async () => {
    await as(null, "anon");
    await expectCode(db.query(`select public.save_push_subscription('https://fcm.googleapis.com/x', 'k', 'a')`), "42501");
  });

  it("caps each user at 10 subscriptions, dropping the oldest; other users are untouched", async () => {
    await as(B);
    await db.query(`select public.save_push_subscription('https://fcm.googleapis.com/b', 'k', 'a')`);
    for (let i = 0; i < 12; i++) {
      await as(A);
      await db.query(`select public.save_push_subscription($1, 'k', 'a')`, [`https://fcm.googleapis.com/a${i}`]);
      await admin();
      await db.query(`update public.push_subscriptions set created_at = now() - interval '${100 - i} minutes' where endpoint = $1`, [`https://fcm.googleapis.com/a${i}`]);
    }
    await as(A);
    await db.query(`select public.save_push_subscription('https://fcm.googleapis.com/a12', 'k', 'a')`);
    await admin();
    const mine = (await db.query<{ endpoint: string }>(`select endpoint from public.push_subscriptions where user_id = $1`, [A])).rows.map((r) => r.endpoint);
    expect(mine).toHaveLength(10);
    expect(mine).not.toContain("https://fcm.googleapis.com/a0");
    expect(mine).not.toContain("https://fcm.googleapis.com/a2");
    expect(mine).toContain("https://fcm.googleapis.com/a12");
    expect((await db.query(`select 1 from public.push_subscriptions where user_id = $1`, [B])).rows).toHaveLength(1);
  });

  it("the owner can still read and delete their own rows only", async () => {
    await as(A);
    await db.query(`select public.save_push_subscription('https://fcm.googleapis.com/mine', 'k', 'a')`);
    await as(B);
    await db.query(`select public.save_push_subscription('https://fcm.googleapis.com/theirs', 'k', 'a')`);
    await db.query(`delete from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/mine'`);
    expect((await db.query(`select 1 from public.push_subscriptions`)).rows).toHaveLength(1);
    await as(A);
    expect((await db.query(`select 1 from public.push_subscriptions`)).rows).toHaveLength(1);
  });
});

describe("capture_tokens: one per user (S3)", () => {
  it("unique(user_id) holds for a direct insert; rotation keeps a single row", async () => {
    await rotate(A);
    await rotate(A);
    await admin();
    expect((await db.query(`select 1 from public.capture_tokens where user_id = $1`, [A])).rows).toHaveLength(1);
    await expectCode(db.query(`insert into public.capture_tokens (user_id, token_hash) values ($1, 'zzz')`, [A]), "23505");
  });
});

describe("prune_push_subscription", () => {
  it("removes only the token owner's endpoint; a bad token gets 28000", async () => {
    const token = await rotate(A);
    await as(A);
    await db.query(`select public.save_push_subscription('https://fcm.googleapis.com/a', 'k', 'a')`);
    await as(B);
    await db.query(`select public.save_push_subscription('https://fcm.googleapis.com/b', 'k', 'a')`);
    await as(null, "anon");
    await expectCode(db.query(`select public.prune_push_subscription($1, 'https://fcm.googleapis.com/a')`, ["y".repeat(43)]), "28000");
    await db.query(`select public.prune_push_subscription($1, 'https://fcm.googleapis.com/b')`, [token]); // not A's: nothing happens
    await db.query(`select public.prune_push_subscription($1, 'https://fcm.googleapis.com/a')`, [token]);
    await admin();
    expect((await db.query<{ endpoint: string }>(`select endpoint from public.push_subscriptions`)).rows).toEqual([{ endpoint: "https://fcm.googleapis.com/b" }]);
  });
});

describe("anon surface", () => {
  it("anon can execute only capture_purchase and prune_push_subscription", async () => {
    await admin();
    const res = await db.query<{ n: string }>(
      `select p.oid::regprocedure::text as n
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute')
       order by 1`,
    );
    expect(res.rows.map((r) => r.n)).toEqual(["capture_purchase(text,integer,text)", "prune_push_subscription(text,text)"]);
  });

  it("every function added in 0004 is security definer with an empty search_path", async () => {
    await admin();
    const names = [
      "rotate_capture_token",
      "capture_purchase",
      "prune_push_subscription",
      "resolve_pending",
      "set_default_household",
      "save_push_subscription",
      "check_participants",
      "insert_equal_shares",
      "purchase_json",
      "can_see_purchase",
    ];
    const fns = await db.query<{ proname: string; prosecdef: boolean; proconfig: string[] | null }>(
      `select proname, prosecdef, proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private') and proname = any($1)`,
      [names],
    );
    expect(fns.rows).toHaveLength(names.length);
    for (const f of fns.rows) {
      expect(f.prosecdef).toBe(true);
      expect(f.proconfig).toContain('search_path=""');
    }
  });

  it("anon cannot read or write any table, nor the private schema", async () => {
    await admin();
    const tables = (await db.query<{ t: string }>(`select tablename as t from pg_tables where schemaname = 'public'`)).rows.map((r) => r.t);
    expect(tables.length).toBeGreaterThanOrEqual(11);
    await as(null, "anon");
    for (const t of tables) {
      await expectCode(db.query(`select * from public."${t}"`), "42501");
    }
    await expectCode(db.query(`insert into public.purchases (household_id, payer_id, amount, description) values ('${hh}', '${A}', 1, 'x')`), "42501");
    await expectCode(db.query(`select * from private.capture_ops`), "42501");
  });

  it("the other definer RPCs are closed to anon", async () => {
    await as(null, "anon");
    await expectCode(db.query(`select public.set_default_household($1)`, [hh]), "42501");
    await expectCode(db.query(`select public.save_push_subscription('https://fcm.googleapis.com/y', 'k', 'a')`), "42501");
    await expectCode(db.query(`select public.create_household('x')`), "42501");
  });

  it("capture_purchase is for anon only: authenticated sessions cannot execute it", async () => {
    const token = await rotate(A);
    await expectCode(capture(token, 1234, "Small", "authenticated"), "42501");
  });
});
