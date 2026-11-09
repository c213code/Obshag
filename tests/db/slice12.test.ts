import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const A = "00000000-0000-0000-0000-00000000000a"; // admin (creator)
const B = "00000000-0000-0000-0000-00000000000b"; // member, @aidos_k
const C = "00000000-0000-0000-0000-00000000000c"; // member
const SECRET = "slice12-secret";

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
const MIGRATIONS = [
  "0001_baseline.sql",
  "0002_slice1_rpcs.sql",
  "0003_slice3_settlements.sql",
  "0004_slice4_capture.sql",
  "0005_slice5_2.sql",
  "0006_slice6_7.sql",
  "0007_slice9_telegram.sql",
  "0008_slice10_capture_choice.sql",
  "0009_slice11_admin_delete.sql",
  "0010_slice12_tg_dm.sql",
];

let db: PGlite;
let hh: string;

async function as(user: string | null, role: "authenticated" | "anon" = "authenticated") {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ""}', false); set role ${role};`);
}
async function admin() {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
}
async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code });
}
async function insertPurchase(payer: string, status: "pending" | "personal" | "shared" = "pending", ageMin = 30, amount = 3000) {
  await admin();
  const r = await db.query<{ id: string }>(
    `insert into public.purchases (household_id, payer_id, amount, description, merchant, source, status, created_at)
     values ($1, $2, $3, 'Small', 'Small', 'apple_pay', $4, now() - make_interval(mins => $5)) returning id`,
    [hh, payer, amount, status, ageMin],
  );
  return r.rows[0].id;
}
const status = async (id: string) => {
  await admin();
  return (await db.query<{ status: string }>(`select status from public.purchases where id = $1`, [id])).rows[0].status;
};
const newCode = async (user: string) => {
  await as(user);
  return (await db.query<{ c: string }>(`select public.create_telegram_link_code() as c`)).rows[0].c;
};
const link = async (code: string, tg: number) => {
  await as(null, "anon");
  return (await db.query<{ n: string | null }>(`select public.tg_link_account($1, $2, $3) as n`, [SECRET, code, tg])).rows[0].n;
};
const tgOf = async (user: string) => {
  await admin();
  return (await db.query<{ t: string | null }>(`select telegram_user_id::text as t from public.profiles where id = $1`, [user])).rows[0].t;
};
const resolve = async (tg: number, id: string, shared: boolean) => {
  await as(null, "anon");
  return (await db.query<{ r: string }>(`select public.tg_resolve_pending($1, $2, $3, $4) as r`, [SECRET, tg, id, shared])).rows[0].r;
};
const digest = async () => {
  await as(null, "anon");
  return (await db.query<{ d: Array<{ user_id: string; telegram_user_id: number | null; purchases: Array<{ id: string }> }> }>(`select public.run_pending_digest($1) as d`, [SECRET])).rows[0].d;
};

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUB);
  for (const file of MIGRATIONS) await db.exec(readFileSync(join(process.cwd(), "supabase/migrations", file), "utf8"));
  await db.exec(`insert into auth.users values ('${A}'),('${B}'),('${C}');`);
  for (const [id, name] of [[A, "Ерасыл"], [B, "Айдос"], [C, "Даня"]]) {
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
  await admin();
  await db.exec(`insert into private.server_secrets values ('cron', encode(extensions.digest('${SECRET}', 'sha256'), 'hex'))`);
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await admin();
  await db.exec(`truncate public.shares, public.purchases, private.telegram_link_codes, private.pending_digest_log cascade;
    update public.profiles set telegram_user_id = null;
    update public.members set active = true, away_until = null;`);
});

