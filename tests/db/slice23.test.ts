import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const A = "00000000-0000-0000-0000-00000000000a"; // payer, admin
const B = "00000000-0000-0000-0000-00000000000b";
const C = "00000000-0000-0000-0000-00000000000c";
const D = "00000000-0000-0000-0000-00000000000d";
const SECRET = "slice23-secret";

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
];

let db: PGlite;
let hh: string;

async function as(user: string | null, role: "authenticated" | "anon" = "authenticated") {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ""}', false); set role ${role};`);
}
async function admin() {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
}

const CHAT = -100123456;
const FAKE_TG = `
  create schema net;
  create table public.fake_http (url text, body jsonb);
  create function net.http_post(url text, body jsonb default null, params jsonb default null, headers jsonb default null, timeout_milliseconds integer default 1000)
    returns bigint language sql as $$ insert into public.fake_http values (url, body) returning 1::bigint $$;
  create schema vault;
  create view vault.decrypted_secrets as select 'telegram_bot_token'::text as name, 'tok'::text as decrypted_secret;
`;

type Post = { text: string; reply_markup?: { inline_keyboard: Array<Array<{ text: string; url: string }>> } };
const posts = async () => {
  await admin();
  return (await db.query<{ body: Post }>(`select body from public.fake_http`)).rows.map((r) => r.body);
};
const links = async () => {
  await admin();
  return (await db.query<{ code: string; from_user: string; to_user: string }>(`select code, from_user, to_user from public.pay_links order by from_user`)).rows;
};
async function buy(payer: string, amount: number, who: string[]) {
  await as(payer);
  const r = await db.query<{ r: { id: string; purchase?: { id: string } } }>(`select to_jsonb(public.create_purchase_with_shares($1, $2, 'нан', null, $3)) as r`, [hh, amount, who]);
  return r.rows[0].r.purchase?.id ?? r.rows[0].r.id;
}
const messageOf = async (id: string) => {
  await admin();
  return (await db.query<{ m: string }>(`select private.tg_purchase_message($1) as m`, [id])).rows[0].m;
};

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUB);
  for (const file of MIGRATIONS) await db.exec(readFileSync(join(process.cwd(), "supabase/migrations", file), "utf8"));
  await db.exec(`insert into auth.users values ('${A}'),('${B}'),('${C}'),('${D}');`);
  for (const [id, name] of [[A, "Нурдаулет"], [B, "Нурбол"], [C, "Даня"], [D, "Ерасыл"]]) {
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
  await admin();
  await db.exec(FAKE_TG);
  await db.exec(`update public.profiles set telegram_user_id = 777002 where id = '${B}'`);
  await db.exec(`insert into private.server_secrets values ('cron', encode(extensions.digest('${SECRET}', 'sha256'), 'hex'))`);
});
afterAll(async () => {
  await db.close();
});
// Test fixture reset: runs as the table owner against the in-memory test database only.
beforeEach(async () => {
  await admin();
  await db.exec(
    `drop table if exists public.fake_boom; alter table public.pay_links drop constraint if exists boom;
     delete from public.fake_http; delete from public.pay_links; delete from private.telegram_sent; delete from public.reminder_log;
     truncate public.paid_prompts, public.settlement_shares, public.settlements, public.purchases cascade;
     update public.members set active = true; update public.households set telegram_chat_id = ${CHAT};`,
  );
});



const texts = async () => (await posts()).map((p) => p.text);
const awayOf = async (u: string) => {
  await admin();
  return (await db.query<{ a: string | null }>(`select to_char(away_until, 'YYYY-MM-DD') as a from public.members where household_id = $1 and user_id = $2`, [hh, u])).rows[0].a;
};
const dayPlus = async (n: number) => {
  await admin();
  return (await db.query<{ d: string }>(`select to_char((now() at time zone 'Asia/Almaty')::date + $1::int, 'YYYY-MM-DD') as d`, [n])).rows[0].d;
};
const setFor = async (caller: string, target: string, until: string | null) => {
  await as(caller);
  await db.query(`select public.set_member_away($1, $2, $3)`, [hh, target, until]);
};
const MON = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "нояб", "дек"];
const pretty = (iso: string) => `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]}`;

beforeEach(async () => {
  await admin();
  await db.exec(`update public.members set away_until = null; delete from public.duties;`);
});

