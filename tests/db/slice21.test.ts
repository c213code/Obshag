import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const A = "00000000-0000-0000-0000-00000000000a"; // payer, admin
const B = "00000000-0000-0000-0000-00000000000b";
const C = "00000000-0000-0000-0000-00000000000c";
const D = "00000000-0000-0000-0000-00000000000d";
const SECRET = "slice21-secret";

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
     delete from public.fake_http; delete from public.pay_links; delete from private.telegram_sent; delete from public.purchases;
     update public.members set active = true; update public.households set telegram_chat_id = ${CHAT};`,
  );
});

describe("«💸 перевести» buttons under the purchase post", () => {
  it("one url button row per debtor, a pay link each (debtor -> payer), the text is unchanged", async () => {
    const id = await buy(A, 4500, [A, B, C, D]);
    const [p] = await posts();
    const ls = await links();
    expect(ls).toHaveLength(3);
    expect(ls.every((l) => l.to_user === A)).toBe(true);
    expect(ls.map((l) => l.from_user)).toEqual([B, C, D]);
    expect(p.reply_markup!.inline_keyboard).toHaveLength(3);
    for (const row of p.reply_markup!.inline_keyboard) expect(row).toHaveLength(1);
    const urls = p.reply_markup!.inline_keyboard.map((r) => r[0].url).sort();
    expect(urls).toEqual(ls.map((l) => `https://obshak-gules.vercel.app/k/${l.code}`).sort());
    expect(p.text).toBe(await messageOf(id));
  });

  it("the button order and texts follow the «Должны» order", async () => {
    await buy(A, 4500, [A, B, C, D]);
    const [p] = await posts();
    expect(p.reply_markup!.inline_keyboard.map((r) => r[0].text)).toEqual(["💸 Нурбол → перевести", "💸 Даня → перевести", "💸 Ерасыл → перевести"]);
    const ls = await links();
    // row i points at the link of the i-th debtor by id
    expect(p.reply_markup!.inline_keyboard.map((r) => r[0].url.split("/k/")[1])).toEqual(ls.map((l) => l.code));
  });

  it("a payer-only purchase is posted plain", async () => {
    await buy(A, 1000, [A]);
    const [p] = await posts();
    expect(p.reply_markup).toBeUndefined();
    expect(await links()).toHaveLength(0);
  });

  it("a zero share and an inactive member get no button", async () => {
    await admin();
    await db.exec(`update public.members set active = false where user_id = '${D}'`);
    const pu = await db.query<{ id: string }>(
      `insert into public.purchases (household_id, payer_id, amount, description, status) values ($1, $2, 600, 'Заказ', 'pending') returning id`,
      [hh, A],
    );
    const id = pu.rows[0].id;
    await db.exec(`insert into public.shares (purchase_id, household_id, debtor_id, amount) values
      ('${id}', '${hh}', '${A}', 300), ('${id}', '${hh}', '${B}', 300), ('${id}', '${hh}', '${C}', 0), ('${id}', '${hh}', '${D}', 100)`);
    await db.exec(`update public.purchases set status = 'shared' where id = '${id}'`);
    const [p] = await posts();
    expect(p.reply_markup!.inline_keyboard.map((r) => r[0].text)).toEqual(["💸 Нурбол → перевести"]);
    expect((await links()).map((l) => l.from_user)).toEqual([B]);
  });

  it("pending -> shared posts once with buttons; a later update does not post again", async () => {
    await admin();
    const pu = await db.query<{ id: string }>(
      `insert into public.purchases (household_id, payer_id, amount, description, source, status) values ($1, $2, 900, 'Кофе', 'apple_pay', 'pending') returning id`,
      [hh, A],
    );
    const id = pu.rows[0].id;
    await db.exec(`insert into public.shares (purchase_id, household_id, debtor_id, amount) values ('${id}', '${hh}', '${A}', 450), ('${id}', '${hh}', '${B}', 450)`);
    expect(await posts()).toHaveLength(0);
    await db.exec(`update public.purchases set status = 'shared' where id = '${id}'`);
    expect(await posts()).toHaveLength(1);
    await db.exec(`update public.purchases set description = 'Кофе 2' where id = '${id}'`);
    const after = await posts();
    expect(after).toHaveLength(1);
    expect(after[0].reply_markup!.inline_keyboard).toHaveLength(1);
    expect(await links()).toHaveLength(1);
  });

  it("a failure in link creation falls back to a plain post and the purchase still succeeds", async () => {
    await admin();
    await db.exec(`alter table public.pay_links add constraint boom check (false)`);
    const id = await buy(A, 3000, [A, B, C]);
    const [p] = await posts();
    expect(p.reply_markup).toBeUndefined();
    expect(p.text).toBe(await messageOf(id));
    expect(await links()).toHaveLength(0);
    await admin();
    expect((await db.query(`select 1 from public.purchases where id = $1`, [id])).rows).toHaveLength(1);
  });

  it("a link created here opens on the pay page for the pair", async () => {
    await buy(A, 4500, [A, B, C, D]);
    const [l] = await links();
    expect(l.from_user).toBe(B);
    await as(null, "anon");
    const r = await db.query<{ r: { state: string; amount?: number; to_name?: string; from_name?: string } }>(`select public.pay_link_open($1, $2, false) as r`, [SECRET, l.code]);
    expect(r.rows[0].r).toMatchObject({ state: "pay", amount: 1125, to_name: "Нурдаулет", from_name: "Нурбол" });
  });

  it("the anon surface is still 13 functions", async () => {
    await admin();
    const r = await db.query<{ n: string }>(
      `select p.oid::regprocedure::text as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname in ('public', 'private') and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')
         and p.proname not in ('uid')
       order by 1`,
    );
    expect(r.rows).toHaveLength(13);
  });
});