describe("link codes", () => {
  it("returns a url-safe code of at least 16 characters and stores only its hash", async () => {
    const code = await newCode(A);
    expect(code).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    await admin();
    const rows = (await db.query<{ code_hash: string }>(`select code_hash from private.telegram_link_codes`)).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].code_hash).not.toContain(code);
    expect(rows[0].code_hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("a new code replaces the older ones of the same user", async () => {
    const first = await newCode(A);
    const second = await newCode(A);
    expect(await link(first, 111)).toBeNull();
    expect(await link(second, 111)).toBe("Ерасыл");
  });
  it("links once: a used code is dead", async () => {
    const code = await newCode(A);
    expect(await link(code, 111)).toBe("Ерасыл");
    expect(await tgOf(A)).toBe("111");
    expect(await link(code, 222)).toBeNull();
    expect(await tgOf(A)).toBe("111");
  });
  it("an expired code does nothing", async () => {
    const code = await newCode(A);
    await admin();
    await db.exec(`update private.telegram_link_codes set expires_at = now() - interval '1 second'`);
    expect(await link(code, 111)).toBeNull();
    expect(await tgOf(A)).toBeNull();
  });
  it("junk codes and a wrong secret are refused", async () => {
    expect(await link("short", 111)).toBeNull();
    expect(await link("x".repeat(30), 111)).toBeNull();
    await as(null, "anon");
    await expectCode(db.query(`select public.tg_link_account('wrong', $1, 1)`, ["x".repeat(24)]), "28000");
  });
  it("re-linking an id that sits on another profile moves it", async () => {
    expect(await link(await newCode(A), 777)).toBe("Ерасыл");
    expect(await link(await newCode(B), 777)).toBe("Айдос");
    expect(await tgOf(A)).toBeNull();
    expect(await tgOf(B)).toBe("777");
  });
  it("unlink clears the id", async () => {
    await link(await newCode(A), 555);
    await as(A);
    await db.query(`select public.unlink_telegram()`);
    expect(await tgOf(A)).toBeNull();
  });
  it("the codes table is closed to clients and a client cannot write telegram_user_id", async () => {
    await as(A);
    await expectCode(db.query(`select * from private.telegram_link_codes`), "42501");
    await expectCode(db.query(`update public.profiles set telegram_user_id = 5 where id = '${A}'`), "42501");
  });
});

describe("tg_resolve_pending", () => {
  beforeEach(async () => {
    await link(await newCode(B), 222);
    await link(await newCode(C), 333);
  });
  it("shared: only the payer's tg user, creates shares and flips the status", async () => {
    const id = await insertPurchase(B, "pending", 30, 3000);
    expect(await resolve(222, id, true)).toBe("shared");
    expect(await status(id)).toBe("shared");
    await admin();
    const sh = await db.query<{ debtor_id: string; amount: number }>(`select debtor_id, amount from public.shares where purchase_id = $1`, [id]);
    expect(sh.rows).toHaveLength(3);
    expect(sh.rows.reduce((s, r) => s + r.amount, 0)).toBe(3000);
  });
  it("personal: no shares", async () => {
    const id = await insertPurchase(B);
    expect(await resolve(222, id, false)).toBe("personal");
    expect(await status(id)).toBe("personal");
    await admin();
    expect((await db.query(`select 1 from public.shares where purchase_id = $1`, [id])).rows).toHaveLength(0);
  });
  it("a wrong or unlinked tg user is refused and nothing changes", async () => {
    const id = await insertPurchase(B);
    await as(null, "anon");
    await expectCode(db.query(`select public.tg_resolve_pending($1, 333, $2, true)`, [SECRET, id]), "42501");
    await expectCode(db.query(`select public.tg_resolve_pending($1, 999, $2, true)`, [SECRET, id]), "42501");
    await expectCode(db.query(`select public.tg_resolve_pending($1, 222, gen_random_uuid(), true)`, [SECRET]), "42501");
    expect(await status(id)).toBe("pending");
  });
  it("a wrong secret is refused", async () => {
    const id = await insertPurchase(B);
    await as(null, "anon");
    await expectCode(db.query(`select public.tg_resolve_pending('nope', 222, $1, true)`, [id]), "28000");
  });
  it("an already resolved purchase is not changed", async () => {
    const id = await insertPurchase(B, "personal");
    expect(await resolve(222, id, true)).toBe("already_resolved");
    expect(await status(id)).toBe("personal");
  });
  it("a second tap does not double the shares", async () => {
    const id = await insertPurchase(B);
    await resolve(222, id, true);
    expect(await resolve(222, id, true)).toBe("already_resolved");
    await admin();
    expect((await db.query(`select 1 from public.shares where purchase_id = $1`, [id])).rows).toHaveLength(3);
  });
  it("an amount smaller than the head count stays pending", async () => {
    const id = await insertPurchase(B, "pending", 30, 2);
    expect(await resolve(222, id, true)).toBe("too_small");
    expect(await status(id)).toBe("pending");
  });
  it("away members are left out of the split", async () => {
    await admin();
    await db.exec(`update public.members set away_until = (now() at time zone 'Asia/Almaty')::date + 3 where user_id = '${C}'`);
    const id = await insertPurchase(B, "pending", 30, 3000);
    await resolve(222, id, true);
    await admin();
    expect((await db.query(`select 1 from public.shares where purchase_id = $1`, [id])).rows).toHaveLength(2);
  });
});

describe("run_pending_digest", () => {
  beforeEach(async () => {
    await link(await newCode(B), 222);
  });
  it("returns old pending purchases of a payer with a telegram id, once a day", async () => {
    const old = await insertPurchase(B, "pending", 30);
    const first = await digest();
    expect(first).toHaveLength(1);
    expect(first[0].user_id).toBe(B);
    expect(Number(first[0].telegram_user_id)).toBe(222);
    expect(first[0].purchases.map((p) => p.id)).toEqual([old]);
    expect(await digest()).toEqual([]);
    await admin();
    await db.exec(`update private.pending_digest_log set sent_on = sent_on - 1`);
    expect(await digest()).toHaveLength(1);
  });
  it("excludes recent, non-pending, and users with no way to be reached", async () => {
    await insertPurchase(B, "pending", 3);
    await insertPurchase(B, "personal", 60);
    await insertPurchase(B, "shared", 60);
    await insertPurchase(C, "pending", 60); // C has neither telegram nor a push subscription
    expect(await digest()).toEqual([]);
  });
  it("a user with only a push subscription is included, with no telegram id", async () => {
    await insertPurchase(C, "pending", 60);
    await admin();
    await db.exec(`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ('${C}', 'https://fcm.googleapis.com/x', 'k', 'a')`);
    const d = await digest();
    expect(d).toHaveLength(1);
    expect(d[0].telegram_user_id).toBeNull();
  });
  it("caps one user at 10 purchases and the rest come next time", async () => {
    for (let i = 0; i < 12; i++) await insertPurchase(B, "pending", 60 + i);
    expect((await digest())[0].purchases).toHaveLength(10);
    expect((await digest())[0].purchases).toHaveLength(2);
  });
  it("a wrong secret is refused", async () => {
    await as(null, "anon");
    await expectCode(db.query(`select public.run_pending_digest('nope')`), "28000");
  });
});

describe("anon surface", () => {
  it("is exactly the seven server-secret / token functions", async () => {
    await admin();
    const r = await db.query<{ n: string }>(
      `select p.proname as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname in ('public', 'private') and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')
         and p.proname not in ('uid')
       order by 1`,
    );
    expect(r.rows.map((x) => x.n)).toEqual([
      "capture_purchase",
      "prune_push_subscription",
      "run_daily_reminders",
      "run_monthly_bills",
      "run_pending_digest",
      "tg_link_account",
      "tg_resolve_pending",
    ]);
  });
  it("anon cannot create or drop link codes", async () => {
    await as(null, "anon");
    await expectCode(db.query(`select public.create_telegram_link_code()`), "42501");
    await expectCode(db.query(`select public.unlink_telegram()`), "42501");
  });
});