describe("set_member_away", () => {
  it("A marks B away: the date is set and one ✈️ post names B and A", async () => {
    const until = await dayPlus(10);
    await setFor(A, B, until);
    expect(await awayOf(B)).toBe(until);
    const t = await texts();
    expect(t).toHaveLength(1);
    expect(t[0]).toBe(`✈️ Нурбол в отъезде до ${pretty(until)} — готовка идёт дальше по кругу · отметил Нурдаулет`);
  });

  it("self: no «отметил»; clear posts 🏠; the same value twice posts once", async () => {
    const until = await dayPlus(5);
    await setFor(B, B, until);
    await setFor(B, B, until);
    expect(await texts()).toEqual([`✈️ Нурбол в отъезде до ${pretty(until)} — готовка идёт дальше по кругу`]);
    await setFor(C, B, null);
    expect(await awayOf(B)).toBeNull();
    expect((await texts())[1]).toBe("🏠 Нурбол снова дома · отметил Даня");
    await setFor(C, B, null);
    expect(await texts()).toHaveLength(2);
  });

  it("no post without a chat, and the update still works", async () => {
    await admin();
    await db.exec(`update public.households set telegram_chat_id = null`);
    await setFor(A, B, await dayPlus(3));
    expect(await texts()).toHaveLength(0);
  });

  it("refuses a stranger, an inactive target, an inactive caller, bad dates", async () => {
    const X = "00000000-0000-0000-0000-0000000000ee";
    await admin();
    await db.exec(`insert into auth.users values ('${X}')`);
    const soon = await dayPlus(2);
    await as(X);
    await expect(db.query(`select public.set_member_away($1, $2, $3)`, [hh, B, soon])).rejects.toMatchObject({ code: "42501" });
    await admin();
    await db.exec(`update public.members set active = false where user_id = '${D}'`);
    await expect(setFor(A, D, await dayPlus(2))).rejects.toMatchObject({ code: "42501" });
    await expect(setFor(D, A, await dayPlus(2))).rejects.toMatchObject({ code: "42501" });
    await expect(setFor(A, B, await dayPlus(-1))).rejects.toMatchObject({ code: "23514" });
    await expect(setFor(A, B, await dayPlus(400))).rejects.toMatchObject({ code: "23514" });
    expect(await awayOf(B)).toBeNull();
    expect(await texts()).toHaveLength(0);
  });

  it("anon cannot execute it; the anon surface is still 13 functions", async () => {
    await as(null, "anon");
    await expect(db.query(`select public.set_member_away($1, $2, null)`, [hh, B])).rejects.toThrow();
    await admin();
    const r = await db.query<{ n: string }>(
      `select p.oid::regprocedure::text as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname in ('public', 'private') and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')
         and p.proname not in ('uid')
       order by 1`,
    );
    expect(r.rows).toHaveLength(13);
  });

  it("a Telegram failure never breaks the update", async () => {
    await admin();
    await db.exec(`create or replace function net.http_post(url text, body jsonb default null, params jsonb default null, headers jsonb default null, timeout_milliseconds integer default 1000)
      returns bigint language plpgsql as $$ begin raise exception 'boom'; end $$`);
    const until = await dayPlus(4);
    await setFor(A, B, until);
    expect(await awayOf(B)).toBe(until);
    await db.exec(`create or replace function net.http_post(url text, body jsonb default null, params jsonb default null, headers jsonb default null, timeout_milliseconds integer default 1000)
      returns bigint language sql as $$ insert into public.fake_http values (url, body) returning 1::bigint $$`);
  });

  it("the cook for a day inside the away range is the next member in the rotation", async () => {
    await as(A);
    const d = await db.query<{ id: string }>(`select id from public.create_duty($1, 'cooking', 'Готовка', null, $2)`, [hh, [A, B, C, D]]);
    const duty = d.rows[0].id;
    await admin();
    const day = await dayPlus(0);
    const before = (await db.query<{ u: string }>(`select private.duty_assignee($1, $2::date) as u`, [duty, day])).rows[0].u;
    await setFor(A, before, await dayPlus(3));
    await admin();
    const after = (await db.query<{ u: string }>(`select private.duty_assignee($1, $2::date) as u`, [duty, day])).rows[0].u;
    expect(after).not.toBe(before);
    const order = [A, B, C, D];
    expect(after).toBe(order[(order.indexOf(before) + 1) % 4]);
    const past = await dayPlus(4);
    const later = (await db.query<{ u: string }>(`select private.duty_assignee($1, $2::date) as u`, [duty, past])).rows[0].u;
    expect(later).toBeTruthy();
  });
});
