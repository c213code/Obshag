import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resolveDay, type DutyState } from "../../src/lib/domain/duty";

const A = "00000000-0000-0000-0000-00000000000a"; // admin, member 0 of the rotation
const B = "00000000-0000-0000-0000-00000000000b";
const C = "00000000-0000-0000-0000-00000000000c";
const D = "00000000-0000-0000-0000-00000000000d";
const X = "00000000-0000-0000-0000-00000000000e"; // a stranger
const SECRET = "slice24-secret";
const ORDER = [A, B, C, D];
const CHAT = -100123456;

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
  "0017_slice19_inflight_paylinks.sql",
  "0018_slice20_capture_dm.sql",
  "0019_slice21_purchase_paybuttons.sql",
  "0020_slice22_small_dates_noconfirm.sql",
  "0021_slice23_away_for.sql",
  "0022_slice24_queue_shift_delete_paid.sql",
  "0023_slice25_plain_delete_received.sql",
];
const FAKE_TG = `
  create schema net;
  create table public.fake_http (url text, body jsonb);
  create function net.http_post(url text, body jsonb default null, params jsonb default null, headers jsonb default null, timeout_milliseconds integer default 1000)
    returns bigint language sql as $$ insert into public.fake_http values (url, body) returning 1::bigint $$;
  create schema vault;
  create view vault.decrypted_secrets as select 'telegram_bot_token'::text as name, 'tok'::text as decrypted_secret;
`;

let db: PGlite;
let hh: string;

async function as(user: string | null, role: "authenticated" | "anon" = "authenticated") {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ""}', false); set role ${role};`);
}
async function admin() {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
}
/** An Asia/Almaty date n days from today (pure JS, never touches the session role). */
const day = (n: number): string => new Date(Date.now() + 5 * 3600_000 + n * 86400_000).toISOString().slice(0, 10);
const texts = async (): Promise<string[]> => {
  await admin();
  return (await db.query<{ body: { text: string } }>(`select body from public.fake_http`)).rows.map((r) => r.body.text);
};

