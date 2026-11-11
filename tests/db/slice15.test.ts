import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const A = "00000000-0000-0000-0000-00000000000a"; // admin (creator), joined first
const B = "00000000-0000-0000-0000-00000000000b";
const C = "00000000-0000-0000-0000-00000000000c";
const E = "00000000-0000-0000-0000-00000000000e"; // outsider
const SECRET = "slice15-secret";

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
  "0011_slice13_min_transfer.sql",
  "0012_slice14_duty.sql",
  "0013_slice15_trash_water.sql",
  "0014_slice16_queue_fix_bill_icons.sql",
  "0015_slice17_paid_prompt.sql",
  "0016_slice18_orders_payer.sql",
];

let db: PGlite;
let hh: string;
let trash: string;
let water: string;

async function as(user: string | null, role: "authenticated" | "anon" = "authenticated") {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ""}', false); set role ${role};`);
}
async function admin() {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
}
async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code });
}
async function current(duty: string): Promise<string> {
  await admin();
  return (await db.query<{ u: string }>(`select private.duty_current($1) u`, [duty])).rows[0].u;
}
async function create(kind: "trash" | "water", order: string[] = [A, B, C]): Promise<string> {
  await as(A);
  const r = await db.query<{ id: string }>(`select id from public.create_duty($1, $2, $3, null, $4)`, [hh, kind, kind, order]);
  return r.rows[0].id;
}
async function done(user: string, duty = trash) {
  await as(user);
  return (await db.query<{ id: string }>(`select * from public.duty_done_event($1)`, [duty])).rows[0];
}
async function brought(user: string, partner: string | null) {
  await as(user);
  return (await db.query<{ id: string; purchase_id: string; liters: number }>(`select * from public.water_brought($1, $2)`, [water, partner])).rows[0];
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUB);
  for (const file of MIGRATIONS) await db.exec(readFileSync(join(process.cwd(), "supabase/migrations", file), "utf8"));
  await db.exec(`insert into auth.users values ('${A}'),('${B}'),('${C}'),('${E}');`);
  for (const [id, name] of [[A, "Ерасыл"], [B, "Айдос"], [C, "Даня"], [E, "Чужой"]]) {
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
  await db.exec(`update public.members set joined_at = now() - interval '3 days' where user_id = '${A}';
    update public.members set joined_at = now() - interval '2 days' where user_id = '${B}';
    update public.members set joined_at = now() - interval '1 days' where user_id = '${C}';`);
  await db.exec(`insert into private.server_secrets values ('cron', encode(extensions.digest('${SECRET}', 'sha256'), 'hex'))`);
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await admin();
  await db.exec(`truncate public.duties cascade; truncate public.purchases cascade;
    update public.members set active = true, away_until = null;`);
  trash = await create("trash");
  water = await create("water");
});

describe("pointer", () => {
  it("starts with the first member and moves past whoever carried last", async () => {
    expect(await current(trash)).toBe(A);
    await done(A);
    expect(await current(trash)).toBe(B);
    await done(C); // out of turn: the pointer walks on from the actor
    expect(await current(trash)).toBe(A);
  });
  it("skips members who are away or inactive, and wraps", async () => {
    await done(A);
    await admin();
    await db.exec(`update public.members set away_until = (now() at time zone 'Asia/Almaty')::date where user_id = '${B}'`);
    expect(await current(trash)).toBe(C);
    await db.exec(`update public.members set active = false where user_id = '${C}'`);
    expect(await current(trash)).toBe(B); // nobody else is home: the plain next after the actor
  });
  it("falls back to the plain next member when everybody is away", async () => {
    await admin();
    await db.exec(`update public.members set away_until = (now() at time zone 'Asia/Almaty')::date + 3`);
    expect(await current(trash)).toBe(A);
  });
  it("water for two moves the pointer past both", async () => {
    await brought(A, C);
    expect(await current(water)).toBe(B); // from the actor A, skipping A and C
    await brought(B, null);
    expect(await current(water)).toBe(C);
    await brought(A, B);
    expect(await current(water)).toBe(C);
  });
});

describe("pointer from the actor (0014)", () => {
  it("actor last in order with a partner: the first member who stayed home", async () => {
    await admin();
    await db.exec(`update public.duty_members set position = position + 10 where duty_id = '${water}'; update public.duty_members set position = case user_id when '${A}' then 0 when '${B}' then 1 when '${C}' then 2 end where duty_id = '${water}'`);
    await brought(C, A);
    expect(await current(water)).toBe(B); // not A who just went
  });
  it("order C,A,B: C with B goes to A", async () => {
    await admin();
    await db.exec(`update public.duty_members set position = position + 10 where duty_id = '${water}'; update public.duty_members set position = case user_id when '${C}' then 0 when '${A}' then 1 when '${B}' then 2 end where duty_id = '${water}'`);
    await brought(C, B);
    expect(await current(water)).toBe(A);
  });
  it("solo trash moves on to the next member", async () => {
    await done(B);
    expect(await current(trash)).toBe(C);
  });
  it("all others away: plain next after the actor", async () => {
    await done(A);
    await admin();
    await db.exec(`update public.members set away_until = (now() at time zone 'Asia/Almaty')::date + 3 where user_id <> '${A}'`);
    expect(await current(trash)).toBe(B);
  });
});

