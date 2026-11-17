import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const A = "00000000-0000-0000-0000-00000000000a"; // payer, admin
const B = "00000000-0000-0000-0000-00000000000b";
const C = "00000000-0000-0000-0000-00000000000c";
const D = "00000000-0000-0000-0000-00000000000d";
const SECRET = "slice27-secret";
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
const FAKE_TG = `
  create schema net;
  create table public.fake_http (url text, body jsonb);
  create function net.http_post(url text, body jsonb default null, params jsonb default null, headers jsonb default null, timeout_milliseconds integer default 1000)
    returns bigint language sql as $$ insert into public.fake_http values (url, body) returning 1::bigint $$;
  create schema vault;
  create view vault.decrypted_secrets as select 'telegram_bot_token'::text as name, 'tok'::text as decrypted_secret;
`;
const MIG_DIR = join(process.cwd(), "supabase/migrations");
const files = (upTo: string) =>
  readdirSync(MIG_DIR)
    .filter((f) => f.endsWith(".sql") && f.slice(0, 4) <= upTo)
    .sort();

const OLD_FOOTER = "Меньше 100 ₸ переводить не нужно";

let db: PGlite;
let hh: string;

async function as(user: string | null, role: "authenticated" | "anon" = "authenticated") {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ""}', false); set role ${role};`);
}
async function admin() {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
}

type Post = { chat_id: number; text: string; reply_markup?: { inline_keyboard: Array<Array<{ text: string; url: string }>> } };
const posts = async () => {
  await admin();
  return (await db.query<{ body: Post }>(`select body from public.fake_http`)).rows.map((r) => r.body);
};
const sel = async <T,>(sql: string) => {
  await admin();
  return (await db.query<T>(sql)).rows;
};
const clearPosts = async () => {
  await admin();
  await db.exec("delete from public.fake_http; delete from public.pay_links; delete from private.telegram_sent");
};
async function shared(payer: string, rows: Array<[string, number]>, desc: string, createdAt?: string) {
  await admin();
  const total = rows.reduce((n, [, a]) => n + a, 0);
  const pu = await db.query<{ id: string }>(
    `insert into public.purchases (household_id, payer_id, amount, description, status${createdAt ? ", created_at" : ""}) values ($1, $2, $3, $4, 'pending'${createdAt ? ", $5" : ""}) returning id`,
    createdAt ? [hh, payer, total, desc, createdAt] : [hh, payer, total, desc],
  );
  const id = pu.rows[0].id;
  for (const [u, a] of rows) await db.query(`insert into public.shares (purchase_id, household_id, debtor_id, amount) values ($1, $2, $3, $4)`, [id, hh, u, a]);
  await db.exec(`update public.purchases set status = 'shared' where id = '${id}'`);
  return id;
}
const messageOf = async (id: string) => (await sel<{ m: string }>(`select private.tg_purchase_message('${id}') as m`))[0].m;

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUB);
  for (const f of files("0025")) await db.exec(readFileSync(join(MIG_DIR, f), "utf8"));
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
    `delete from public.fake_http; delete from public.pay_links; delete from private.telegram_sent; delete from public.reminder_log;
     truncate public.paid_prompts, public.settlement_shares, public.settlements, public.purchases cascade;
     update public.members set active = true; update public.households set telegram_chat_id = ${CHAT};`,
  );
});