async function newDuty(startOffset: number): Promise<string> {
  await admin();
  await db.exec(`delete from public.duties`);
  await as(A);
  const r = await db.query<{ id: string }>(`select id from public.create_duty($1, 'cooking', 'Готовка', $2, $3)`, [hh, day(startOffset), ORDER]);
  return r.rows[0].id;
}
type Row = { d: string; u: string; s: string; k: string | null };
async function schedule(duty: string, from: number, to: number): Promise<Row[]> {
  await as(A);
  return (
    await db.query<Row>(`select day::text d, user_id u, source s, skipped_user k from public.duty_schedule($1, $2, $3)`, [duty, day(from), day(to)])
  ).rows;
}
const cooks = async (duty: string, from: number, to: number) => (await schedule(duty, from, to)).map((r) => r.u);
const awayDb = async (user: string, until: string | null) => {
  await admin();
  await db.query(`update public.members set away_until = $1 where household_id = $2 and user_id = $3`, [until, hh, user]);
};
const backfillAgain = async () => {
  await admin();
  await db.exec(`delete from public.duty_chain; select private.duty_chain_backfill();`); // the migration's backfill
};
/** The DB state as a duty.ts DutyState, to prove both walks agree. */
async function tsState(duty: string): Promise<DutyState> {
  await admin();
  const d = (await db.query<{ start_date: string }>(`select start_date::text from public.duties where id = $1`, [duty])).rows[0];
  const roster = (await db.query<{ user_id: string; active: boolean; away: string | null }>(`select user_id, active, away_until::text as away from public.members where household_id = $1`, [hh])).rows;
  const chain = (await db.query<{ day: string; user_id: string }>(`select day::text, user_id from public.duty_chain where duty_id = $1`, [duty])).rows;
  const done = (await db.query<{ day: string; user_id: string }>(`select day::text, user_id from public.duty_done where duty_id = $1`, [duty])).rows;
  const ov = (await db.query<{ day: string; user_id: string; source: "swap" | "admin" }>(`select day::text, user_id, source from public.duty_overrides where duty_id = $1`, [duty])).rows;
  return {
    duty: { start_date: d.start_date, order: ORDER },
    roster: roster.map((r) => ({ user_id: r.user_id, active: r.active, away_until: r.away })),
    overrides: new Map(ov.map((o) => [o.day, { user_id: o.user_id, source: o.source }])),
    done: new Map(done.map((x) => [x.day, x.user_id])),
    chain: new Map(chain.map((c) => [c.day, c.user_id])),
    today: day(0),
  };
}
async function expectSameAsTs(duty: string, from: number, to: number) {
  const state = await tsState(duty);
  const rows = await schedule(duty, from, to);
  for (const r of rows) {
    const t = resolveDay(state, r.d);
    expect({ day: r.d, u: t?.user_id, s: t?.source }).toEqual({ day: r.d, u: r.u, s: r.s });
  }
}
const chainOf = async (duty: string) => {
  await admin();
  return (await db.query<{ d: string; u: string }>(`select day::text d, user_id u from public.duty_chain where duty_id = $1 order by day`, [duty])).rows;
};

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUB);
  for (const file of MIGRATIONS) await db.exec(readFileSync(join(process.cwd(), "supabase/migrations", file), "utf8"));
  await db.exec(`insert into auth.users values ('${A}'),('${B}'),('${C}'),('${D}'),('${X}');`);
  for (const [id, name] of [[A, "Нурдаулет"], [B, "Нурбол"], [C, "Ерасыл"], [D, "Парасат"], [X, "Чужой"]]) {
    await as(id);
    await db.query(`select public.upsert_profile($1, '+77001234567')`, [name]);
  }
  await as(A);
  const h = await db.query<{ id: string; invite_code: string }>(`select * from public.create_household('Квартира 42')`);
  hh = h.rows[0].id;
  for (const u of [B, C, D]) {
    await as(u);
    await db.query(`select public.join_household($1)`, [h.rows[0].invite_code]);
  }
  await as(X);
  await db.query(`select * from public.create_household('Чужая')`);
  await admin();
  await db.exec(FAKE_TG);
  await db.exec(`insert into private.server_secrets values ('cron', encode(extensions.digest('${SECRET}', 'sha256'), 'hex'))`);
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await admin();
  await db.exec(`delete from public.duties; update public.members set away_until = null, active = true;
    delete from public.fake_http; delete from private.telegram_sent; truncate private.duty_morning_log;
    update public.households set telegram_chat_id = ${CHAT} where id = '${hh}';
    truncate public.settlement_shares, public.settlements, public.purchases cascade;`);
});

