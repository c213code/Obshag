import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const A = "00000000-0000-0000-0000-00000000000a"; // admin (creator)
const B = "00000000-0000-0000-0000-00000000000b"; // member, @aidos_k
const C = "00000000-0000-0000-0000-00000000000c"; // member

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
];

const FAKE_TG = `
  create schema net;
  create table public.fake_http (url text, body jsonb);
  create function net.http_post(url text, body jsonb default null, params jsonb default null, headers jsonb default null, timeout_milliseconds integer default 1000)
    returns bigint language sql as $$ insert into public.fake_http values (url, body) returning 1::bigint $$;
  create schema vault;
  create view vault.decrypted_secrets as select 'telegram_bot_token'::text as name, 'tok'::text as decrypted_secret;
`;
const TG_A = 777001;

type Captured = { status: string; purchase_id: string; subscriptions: unknown[]; deduped?: boolean };

let db: PGlite;
let token: string;

async function as(user: string | null, role: "authenticated" | "anon" = "authenticated") {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ""}', false); set role ${role};`);
}
async function admin() {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
}
async function capture(amount: number, merchant: string | null, ...choice: Array<string | null>) {
  await as(null, "anon");
  const r = await db.query<{ r: Captured }>(`select public.capture_purchase($1, $2, $3, $4) as r`, [token, amount, merchant, choice[0] ?? null]);
  return r.rows[0].r;
}
const sends = async () => {
  await admin();
  return (await db.query<{ url: string; body: { chat_id: number; text: string; reply_markup: unknown } }>(`select url, body from public.fake_http order by 1`)).rows;
};

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUB);
  for (const file of MIGRATIONS) await db.exec(readFileSync(join(process.cwd(), "supabase/migrations", file), "utf8"));
  await db.exec(`insert into auth.users values ('${A}'),('${B}'),('${C}');`);
  for (const [id, name] of [[A, "Ерасыл"], [B, "Айдос"], [C, "Дана"]]) {
    await as(id);
    await db.query(`select public.upsert_profile($1, '+77001234567')`, [name]);
  }
  await as(A);
  const h = await db.query<{ id: string; invite_code: string }>(`select * from public.create_household('Квартира 42')`);
  for (const u of [B, C]) {
    await as(u);
    await db.query(`select public.join_household($1)`, [h.rows[0].invite_code]);
  }
  await as(A);
  token = (await db.query<{ t: string }>(`select public.rotate_capture_token() as t`)).rows[0].t;
  await admin();
  await db.exec(FAKE_TG);
});
afterAll(async () => {
  await db.close();
});
// Test fixture reset: runs as the table owner against the in-memory test database only.
beforeEach(async () => {
  await admin();
  await db.exec(
    `delete from public.fake_http; truncate public.purchases cascade; truncate private.capture_ops; update public.members set away_until = null;
     update public.profiles set telegram_user_id = null; update public.profiles set telegram_user_id = ${TG_A} where id = '${A}';`,
  );
});

describe("capture_purchase asks in Telegram (slice 20)", () => {
  it("no choice + linked Telegram: one DM with Общее / Моё and a link to the pending purchase", async () => {
    const r = await capture(3000, "Magnum");
    expect(r.status).toBe("pending");
    const s = await sends();
    expect(s).toHaveLength(1);
    expect(s[0].url).toContain("/sendMessage");
    expect(s[0].body.chat_id).toBe(TG_A);
    expect(s[0].body.text).toBe("🛒 Magnum · 3 000 ₸\nЧья покупка?");
    expect(s[0].body.reply_markup).toEqual({
      inline_keyboard: [
        [
          { text: "Общее", callback_data: `s:${r.purchase_id}` },
          { text: "Моё", callback_data: `p:${r.purchase_id}` },
        ],
        [{ text: "Разобрать в приложении", url: `https://obshak-gules.vercel.app/pending/${r.purchase_id}` }],
      ],
    });
  });

  it("a merchant is escaped for HTML and a missing one reads «Покупка»", async () => {
    await capture(1500, "A<b>&Co");
    await capture(1600, null);
    const texts = (await sends()).map((x) => x.body.text);
    expect(texts).toContain("🛒 A&lt;b&gt;&amp;Co · 1 500 ₸\nЧья покупка?");
    expect(texts).toContain("🛒 Покупка · 1 600 ₸\nЧья покупка?");
  });

  it("no Telegram linked: no DM, the capture still succeeds", async () => {
    await admin();
    await db.exec(`update public.profiles set telegram_user_id = null`);
    const r = await capture(3000, "Magnum");
    expect(r.status).toBe("pending");
    expect(await sends()).toHaveLength(0);
  });

  it("later / потом: pending, no DM", async () => {
    for (const [i, c] of ["later", "потом", " Потом "].entries()) expect((await capture(100 + i, "m", c)).status, c).toBe("pending");
    expect(await sends()).toHaveLength(0);
  });

  it("shared / personal: decided at once, no DM", async () => {
    expect((await capture(3000, "m", "shared")).status).toBe("shared");
    expect((await capture(500, "m", "personal")).status).toBe("personal");
    expect(await sends()).toHaveLength(0);
  });

  it("a deduped Shortcut retry within 60 s sends nothing more", async () => {
    const first = await capture(3000, "Magnum");
    const again = await capture(3000, "Magnum");
    expect(again).toMatchObject({ deduped: true, purchase_id: first.purchase_id });
    expect(await sends()).toHaveLength(1);
  });

  it("a failing send does not fail the capture", async () => {
    await admin();
    await db.exec(`drop view vault.decrypted_secrets; create view vault.decrypted_secrets as select 1/0 as decrypted_secret, 'telegram_bot_token'::text as name;`);
    try {
      const r = await capture(3000, "Magnum");
      expect(r.status).toBe("pending");
      await admin();
      expect((await db.query(`select 1 from public.purchases where id = $1`, [r.purchase_id])).rows).toHaveLength(1);
    } finally {
      await admin();
      await db.exec(`drop view vault.decrypted_secrets; create view vault.decrypted_secrets as select 'telegram_bot_token'::text as name, 'tok'::text as decrypted_secret;`);
    }
  });

  it("anon can still execute capture_purchase(text,integer,text,text); the anon surface is still 13 functions", async () => {
    await admin();
    const r = await db.query<{ n: string }>(
      `select p.oid::regprocedure::text as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname in ('public', 'private') and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')
         and p.proname not in ('uid')
       order by 1`,
    );
    expect(r.rows).toHaveLength(13);
    expect(r.rows.map((x) => x.n)).toContain("capture_purchase(text,integer,text,text)");
  });
});
