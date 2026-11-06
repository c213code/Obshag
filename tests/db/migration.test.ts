import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const C = "00000000-0000-0000-0000-00000000000c";
const D = "00000000-0000-0000-0000-00000000000d"; // outsider, member of nothing
const HA = "10000000-0000-0000-0000-00000000000a";
const HB = "10000000-0000-0000-0000-00000000000b";
const P1 = "20000000-0000-0000-0000-000000000001"; // shared, payer A, household A
const P2 = "20000000-0000-0000-0000-000000000002"; // personal, payer A
const P3 = "20000000-0000-0000-0000-000000000003"; // shared, payer B, household B

/** Mimics hosted Supabase: roles, auth.uid(), and its permissive DEFAULT privileges on `public`. */
const STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
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

const EXPECTED_TABLES = [
  "bills",
  "capture_tokens",
  "households",
  "members",
  "profiles",
  "purchases",
  "push_subscriptions",
  "reminder_log",
  "settlements",
  "shares",
];

let db: PGlite;

async function as(user: string | null, role: "authenticated" | "anon" | "service_role" = "authenticated") {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ""}', false); set role ${role};`);
}
async function admin() {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
}

/** Rejects with a Postgres error carrying the given SQLSTATE. */
async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code });
}
/** insufficient_privilege: covers both "permission denied" and "violates row-level security". */
const RLS = "42501";
const CHECK = "23514";
const FK = "23503";

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/0001_baseline.sql"), "utf8");
  await db.exec(sql); // the migration's own grants are all the clients get
  await db.exec(`
    insert into auth.users values ('${A}'),('${B}'),('${C}'),('${D}');
    insert into profiles(id, display_name) values ('${A}','A'),('${B}','B'),('${C}','C'),('${D}','D');
    -- the trigger makes created_by the first admin
    insert into households(id, name, invite_code, created_by) values
      ('${HA}','Квартира','CODE-A-0123456','${A}'),('${HB}','Дача','CODE-B-0123456','${B}');
    insert into members(household_id, user_id, role) values ('${HA}','${C}','member');
    insert into purchases(id, household_id, payer_id, amount, description, source, status) values
      ('${P1}','${HA}','${A}',6000,'Magnum','manual','shared'),
      ('${P2}','${HA}','${A}',900,'Моё','manual','personal'),
      ('${P3}','${HB}','${B}',1000,'Дрова','manual','shared');
    insert into shares(purchase_id, household_id, debtor_id, amount) values
      ('${P1}','${HA}','${C}',3000),
      ('${P2}','${HA}','${C}',900);
    insert into push_subscriptions(user_id, endpoint, p256dh, auth) values ('${A}','https://push.example/e1','k','a');
    insert into capture_tokens(user_id, token_hash) values ('${A}','hash-a');
  `);
});

afterAll(async () => {
  await db.close();
});

describe("schema shape", () => {
  it("has exactly the expected public tables, all with RLS enabled", async () => {
    await admin();
    const res = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' order by c.relname`,
    );
    expect(res.rows.map((r) => r.relname)).toEqual(EXPECTED_TABLES);
    expect(res.rows.filter((r) => !r.relrowsecurity)).toEqual([]);
  });

  it("keeps helper functions out of the exposed public schema", async () => {
    await admin();
    const res = await db.query<{ nspname: string; proname: string }>(
      `select n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public','private') order by 1, 2`,
    );
    expect(res.rows.filter((r) => r.nspname === "public").map((r) => r.proname)).toEqual(["create_household"]);
    expect(res.rows.filter((r) => r.nspname === "private").map((r) => r.proname)).toEqual(
      expect.arrayContaining(["is_member", "is_admin", "can_see_purchase", "shares_household_with"]),
    );
  });

  it("rejects invalid amounts and days (check constraints)", async () => {
    await admin();
    await expectCode(
      db.query(`insert into purchases(household_id, payer_id, amount, description) values ('${HA}','${A}',0,'x')`),
      CHECK,
    );
    await expectCode(
      db.query(`insert into bills(household_id, title, day_of_month, payer_id) values ('${HA}','t',29,'${A}')`),
      CHECK,
    );
  });

  it("rejects short invite codes (M2) and non-https push endpoints (H3)", async () => {
    await admin();
    await expectCode(
      db.query(`insert into households(name, invite_code, created_by) values ('x','SHORT1','${A}')`),
      CHECK,
    );
    await expectCode(
      db.query(`insert into push_subscriptions(user_id, endpoint, p256dh, auth) values ('${A}','http://evil','k','a')`),
      CHECK,
    );
    await expectCode(
      db.query(`insert into push_subscriptions(user_id, endpoint, p256dh, auth) values ('${A}','javascript:1','k','a')`),
      CHECK,
    );
  });

  it("enforces membership through composite foreign keys (C4)", async () => {
    await admin();
    // payer B is not a member of household A
    await expectCode(db.query(`insert into purchases(household_id, payer_id, amount) values ('${HA}','${B}',100)`), FK);
    // debtor B is not a member of household A
    await expectCode(
      db.query(`insert into shares(purchase_id, household_id, debtor_id, amount) values ('${P1}','${HA}','${B}',1)`),
      FK,
    );
    // settlement between a member and a non-member
    await expectCode(
      db.query(`insert into settlements(household_id, from_id, to_id, amount) values ('${HA}','${C}','${B}',1)`),
      FK,
    );
    // share whose household does not match its purchase
    await expectCode(
      db.query(`insert into shares(purchase_id, household_id, debtor_id, amount) values ('${P3}','${HA}','${C}',1)`),
      FK,
    );
  });
});