describe("A. the queue walks", () => {
  it("A1: nobody away -> the chain is the plain rotation for 30 days (SQL and duty.ts agree)", async () => {
    const duty = await newDuty(-5);
    const rows = await cooks(duty, -5, 24);
    expect(rows).toHaveLength(30);
    rows.forEach((u, i) => expect(u).toBe(ORDER[i % 4]));
    await expectSameAsTs(duty, -5, 24);
  });

  it("A2: live scenario - 14 m1, 15 m2, 16 m3, 17 m0, 18 m1, nobody twice in a row", async () => {
    // start 10th, today 15th: member0 away until the 16th, set before the migration's backfill ran
    const duty = await newDuty(-5);
    await awayDb(A, day(1));
    await backfillAgain();
    const stored = await chainOf(duty);
    expect(stored.map((r) => r.d)).toEqual([-5, -4, -3, -2, -1, 0].map(day)); // 10..13 plain, 14 and 15 walked
    expect(stored.map((r) => r.u)).toEqual([A, B, C, D, B, C]);
    expect(await cooks(duty, -1, 3)).toEqual([B, C, D, A, B]); // 14..18
    const all = await cooks(duty, -5, 20);
    for (let i = 1; i < all.length; i++) expect(all[i]).not.toBe(all[i - 1]);
    await expectSameAsTs(duty, -5, 20);
  });

  it("A3: a later away change never rewrites a locked past day", async () => {
    const duty = await newDuty(-5);
    await awayDb(A, day(1));
    await backfillAgain();
    const before = await cooks(duty, -5, -1);
    await as(C);
    await db.query(`select public.set_member_away($1, $2, $3)`, [hh, B, day(3)]); // locks through yesterday, then B leaves
    expect(await cooks(duty, -5, -1)).toEqual(before);
    await as(B);
    await db.query(`select public.set_away($1, null)`, [hh]);
    expect(await cooks(duty, -5, -1)).toEqual(before);
    await expectSameAsTs(duty, -5, 12);
  });

  it("A3b: an away change made before any lock still freezes the past first", async () => {
    const duty = await newDuty(-5); // plain so far: 10 A, 11 B, 12 C, 13 D, 14 A, 15 B
    expect(await cooks(duty, -1, 2)).toEqual([A, B, C, D]);
    await as(C);
    await db.query(`select public.set_member_away($1, $2, $3)`, [hh, B, day(1)]); // B away today and tomorrow
    expect(await cooks(duty, -5, -1)).toEqual([A, B, C, D, A]); // history untouched (B cooked on the 11th)
    const [today, tomorrow, after] = await cooks(duty, 0, 2);
    expect([today, tomorrow, after]).toEqual([C, D, A]); // today skips B, the walk continues
    await expectSameAsTs(duty, -5, 12);
  });

  it("A4: a swap override shows on its day and does not move the chain", async () => {
    const duty = await newDuty(0); // chain: today A, then B, C, D, A ...
    await as(B);
    await db.query(`select * from public.request_swap($1, $2, $3, null)`, [duty, day(1), day(2)]); // B <-> C
    await admin();
    const req = (await db.query<{ id: string }>(`select id from public.duty_swap_requests`)).rows[0].id;
    await as(C);
    await db.query(`select * from public.respond_swap($1, true)`, [req]);
    const rows = await schedule(duty, 0, 5);
    expect(rows.map((r) => r.u)).toEqual([A, C, B, D, A, B]); // two fixed days swapped, the rest follows the chain
    expect(rows[1].s).toBe("swap");
    await expectSameAsTs(duty, 0, 10);
    await as(null, "anon");
    await db.query(`select public.run_duty_morning($1)`, [SECRET]);
    expect(await chainOf(duty)).toEqual([{ d: day(0), u: A }]);
    // the swap does not move the walk: the days after it still come from the chain (B C D A), only 1 and 2 are exchanged
    await admin();
    await db.query(`select private.duty_chain_lock($1, $2)`, [duty, day(5)]);
    expect((await chainOf(duty)).map((r) => r.u)).toEqual([A, B, C, D, A, B]);
    expect(await cooks(duty, 0, 5)).toEqual([A, C, B, D, A, B]);
  });

  it("A5: the morning RPC returns today and tomorrow from the chain and locks today", async () => {
    const duty = await newDuty(-5);
    await awayDb(A, day(1));
    await backfillAgain();
    await as(null, "anon");
    const r = await db.query<{ r: Array<{ today_user: string; tomorrow_user: string }> }>(`select public.run_duty_morning($1) as r`, [SECRET]);
    expect(r.rows[0].r).toHaveLength(1);
    expect(r.rows[0].r[0].today_user).toBe(C); // 15th
    expect(r.rows[0].r[0].tomorrow_user).toBe(D); // 16th: A is still away
    expect((await chainOf(duty)).at(-1)).toEqual({ d: day(0), u: C });
    await expectSameAsTs(duty, -5, 12);
  });

  it("marking «приготовил» locks the chain through that day and keeps the done row", async () => {
    const duty = await newDuty(-1); // yesterday A, today B
    await as(B);
    await db.query(`select * from public.mark_duty_done($1, $2)`, [duty, day(0)]);
    expect((await chainOf(duty)).map((r) => r.d)).toEqual([day(-1), day(0)]);
    await admin();
    expect((await db.query(`select 1 from public.duty_done where duty_id = $1`, [duty])).rows).toHaveLength(1);
  });

  it("members can read the chain, strangers cannot, nobody writes", async () => {
    const duty = await newDuty(-3);
    await admin();
    await db.query(`select private.duty_chain_lock($1, $2)`, [duty, day(0)]);
    await as(B);
    expect((await db.query(`select * from public.duty_chain`)).rows.length).toBeGreaterThan(0);
    await expect(db.query(`delete from public.duty_chain`)).rejects.toMatchObject({ code: "42501" });
    await expect(db.query(`select private.duty_chain_lock($1, $2)`, [duty, day(0)])).rejects.toThrow();
    await as(X);
    expect((await db.query(`select * from public.duty_chain`)).rows).toHaveLength(0);
  });
});

