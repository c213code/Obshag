import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { splitEqual } from "@/lib/domain/split";

const A = "00000000-0000-0000-0000-00000000000a"; // creator / admin
const B = "00000000-0000-0000-0000-00000000000b"; // joins by code
const C = "00000000-0000-0000-0000-00000000000c"; // joins by code
const D = "00000000-0000-0000-0000-00000000000d"; // outsider with a profile, never joins
const E = "00000000-0000-0000-0000-00000000000e"; // signed in, no profile (until the first test)
const F = "00000000-0000-0000-0000-00000000000f"; // brute-forcer, joins at the end of its test

/** Mimics hosted Supabase: roles, auth.uid(), and its permissive default privileges on `public`. */
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

let db: PGlite;
let household: { id: string; invite_code: string };

async function as(user: string | null, role: "authenticated" | "anon" = "authenticated") {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ""}', false); set role ${role};`);
}
async function admin() {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
}
async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code });
}

const MIGRATIONS = ["0001_baseline.sql", "0002_slice1_rpcs.sql"];

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  for (const file of MIGRATIONS) await db.exec(readFileSync(join(process.cwd(), "supabase/migrations", file), "utf8"));
  await db.exec(`insert into auth.users values ('${A}'),('${B}'),('${C}'),('${D}'),('${E}'),('${F}');`);
  for (const [id, name] of [
    [A, "Ерасыл"],
    [B, "Айдос"],
    [C, "Даня"],
    [D, "Чужой"],
    [F, "Перебор"],
  ]) {
    await as(id);
    await db.query(`select public.upsert_profile($1, '+77001234567')`, [name]);
  }
  await as(A);
  const res = await db.query<{ id: string; invite_code: string }>(`select * from public.create_household('Квартира 42')`);
  household = res.rows[0];
});

afterAll(async () => {
  await db.close();
});

describe("upsert_profile", () => {
  it("creates and updates the caller's own profile, picking an avatar color once", async () => {
    await as(E);
    const first = await db.query<{ id: string; display_name: string; kaspi_phone: string; avatar_color: string }>(
      `select * from public.upsert_profile('  Новый  ', '+77019998877')`,
    );
    expect(first.rows[0]).toMatchObject({ id: E, display_name: "Новый", kaspi_phone: "+77019998877" });
    expect(first.rows[0].avatar_color).toMatch(/^(blue|brown|purple)$/);
    const again = await db.query<{ display_name: string; avatar_color: string }>(
      `select * from public.upsert_profile('Новее', '+77019998877')`,
    );
    expect(again.rows[0]).toMatchObject({ display_name: "Новее", avatar_color: first.rows[0].avatar_color });
    // back to "signed in, no profile yet" for the join tests below
    await admin();
    await db.query(`delete from public.profiles where id = $1`, [E]);
  });

  it("rejects bad input and unauthenticated callers", async () => {
    await as(E);
    await expectCode(db.query(`select public.upsert_profile('', '+77019998877')`), "23514");
    await expectCode(db.query(`select public.upsert_profile('x', '8700123')`), "23514");
    await expectCode(db.query(`select public.upsert_profile(repeat('x', 41), '+77019998877')`), "23514");
    await as(null);
    await expectCode(db.query(`select public.upsert_profile('x', '+77019998877')`), "28000");
    await as(null, "anon");
    await expectCode(db.query(`select public.upsert_profile('x', '+77019998877')`), "42501");
  });
});