describe("bill icons (0014)", () => {
  it("accepts the five new icons and rejects the old ones", async () => {
    await as(A);
    for (const icon of ["home", "internet", "gas", "utility", "receipt"]) {
      await db.query(`select public.upsert_bill($1, null, 'X', $2, 5000, false, 3, $3, $4)`, [hh, icon, A, [A, B]]);
    }
    await expectCode(db.query(`select public.upsert_bill($1, null, 'X', 'bolt', 5000, false, 3, $2, $3)`, [hh, A, [A, B]]), "23514");
  });
});

describe("Мусор", () => {
  it("any member can mark done; an outsider and a wrong kind cannot", async () => {
    await done(C);
    await as(E);
    await expectCode(db.query(`select * from public.duty_done_event($1)`, [trash]), "42501");
    await as(A);
    await expectCode(db.query(`select * from public.duty_done_event($1)`, [water]), "23514");
    await expectCode(db.query(`select * from public.duty_ping($1)`, [water]), "23514");
  });
  it("ping records the current person as the target, with a 2 hour cooldown", async () => {
    await as(C);
    const e = (await db.query<{ partner_id: string; id: string }>(`select * from public.duty_ping($1)`, [trash])).rows[0];
    expect(e.partner_id).toBe(A);
    await as(B);
    await expect(db.query(`select * from public.duty_ping($1)`, [trash])).rejects.toMatchObject({ code: "P0001", message: "rate_limited" });
    await admin();
    await db.exec(`update public.duty_events set created_at = now() - interval '2 hours 1 minute'`);
    await as(B);
    await db.query(`select * from public.duty_ping($1)`, [trash]);
  });
  it("the cooldown hint carries the seconds left", async () => {
    await as(B);
    await db.query(`select * from public.duty_ping($1)`, [trash]);
    const err = await db.query(`select * from public.duty_ping($1)`, [trash]).catch((e: { hint?: string }) => e);
    expect(Number((err as { hint?: string }).hint)).toBeGreaterThan(7000);
  });
});

describe("Вода", () => {
  it("alone: 2 bottles, 10 L, 200 tenge as a shared purchase split three ways", async () => {
    const e = await brought(A, null);
    expect(e.liters).toBe(10);
    await admin();
    const p = (await db.query<{ amount: number; description: string; payer_id: string; status: string }>(`select * from public.purchases where id = $1`, [e.purchase_id])).rows[0];
    expect(p).toMatchObject({ amount: 200, description: "Вода 10 л", payer_id: A, status: "shared" });
    const shares = (await db.query<{ debtor_id: string; amount: number; settled_at: string | null }>(`select * from public.shares where purchase_id = $1 order by debtor_id`, [e.purchase_id])).rows;
    expect(shares.reduce((s, x) => s + x.amount, 0)).toBe(200);
    expect(shares.find((s) => s.debtor_id === A)?.settled_at).not.toBeNull();
    expect((await db.query<{ n: number }>(`select bottles_full n from public.duties where id = $1`, [water])).rows[0].n).toBe(2);
  });
  it("with a partner: 4 bottles, 20 L, 400 tenge, the event keeps partner and purchase", async () => {
    const e = await brought(B, A);
    expect(e.liters).toBe(20);
    await admin();
    const r = (await db.query<{ partner_id: string; amount: number; n: number }>(
      `select e.partner_id, p.amount, d.bottles_full n from public.duty_events e join public.purchases p on p.id = e.purchase_id
       join public.duties d on d.id = e.duty_id where e.id = $1`, [e.id],
    )).rows[0];
    expect(r).toMatchObject({ partner_id: A, amount: 400, n: 4 });
  });
  it("splits only between members who are home", async () => {
    await admin();
    await db.exec(`update public.members set away_until = (now() at time zone 'Asia/Almaty')::date where user_id = '${C}'`);
    const e = await brought(A, null);
    await admin();
    const rows = (await db.query<{ debtor_id: string; amount: number }>(`select * from public.shares where purchase_id = $1`, [e.purchase_id])).rows;
    expect(rows.map((x) => x.debtor_id).sort()).toEqual([A, B]);
    expect(rows.every((x) => x.amount === 100)).toBe(true);
  });
  it("rejects a partner who is yourself or an outsider", async () => {
    await as(A);
    await expectCode(db.query(`select * from public.water_brought($1, $2)`, [water, A]), "23514");
    await expectCode(db.query(`select * from public.water_brought($1, $2)`, [water, E]), "23514");
    await as(E);
    await expectCode(db.query(`select * from public.water_brought($1, null)`, [water]), "42501");
  });
  it("empty sets the bottles to 0 with a 1 hour cooldown; a used bottle never goes below 0", async () => {
    await brought(A, B);
    await as(C);
    const e = (await db.query<{ partner_id: string }>(`select * from public.water_empty($1)`, [water])).rows[0];
    expect(e.partner_id).toBe(C);
    await expect(db.query(`select * from public.water_empty($1)`, [water])).rejects.toMatchObject({ message: "rate_limited" });
    await admin();
    expect((await db.query<{ n: number }>(`select bottles_full n from public.duties where id = $1`, [water])).rows[0].n).toBe(0);
    await as(B);
    const d = (await db.query<{ bottles_full: number }>(`select * from public.water_bottle_used($1)`, [water])).rows[0];
    expect(d.bottles_full).toBe(0);
    await brought(B, null);
    await as(B);
    expect((await db.query<{ bottles_full: number }>(`select * from public.water_bottle_used($1)`, [water])).rows[0].bottles_full).toBe(1);
  });
  it("only an admin sets the price, and it changes the next purchase", async () => {
    await as(B);
    await expectCode(db.query(`select * from public.set_water_price($1, 30)`, [water]), "42501");
    await as(A);
    await expectCode(db.query(`select * from public.set_water_price($1, 0)`, [water]), "23514");
    await db.query(`select * from public.set_water_price($1, 30)`, [water]);
    const e = await brought(A, B);
    await admin();
    expect((await db.query<{ amount: number }>(`select amount from public.purchases where id = $1`, [e.purchase_id])).rows[0].amount).toBe(600);
  });
});