describe("B. the author deletes a purchase after people paid", () => {
  async function buy(payer: string, amount: number, who: string[]) {
    await as(payer);
    const r = await db.query<{ r: { id: string; purchase?: { id: string } } }>(`select to_jsonb(public.create_purchase_with_shares($1, $2, 'нан', null, $3)) as r`, [hh, amount, who]);
    return r.rows[0].r.purchase?.id ?? r.rows[0].r.id;
  }
  const net = async (a: string, b: string) => {
    await admin();
    return Number((await db.query<{ n: string }>(`select private.pair_net($1, $2, $3)::text as n`, [hh, a, b])).rows[0].n);
  };
  const purchases = async () => {
    await admin();
    return (await db.query<{ id: string; payer_id: string; amount: number; description: string; status: string }>(`select id, payer_id, amount, description, status from public.purchases order by created_at, id`)).rows;
  };
  const clearPosts = async () => {
    await admin();
    await db.exec(`delete from public.fake_http; delete from private.telegram_sent;`);
  };

  it("B1: unpaid shares just disappear, no refund", async () => {
    const id = await buy(A, 3000, [A, B, C]);
    await clearPosts();
    await as(A);
    await db.query(`select public.delete_purchase($1)`, [id]);
    expect(await purchases()).toHaveLength(0);
    expect(await texts()).toEqual(["🗑 Нурдаулет удалил «нан» — 3 000 ₸"]);
  });

  it("B2 (slice 25): delete after a debtor paid -> the purchase just disappears, no refund, 🗑 post without «Вернётся»", async () => {
    const id = await buy(A, 3000, [A, B, C]); // B and C owe A 1000 each
    await as(B);
    await db.query(`select public.mark_settlement($1, $2)`, [hh, A]); // B pays A 1000
    expect(await net(B, A)).toBe(0);
    await clearPosts();
    await as(A);
    await db.query(`select public.delete_purchase($1)`, [id]);
    expect(await purchases()).toHaveLength(0);
    expect(await net(A, B)).toBe(0);
    expect(await net(C, A)).toBe(0);
    expect(await texts()).toEqual(["🗑 Нурдаулет удалил «нан» — 3 000 ₸"]);
    await admin();
    expect((await db.query(`select 1 from public.settlements`)).rows).toHaveLength(1); // the settlement stays as history
  });

  it("B3: a stranger cannot delete, a plain housemate cannot, an admin still can; anon surface stays 13", async () => {
    const id = await buy(B, 3000, [A, B, C]);
    await as(X);
    await expect(db.query(`select public.delete_purchase($1)`, [id])).rejects.toMatchObject({ code: "P0002" });
    await as(C);
    await expect(db.query(`select public.delete_purchase($1)`, [id])).rejects.toMatchObject({ code: "42501" });
    await as(A); // A is the admin, not the payer; A has paid B, so there is a payment
    await db.query(`select public.mark_settlement($1, $2)`, [hh, B]);
    await db.query(`select public.delete_purchase($1)`, [id]);
    expect(await purchases()).toHaveLength(0);
    await as(null, "anon");
    await expect(db.query(`select public.delete_purchase($1)`, [id])).rejects.toThrow();
    await admin();
    const r = await db.query<{ n: string }>(
      `select p.oid::regprocedure::text as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname in ('public', 'private') and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')
         and p.proname not in ('uid')
       order by 1`,
    );
    expect(r.rows).toHaveLength(13);
  });

  it("a Telegram failure never breaks the delete", async () => {
    const id = await buy(A, 3000, [A, B]);
    await admin();
    await db.exec(`create or replace function net.http_post(url text, body jsonb default null, params jsonb default null, headers jsonb default null, timeout_milliseconds integer default 1000)
      returns bigint language plpgsql as $$ begin raise exception 'boom'; end $$`);
    await as(A);
    await db.query(`select public.delete_purchase($1)`, [id]);
    expect(await purchases()).toHaveLength(0);
    await admin();
    await db.exec(`create or replace function net.http_post(url text, body jsonb default null, params jsonb default null, headers jsonb default null, timeout_milliseconds integer default 1000)
      returns bigint language sql as $$ insert into public.fake_http values (url, body) returning 1::bigint $$`);
  });
});