describe("the purchase post is plain", () => {
  it("no reply_markup, no pay links, no footer: the text is exactly tg_purchase_message", async () => {
    const id = await shared(A, [[A, 400], [B, 50], [C, 300], [D, 250]], "нан");
    const all = await posts();
    expect(all).toHaveLength(1);
    const [p] = all;
    expect(p.reply_markup).toBeUndefined();
    expect(p.text).not.toContain(OLD_FOOTER);
    expect(p.text).not.toContain("→ перевести");
    expect(p.text).toBe(await messageOf(id));
    expect(await sel(`select code from public.pay_links`)).toHaveLength(0);
  });

  it("the same when every debtor is over 100 ₸", async () => {
    await shared(A, [[A, 100], [B, 200], [C, 200]], "вода");
    const [p] = await posts();
    expect(p.reply_markup).toBeUndefined();
    expect(p.text).not.toContain(OLD_FOOTER);
  });

  it("the telegram_sent dedupe still holds: one post per purchase", async () => {
    const id = await shared(A, [[A, 100], [B, 200]], "нан");
    await admin();
    await db.exec(`update public.purchases set status = 'pending' where id = '${id}'; update public.purchases set status = 'shared' where id = '${id}'`);
    expect(await posts()).toHaveLength(1);
  });

  it("a failing send never breaks the purchase", async () => {
    await admin();
    await db.exec(`update public.households set telegram_chat_id = null`);
    const id = await shared(A, [[A, 100], [B, 200]], "нан");
    expect(await posts()).toHaveLength(0);
    expect(await sel<{ status: string }>(`select status from public.purchases where id = '${id}'`)).toEqual([{ status: "shared" }]);
  });

  it("pay links created before the migration stay usable", async () => {
    await shared(A, [[A, 200], [B, 300]], "нан");
    await admin();
    await db.exec(`insert into public.pay_links (code, household_id, from_user, to_user) values ('oldcodeold01', '${hh}', '${B}', '${A}')`);
    await as(null, "anon");
    const o = await db.query<{ r: { state: string } }>(`select public.pay_link_open($1, 'oldcodeold01', false) as r`, [SECRET]);
    expect(o.rows[0].r.state).toBe("pay");
  });
});

describe("the reminder has no dated lines", () => {
  const remind = async () => {
    await as(A);
    await db.query(`select public.remind($1, $2, $3)`, [SECRET, hh, B]);
  };
  it("one text line, no «•», still the single «💸 Перевести N ₸» button", async () => {
    await shared(A, [[A, 50], [B, 75]], "Ip Mahanova. G", "2026-11-10T08:00:00Z");
    await shared(A, [[A, 300], [B, 250]], "Вода 20 л + 600 ₸", "2026-11-11T08:00:00Z");
    await shared(B, [[B, 100], [A, 150]], "нан", "2026-11-09T08:00:00Z");
    await clearPosts();
    await remind();
    const [p] = await posts();
    expect(p.text).not.toContain("•");
    expect(p.text).not.toContain("нояб");
    expect(p.text.split("\n")).toHaveLength(1);
    expect(p.text).toContain("ты должен");
    expect(p.text).toContain("175 ₸");
    expect(p.reply_markup!.inline_keyboard).toHaveLength(1);
    expect(p.reply_markup!.inline_keyboard[0]).toHaveLength(1);
    expect(p.reply_markup!.inline_keyboard[0][0].text).toBe("💸 Перевести 175 ₸");
    expect(p.reply_markup!.inline_keyboard[0][0].url).toMatch(/\/k\/[A-Za-z0-9_-]+$/);
    expect(await sel(`select code from public.pay_links where from_user = '${B}' and to_user = '${A}'`)).toHaveLength(1);
  });

  it("the guards are unchanged: under 100 ₸ is too_small, and the 6 h rate limit holds", async () => {
    await shared(A, [[A, 50], [B, 50]], "мелочь");
    await as(A);
    await expect(db.query(`select public.remind($1, $2, $3)`, [SECRET, hh, B])).rejects.toMatchObject({ message: "too_small" });
    await shared(A, [[A, 100], [B, 200]], "нан");
    await remind();
    await as(A);
    await expect(db.query(`select public.remind($1, $2, $3)`, [SECRET, hh, B])).rejects.toMatchObject({ message: "rate_limited" });
  });

  it("tg_pair_lines is kept (unused)", async () => {
    await shared(A, [[A, 50], [B, 75]], "нан", "2026-11-10T08:00:00Z");
    const r = await sel<{ t: string }>(`select private.tg_pair_lines('${hh}', '${B}', '${A}') as t`);
    expect(r[0].t).toBe("• 10 нояб · нан — 75 ₸");
  });
});

describe("surface", () => {
  it("remind is still executable by authenticated, not anon", async () => {
    const r = await sel<{ auth: boolean; anon: boolean }>(
      `select has_function_privilege('authenticated', 'public.remind(text, uuid, uuid)', 'execute') as auth,
              has_function_privilege('anon', 'public.remind(text, uuid, uuid)', 'execute') as anon`,
    );
    expect(r).toEqual([{ auth: true, anon: false }]);
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