describe("create_household and join_household", () => {
  it("makes the creator an admin and generates the code server-side", async () => {
    await admin();
    expect(household.invite_code.length).toBeGreaterThanOrEqual(10);
    const m = await db.query(`select user_id, role, active from public.members where household_id = '${household.id}'`);
    expect(m.rows).toEqual([{ user_id: A, role: "admin", active: true }]);
  });

  it("joins with a good code (any case, with spaces) and is idempotent", async () => {
    await as(B);
    const joined = await db.query<{ id: string }>(`select * from public.join_household($1)`, [household.invite_code]);
    expect(joined.rows[0].id).toBe(household.id);
    await db.query(`select * from public.join_household($1)`, [household.invite_code]);
    await as(C);
    const spaced = household.invite_code.toLowerCase().replace(/^(.{4})/, "$1 ");
    const viaLower = await db.query<{ id: string }>(`select * from public.join_household($1)`, [spaced]);
    expect(viaLower.rows[0].id).toBe(household.id);
    await admin();
    const members = await db.query<{ user_id: string; role: string }>(
      `select user_id, role from public.members where household_id = '${household.id}'`,
    );
    expect(members.rows).toHaveLength(3);
    expect(members.rows.filter((r) => r.role === "admin").map((r) => r.user_id)).toEqual([A]);
  });

  it("returns NULL (no row, no detail) for a wrong code and records the attempt", async () => {
    await as(D);
    const res = await db.query<{ id: string | null }>(`select (public.join_household('NOPE0000000000')).id as id`);
    expect(res.rows[0].id).toBeNull();
    await admin();
    const n = await db.query<{ n: number }>(`select count(*)::int as n from private.join_attempts where user_id = '${D}'`);
    expect(n.rows[0].n).toBe(1);
    expect((await db.query(`select * from public.members where user_id = '${D}'`)).rows).toEqual([]);
  });

  it("rate limits to 10 attempts per hour: even the right code then fails with the generic error", async () => {
    await as(F);
    for (let i = 0; i < 10; i++) await db.query(`select public.join_household('WRONGCODE${i}XX')`);
    await expect(db.query(`select public.join_household($1)`, [household.invite_code])).rejects.toMatchObject({
      code: "P0001",
      message: "join_failed",
    });
    await admin();
    expect((await db.query(`select 1 from public.members where user_id = '${F}'`)).rows).toEqual([]);
    // the window slides: attempts older than an hour stop counting
    await db.exec(`update private.join_attempts set at = now() - interval '2 hours' where user_id = '${F}'`);
    await as(F);
    const ok = await db.query<{ id: string }>(`select * from public.join_household($1)`, [household.invite_code]);
    expect(ok.rows[0].id).toBe(household.id);
  });

  it("a code longer than 64 characters is a plain miss, and the attempt is still recorded", async () => {
    await as(D);
    const res = await db.query<{ id: string | null }>(`select (public.join_household($1)).id as id`, ["A".repeat(65)]);
    expect(res.rows[0].id).toBeNull();
    await admin();
    const n = await db.query<{ n: number }>(`select count(*)::int as n from private.join_attempts where user_id = '${D}'`);
    expect(n.rows[0].n).toBe(2); // the wrong-code test above recorded the first one
  });

  it("serializes a user's attempts with an advisory lock (the rate limit cannot be raced)", async () => {
    await admin();
    const src = await db.query<{ prosrc: string }>(`select prosrc from pg_proc where proname = 'join_household'`);
    const body = src.rows[0].prosrc;
    const lock = body.indexOf("pg_advisory_xact_lock");
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(body.indexOf("select count(*)"));
  });

  it("rejoining after leaving never restores an old admin role", async () => {
    // B was promoted, left, and comes back with the code
    await admin();
    await db.exec(`update public.members set role = 'admin', active = false, away_until = current_date + 5
                   where household_id = '${household.id}' and user_id = '${B}'`);
    await as(B);
    await db.query(`select * from public.join_household($1)`, [household.invite_code]);
    await admin();
    const m = await db.query(`select role, active, away_until from public.members where household_id = '${household.id}' and user_id = '${B}'`);
    expect(m.rows[0]).toEqual({ role: "member", active: true, away_until: null });
    // an ACTIVE admin who types the code again keeps the role
    await as(A);
    await db.query(`select * from public.join_household($1)`, [household.invite_code]);
    await admin();
    const a = await db.query(`select role from public.members where household_id = '${household.id}' and user_id = '${A}'`);
    expect(a.rows[0]).toEqual({ role: "admin" });
  });

  it("needs a profile and a session", async () => {
    await as(E);
    await expect(db.query(`select public.join_household($1)`, [household.invite_code])).rejects.toMatchObject({
      message: "profile_required",
    });
    await expectCode(db.query(`select public.create_household('Дача')`), "23503");
    await as(null);
    await expectCode(db.query(`select public.join_household('x')`), "28000");
  });

  it("a non-member cannot join without a code: no direct inserts, no reads", async () => {
    await as(D);
    await expectCode(
      db.query(`insert into public.members(household_id, user_id) values ('${household.id}', '${D}')`),
      "42501",
    );
    expect((await db.query(`select * from public.households`)).rows).toEqual([]);
    expect((await db.query(`select * from public.members`)).rows).toEqual([]);
  });

  it("is not callable by anon", async () => {
    await as(null, "anon");
    await expectCode(db.query(`select public.join_household('x')`), "42501");
  });
});