describe("reads (RLS)", () => {
  it("user A cannot select household B's purchases", async () => {
    await as(A);
    const res = await db.query<{ household_id: string }>(`select household_id from purchases`);
    expect(res.rows.length).toBeGreaterThan(0);
    expect(res.rows.every((r) => r.household_id === HA)).toBe(true);
  });

  it("user B sees only their own household", async () => {
    await as(B);
    const res = await db.query<{ description: string }>(`select description from purchases`);
    expect(res.rows.map((r) => r.description)).toEqual(["Дрова"]);
  });

  it("hides a personal purchase from other members, and its shares", async () => {
    await as(C);
    const p = await db.query<{ description: string }>(`select description from purchases order by description`);
    expect(p.rows.map((r) => r.description)).toEqual(["Magnum"]);
    const s = await db.query(`select * from shares where purchase_id = '${P2}'`);
    expect(s.rows).toEqual([]);
  });

  it("shows a personal purchase to its payer", async () => {
    await as(A);
    const p = await db.query(`select 1 from purchases where status = 'personal'`);
    expect(p.rows.length).toBe(1);
  });

  it("lets members read profiles of housemates only", async () => {
    await as(C);
    const r = await db.query<{ id: string }>(`select id from profiles order by id`);
    expect(r.rows.map((x) => x.id)).toEqual([A, C]);
  });

  it("keeps push subscriptions owner-only", async () => {
    await as(C);
    expect((await db.query(`select * from push_subscriptions`)).rows).toEqual([]);
    await as(A);
    expect((await db.query(`select * from push_subscriptions`)).rows.length).toBe(1);
  });

  it("only shows households the user belongs to", async () => {
    await as(D);
    expect((await db.query(`select * from households`)).rows).toEqual([]);
    await as(C);
    expect((await db.query<{ id: string }>(`select id from households`)).rows.map((r) => r.id)).toEqual([HA]);
  });
});

describe("members are locked down (C1, C2)", () => {
  it("cannot be inserted by a client, including the old creator self-insert", async () => {
    await as(D);
    await expectCode(db.query(`insert into members(household_id, user_id, role) values ('${HA}','${D}','admin')`), RLS);
    await as(A); // even an admin of the household
    await expectCode(db.query(`insert into members(household_id, user_id) values ('${HA}','${B}')`), RLS);
  });

  it("cannot be self-promoted, deactivated or removed by a client", async () => {
    await as(C);
    await expectCode(db.query(`update members set role = 'admin' where user_id = '${C}'`), RLS);
    await expectCode(db.query(`update members set active = false where user_id = '${C}'`), RLS);
    await expectCode(db.query(`update members set user_id = '${D}' where user_id = '${C}'`), RLS);
    await expectCode(db.query(`delete from members where user_id = '${C}'`), RLS);
    await as(A); // an admin cannot kick or demote through the table either
    await expectCode(db.query(`delete from members where user_id = '${C}'`), RLS);
    await expectCode(db.query(`update members set role = 'member' where user_id = '${C}'`), RLS);
  });

  it("lets a member update only their own away_until (positive control)", async () => {
    await as(C);
    const own = await db.query(`update members set away_until = '2026-12-01' where user_id = '${C}'`);
    expect(own.affectedRows).toBe(1);
    const other = await db.query(`update members set away_until = '2026-12-01' where user_id = '${A}'`);
    expect(other.affectedRows).toBe(0);
    await admin();
    const row = await db.query<{ away_until: string | null }>(
      `select away_until::text from members where user_id = '${A}' and household_id = '${HA}'`,
    );
    expect(row.rows[0].away_until).toBeNull();
  });
});