describe("notice, morning, security", () => {
  it("duty_event_notice needs the secret and your own fresh ping; never reaches the actor's own devices", async () => {
    await as(B);
    const ping = (await db.query<{ id: string }>(`select * from public.duty_ping($1)`, [trash])).rows[0];
    const n = (await db.query<{ n: { target_user: string; kind: string; subscriptions: unknown[]; self: boolean } }>(
      `select public.duty_event_notice($1, $2) n`, [SECRET, ping.id],
    )).rows[0].n;
    expect(n).toMatchObject({ target_user: A, kind: "ping", subscriptions: [], self: false });
    await expectCode(db.query(`select public.duty_event_notice('nope', $1)`, [ping.id]), "28000");
    await as(C);
    await expectCode(db.query(`select public.duty_event_notice($1, $2)`, [SECRET, ping.id]), "42501");
    await as(null, "anon");
    await expectCode(db.query(`select public.duty_event_notice($1, $2)`, [SECRET, ping.id]), "42501");
  });
  it("the 09:00 run ignores event duties", async () => {
    await admin();
    await db.exec(`truncate private.duty_morning_log`);
    const r = (await db.query<{ r: unknown[] }>(`select public.run_duty_morning($1) r`, [SECRET])).rows[0].r;
    expect(r).toHaveLength(0);
  });
  it("members read events, outsiders do not, nobody writes tables", async () => {
    await done(A);
    await as(B);
    expect((await db.query(`select * from public.duty_events`)).rows).toHaveLength(1);
    await expectCode(db.query(`insert into public.duty_events (duty_id, kind, user_id) values ($1, 'done', $2)`, [trash, B]), "42501");
    await as(E);
    expect((await db.query(`select * from public.duty_events`)).rows).toHaveLength(0);
    await as(B);
    await expectCode(db.query(`select private.duty_current($1)`, [trash]), "42501");
  });
  it("the anon surface is exactly ten (0015 adds tg_answer_paid, 0016 adds none)", async () => {
    await admin();
    const r = await db.query<{ n: string }>(
      `select p.proname n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname in ('public', 'private') and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')
         and p.proname not in ('uid')
       order by 1`,
    );
    expect(r.rows).toHaveLength(10);
    expect(r.rows.map((x) => x.n)).not.toContain("duty_event_notice");
  });
  it("every new function is security definer with an empty search_path", async () => {
    await admin();
    const r = await db.query<{ definer: boolean; cfg: string[] | null }>(
      `select p.prosecdef definer, p.proconfig cfg from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname = 'public' and p.proname in ('duty_done_event','duty_ping','water_empty','water_brought','water_bottle_used','set_water_price','duty_event_notice')`,
    );
    expect(r.rows).toHaveLength(7);
    for (const f of r.rows) {
      expect(f.definer).toBe(true);
      expect(f.cfg).toContain(`search_path=""`);
    }
  });
});