describe("create_purchase_with_shares", () => {
  // members by now: A (admin), B, C, F
  const create = async (who: string, amount: number, participants: string[], description = "Хлеб, картошка") => {
    await as(who);
    return db.query<{ id: string }>(`select public.create_purchase_with_shares($1, $2, $3, null, $4::uuid[])->>'id' as id`, [
      household.id,
      amount,
      description,
      `{${participants.join(",")}}`,
    ]);
  };
  const sharesOf = async (purchaseId: string) => {
    await admin();
    const r = await db.query<{ debtor_id: string; amount: number; settled: boolean }>(
      `select debtor_id, amount, settled_at is not null as settled from public.shares where purchase_id = $1`,
      [purchaseId],
    );
    return r.rows;
  };

  it("6000 among 4: the payer share is settled, the rest open at 1500", async () => {
    const members = [A, B, C, F];
    const { rows } = await create(A, 6000, members);
    const shares = await sharesOf(rows[0].id);
    const byDebtor = new Map(shares.map((s) => [s.debtor_id, s]));
    expect(members.map((m) => byDebtor.get(m)?.amount)).toEqual([1500, 1500, 1500, 1500]);
    expect(byDebtor.get(A)?.settled).toBe(true);
    expect(shares.filter((s) => s.debtor_id !== A).every((s) => !s.settled)).toBe(true);
    const p = await db.query(`select payer_id, status, source, amount, merchant from public.purchases where id = $1`, [
      rows[0].id,
    ]);
    expect(p.rows[0]).toEqual({ payer_id: A, status: "shared", source: "manual", amount: 6000, merchant: null });
  });

  it("returns the saved purchase with its shares in one round trip", async () => {
    await as(A);
    const res = await db.query<{ p: { id: string; payer_id: string; amount: number; description: string; shares: Array<Record<string, unknown>> } }>(
      `select public.create_purchase_with_shares($1, 100, 'Вода', null, $2::uuid[]) as p`,
      [household.id, `{${A},${B}}`],
    );
    const p = res.rows[0].p;
    expect(p).toMatchObject({ payer_id: A, amount: 100, description: "Вода", status: "shared", source: "manual" });
    expect(p.shares).toHaveLength(2);
    expect(p.shares.map((s) => Object.keys(s).sort())).toEqual(
      Array(2).fill(["amount", "debtor_id", "purchase_id", "settled_at", "settlement_id"]),
    );
    expect(p.shares.every((s) => s.purchase_id === p.id)).toBe(true);
    expect(p.shares.find((s) => s.debtor_id === A)?.settled_at).not.toBeNull();
  });

  it("rejects an amount smaller than the number of people (no 0 tenge shares) and more than 50 people", async () => {
    await expectCode(create(A, 2, [A, B, C]), "23514");
    const ok = await create(A, 3, [A, B, C]);
    expect((await sharesOf(ok.rows[0].id)).map((s) => s.amount)).toEqual([1, 1, 1]);
    const many = Array.from({ length: 51 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`);
    await expectCode(create(A, 1000, many), "23514");
  });

  it("bounds descriptions and merchants", async () => {
    await expectCode(create(A, 100, [A], "x".repeat(201)), "23514");
    await as(A);
    await expectCode(
      db.query(`select public.create_purchase_with_shares($1, 100, 'x', $2, '{${A}}')`, [household.id, "m".repeat(121)]),
      "23514",
    );
  });

  it("matches splitEqual for many amounts, group sizes and payer positions (remainders included)", async () => {
    const pool = [A, B, C, F];
    for (const n of [1, 2, 3, 4]) {
      for (const amount of [4, 5, 7, 100, 1001, 1002, 1003, 6001, 9_999_999]) {
        for (const payer of pool.slice(0, n)) {
          // rotate the participant order so the payer sits in different positions
          const group = pool.slice(0, n);
          const idx = group.indexOf(payer);
          const participants = [...group.slice(idx), ...group.slice(0, idx)];
          const { rows } = await create(payer, amount, participants);
          const sql = await sharesOf(rows[0].id);
          const expected = splitEqual(amount, participants, payer);
          expect(participants.map((p) => sql.find((s) => s.debtor_id === p)?.amount)).toEqual(
            expected.map((s) => s.amount),
          );
          expect(sql.map((s) => s.amount).reduce((x, y) => x + y, 0)).toBe(amount);
          expect(sql.filter((s) => s.settled).map((s) => s.debtor_id)).toEqual([payer]);
        }
      }
    }
  }, 120_000);

  it("allows a payer who is not among the participants: everyone listed owes", async () => {
    const { rows } = await create(A, 100, [B, C, F]);
    const shares = await sharesOf(rows[0].id);
    expect(shares.map((s) => s.amount).sort()).toEqual([33, 33, 34]);
    expect(shares.every((s) => !s.settled)).toBe(true);
  });

  it("rejects non-members, non-member participants, inactive participants and bad input", async () => {
    await expectCode(create(D, 100, [D]), "42501");
    await expectCode(create(A, 100, [A, D]), "23503");
    await admin();
    await db.exec(`update public.members set active = false where household_id = '${household.id}' and user_id = '${F}'`);
    await expectCode(create(A, 100, [A, F]), "23503");
    await admin();
    await db.exec(`update public.members set active = true where household_id = '${household.id}' and user_id = '${F}'`);
    await expectCode(create(A, 0, [A]), "23514");
    await expectCode(create(A, 10_000_001, [A]), "23514");
    await expectCode(create(A, 100, []), "23514");
    await expectCode(create(A, 100, [A, A]), "23514");
    await expectCode(create(A, 100, [A], "   "), "23514");
    await as(null);
    await expectCode(
      db.query(`select public.create_purchase_with_shares($1, 100, 'x', null, '{}')`, [household.id]),
      "28000",
    );
  });

  it("is atomic: a rejected call leaves no purchase behind", async () => {
    await admin();
    const before = await db.query<{ n: number }>(`select count(*)::int as n from public.purchases`);
    await expectCode(create(A, 100, [A, D]), "23503");
    await admin();
    const after = await db.query<{ n: number }>(`select count(*)::int as n from public.purchases`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("clients cannot insert purchases directly (only the RPC), nor change their status or amount", async () => {
    await as(A);
    await expectCode(
      db.query(`insert into public.purchases(household_id, payer_id, amount, description) values ('${household.id}', '${A}', 100, 'x')`),
      "42501",
    );
    // update grant: description and merchant only
    const own = await db.query<{ id: string }>(`select id from public.purchases where payer_id = '${A}' limit 1`);
    const id = own.rows[0].id;
    expect((await db.query(`update public.purchases set description = 'Правка' where id = '${id}'`)).affectedRows).toBe(1);
    await expectCode(db.query(`update public.purchases set status = 'personal' where id = '${id}'`), "42501");
    await expectCode(db.query(`update public.purchases set amount = 1 where id = '${id}'`), "42501");
  });

  it("table checks bound description, merchant and amount even for privileged writers", async () => {
    await admin();
    const ins = (amount: number, desc: string, merchant: string | null) =>
      db.query(
        `insert into public.purchases(household_id, payer_id, amount, description, merchant) values ('${household.id}', '${A}', $1, $2, $3)`,
        [amount, desc, merchant],
      );
    await expectCode(ins(100, "", null), "23514");
    await expectCode(ins(100, "x".repeat(201), null), "23514");
    await expectCode(ins(100, "x", "m".repeat(121)), "23514");
    await expectCode(ins(10_000_001, "x", null), "23514");
    expect((await ins(10_000_000, "x".repeat(200), "m".repeat(120))).affectedRows).toBe(1);
  });

  it("clients still cannot write shares directly, and non-members cannot read them", async () => {
    await as(B);
    await expectCode(
      db.query(
        `insert into public.shares(purchase_id, household_id, debtor_id, amount)
         select id, household_id, '${B}', 1 from public.purchases limit 1`,
      ),
      "42501",
    );
    await as(D);
    expect((await db.query(`select * from public.purchases`)).rows).toEqual([]);
    expect((await db.query(`select * from public.shares`)).rows).toEqual([]);
  });
});

describe("function hygiene", () => {
  it("every public RPC is security definer with an empty search_path and no anon execute", async () => {
    await admin();
    const fns = await db.query<{ proname: string; prosecdef: boolean; proconfig: string[] | null }>(
      `select proname, prosecdef, proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' order by proname`,
    );
    expect(fns.rows.map((f) => f.proname)).toEqual([
      "create_household",
      "create_purchase_with_shares",
      "join_household",
      "upsert_profile",
    ]);
    for (const f of fns.rows) {
      expect(f.prosecdef).toBe(true);
      expect(f.proconfig).toContain('search_path=""');
    }
    const anon = await db.query<{ ok: boolean }>(
      `select has_function_privilege('anon', 'public.join_household(text)', 'execute')
           or has_function_privilege('anon', 'public.create_purchase_with_shares(uuid, integer, text, text, uuid[])', 'execute')
           or has_function_privilege('anon', 'public.upsert_profile(text, text)', 'execute') as ok`,
    );
    expect(anon.rows[0].ok).toBe(false);
  });

  it("private.join_attempts is unreachable for clients", async () => {
    await as(A);
    await expectCode(db.query(`select * from private.join_attempts`), "42501");
  });
});