describe("households are locked down (C3)", () => {
  it("cannot be inserted directly by a client", async () => {
    await as(D);
    await expectCode(
      db.query(`insert into households(name, invite_code, created_by) values ('Мой','0123456789ab','${D}')`),
      RLS,
    );
  });

  it("can only be renamed by an admin, and no other column is writable", async () => {
    await as(A);
    expect((await db.query(`update households set name = 'Квартира 42' where id = '${HA}'`)).affectedRows).toBe(1);
    await expectCode(db.query(`update households set invite_code = 'AAAAAAAAAAAA' where id = '${HA}'`), RLS);
    await expectCode(db.query(`update households set created_by = '${C}' where id = '${HA}'`), RLS);
    await as(C);
    expect((await db.query(`update households set name = 'hack' where id = '${HA}'`)).affectedRows).toBe(0);
    await as(A);
    expect((await db.query(`update households set name = 'hack' where id = '${HB}'`)).affectedRows).toBe(0);
  });

  it("cannot be removed by a client", async () => {
    await as(A);
    await expectCode(db.query(`delete from households where id = '${HA}'`), RLS);
  });

  it("create_household makes the caller the admin with a server-side invite code (positive control)", async () => {
    await as(D);
    const res = await db.query<{ id: string; invite_code: string; created_by: string }>(
      `select * from create_household('  Моя квартира ')`,
    );
    const h = res.rows[0];
    expect(h.created_by).toBe(D);
    expect(h.invite_code.length).toBeGreaterThanOrEqual(10);
    const m = await db.query<{ role: string }>(
      `select role from members where household_id = '${h.id}' and user_id = '${D}'`,
    );
    expect(m.rows).toEqual([{ role: "admin" }]);
    const named = await db.query<{ name: string }>(`select name from households where id = '${h.id}'`);
    expect(named.rows[0].name).toBe("Моя квартира");
  });

  it("create_household refuses anonymous callers and empty names", async () => {
    await as(null);
    await expectCode(db.query(`select * from create_household('x')`), "28000");
    await as(D);
    await expectCode(db.query(`select * from create_household('')`), CHECK);
  });
});

describe("ledger is locked down (C4)", () => {
  it("shares are read-only for clients", async () => {
    await as(A);
    await expectCode(
      db.query(`insert into shares(purchase_id, household_id, debtor_id, amount) values ('${P1}','${HA}','${A}',1)`),
      RLS,
    );
    await expectCode(db.query(`update shares set amount = 0 where purchase_id = '${P1}'`), RLS);
    await expectCode(db.query(`delete from shares where purchase_id = '${P1}'`), RLS);
  });

  it("settlements are read-only for clients", async () => {
    await as(A);
    await expectCode(
      db.query(`insert into settlements(household_id, from_id, to_id, amount) values ('${HA}','${C}','${A}',100)`),
      RLS,
    );
    await expectCode(db.query(`update settlements set status = 'confirmed'`), RLS);
    await expectCode(db.query(`delete from settlements`), RLS);
  });

  it("a member inserts their own purchase (positive control)", async () => {
    await as(C);
    const r = await db.query(
      `insert into purchases(household_id, payer_id, amount, description) values ('${HA}','${C}',500,'Хлеб')`,
    );
    expect(r.affectedRows).toBe(1);
  });

  it("cannot record a purchase as somebody else, nor into a foreign household", async () => {
    await as(C);
    await expectCode(db.query(`insert into purchases(household_id, payer_id, amount) values ('${HA}','${A}',100)`), RLS);
    await as(A);
    await expectCode(db.query(`insert into purchases(household_id, payer_id, amount) values ('${HB}','${A}',100)`), RLS);
  });

  it("personal takeover: a member cannot flip, edit or remove someone else's purchase", async () => {
    await as(C);
    expect((await db.query(`update purchases set status = 'personal' where id = '${P1}'`)).affectedRows).toBe(0);
    expect((await db.query(`update purchases set description = 'hacked' where id = '${P1}'`)).affectedRows).toBe(0);
    expect((await db.query(`delete from purchases where id = '${P1}'`)).affectedRows).toBe(0);
    await admin();
    const row = await db.query<{ status: string; description: string }>(
      `select status, description from purchases where id = '${P1}'`,
    );
    expect(row.rows[0]).toEqual({ status: "shared", description: "Magnum" });
  });

  it("the payer may edit description/merchant/status but not amount, payer or household", async () => {
    await as(A);
    expect((await db.query(`update purchases set description = 'Magnum 2' where id = '${P1}'`)).affectedRows).toBe(1);
    await expectCode(db.query(`update purchases set amount = 1 where id = '${P1}'`), RLS);
    await expectCode(db.query(`update purchases set payer_id = '${C}' where id = '${P1}'`), RLS);
    await expectCode(db.query(`update purchases set household_id = '${HB}' where id = '${P1}'`), RLS);
  });
});

describe("server-only tables (H1, M3)", () => {
  it("reminder_log has no client access at all", async () => {
    await as(A);
    await expectCode(db.query(`insert into reminder_log(from_id, to_id) values ('${A}','${C}')`), RLS);
    await expectCode(db.query(`select * from reminder_log`), RLS);
    await expectCode(db.query(`delete from reminder_log`), RLS);
  });

  it("reminder_log is writable by the service role (positive control)", async () => {
    await as(null, "service_role");
    await db.query(`insert into reminder_log(from_id, to_id) values ('${A}','${C}')`);
    expect((await db.query(`select * from reminder_log`)).rows.length).toBe(1);
  });

  it("capture token hashes are unreadable and unwritable by clients", async () => {
    await as(A);
    await expectCode(db.query(`select token_hash from capture_tokens`), RLS);
    await expectCode(db.query(`select * from capture_tokens`), RLS);
    await expectCode(db.query(`insert into capture_tokens(user_id, token_hash) values ('${A}','mine')`), RLS);
    await expectCode(db.query(`update capture_tokens set last_used_at = now()`), RLS);
    const own = await db.query(`select user_id, created_at, last_used_at from capture_tokens`);
    expect(own.rows.length).toBe(1);
  });
});

describe("anon is locked out (H2)", () => {
  it("cannot read, write or call anything in public", async () => {
    await as(null, "anon");
    for (const table of EXPECTED_TABLES) {
      await expectCode(db.query(`select * from public.${table}`), RLS);
    }
    await expectCode(db.query(`insert into profiles(id) values ('${D}')`), RLS);
    await expectCode(db.query(`select * from create_household('x')`), RLS);
  });

  it("tables created later do not leak to anon or authenticated by default", async () => {
    await admin();
    await db.exec(`create table public.later_table(id int)`);
    await as(A);
    await expectCode(db.query(`select * from public.later_table`), RLS);
    await as(null, "anon");
    await expectCode(db.query(`select * from public.later_table`), RLS);
    await admin();
    await db.exec(`drop table public.later_table`);
  });

  it("cannot reach the private helpers", async () => {
    await as(null, "anon");
    await expectCode(db.query(`select private.is_member('${HA}')`), RLS);
  });
});

describe("last-admin guard (L1)", () => {
  it("refuses to remove, demote or deactivate the only admin", async () => {
    await admin();
    await expectCode(db.query(`delete from members where household_id = '${HA}' and user_id = '${A}'`), CHECK);
    await expectCode(
      db.query(`update members set role = 'member' where household_id = '${HA}' and user_id = '${A}'`),
      CHECK,
    );
    await expectCode(
      db.query(`update members set active = false where household_id = '${HA}' and user_id = '${A}'`),
      CHECK,
    );
  });

  it("allows it once another admin exists, and allows removing the whole household", async () => {
    await admin();
    await db.exec(`update members set role = 'admin' where household_id = '${HA}' and user_id = '${C}'`);
    await db.exec(`update members set active = false where household_id = '${HA}' and user_id = '${A}'`);
    await db.exec(`update members set active = true where household_id = '${HA}' and user_id = '${A}'`);
    await db.exec(`insert into households(id, name, invite_code, created_by) values
      ('10000000-0000-0000-0000-0000000000ff','Temp','TEMP-0123456789','${D}')`);
    await db.exec(`delete from households where id = '10000000-0000-0000-0000-0000000000ff'`);
    await db.exec(`update members set role = 'member' where household_id = '${HA}' and user_id = '${C}'`);
  });
});
