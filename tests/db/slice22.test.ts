import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const A = "00000000-0000-0000-0000-00000000000a"; // payer, admin
const B = "00000000-0000-0000-0000-00000000000b";
const C = "00000000-0000-0000-0000-00000000000c";
const D = "00000000-0000-0000-0000-00000000000d";
const SECRET = "slice22-secret";

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
const FOOTER = "Меньше 100 ₸ переводить не нужно — добавится к следующему разу.";
const sel = async <T,>(sql: string) => {
  await admin();
  return (await db.query<T>(sql)).rows;
};
const clearPosts = async () => {
  await admin();
  await db.exec("delete from public.fake_http; delete from public.pay_links; delete from private.telegram_sent");
};

describe("no button under 100 ₸", () => {
  it("a 50 share gets no button and the post has the footer; others get buttons", async () => {
    await shared(A, [[A, 400], [B, 50], [C, 300], [D, 250]], "нан");
    const [p] = await posts();
    expect(p.reply_markup!.inline_keyboard.map((r) => r[0].text)).toEqual(["💸 Даня → перевести", "💸 Ерасыл → перевести"]);
    expect(p.text.endsWith(`\n\n${FOOTER}`)).toBe(true);
    expect((await links()).map((l) => l.from_user)).toEqual([C, D]);
  });

  it("a 50 share still gets a button when the debtor owes the payer 200 in total", async () => {
    await shared(A, [[A, 100], [B, 150]], "старый долг");
    await clearPosts();
    await shared(A, [[A, 50], [B, 50], [C, 50]], "мелочь");
    const [p] = await posts();
    expect(p.reply_markup!.inline_keyboard.map((r) => r[0].text)).toEqual(["💸 Нурбол → перевести"]);
    expect(p.text).toContain(FOOTER); // C owes only 50
  });

  it("no footer when everybody got a button", async () => {
    await shared(A, [[A, 100], [B, 200], [C, 200]], "нан");
    const [p] = await posts();
    expect(p.text).not.toContain(FOOTER);
    expect(p.reply_markup!.inline_keyboard).toHaveLength(2);
  });

  it("all debtors under 100: a plain send with the footer", async () => {
    await shared(A, [[A, 100], [B, 50], [C, 40]], "мелочь");
    const [p] = await posts();
    expect(p.reply_markup).toBeUndefined();
    expect(p.text.endsWith(FOOTER)).toBe(true);
    expect(await links()).toHaveLength(0);
  });

  it("tg_purchase_message itself is unchanged (no footer)", async () => {
    const id = await shared(A, [[A, 100], [B, 50]], "мелочь");
    await admin();
    const m = (await db.query<{ m: string }>(`select private.tg_purchase_message($1) as m`, [id])).rows[0].m;
    expect(m).not.toContain(FOOTER);
  });
});

describe("the reminder lists what the debt is made of", () => {
  const remind = async () => {
    await as(A);
    await db.query(`select public.remind($1, $2, $3)`, [SECRET, hh, B]);
  };
  it("dated lines in order, the other direction as minus, a pay button", async () => {
    await shared(A, [[A, 50], [B, 75]], "Ip Mahanova. G", "2026-11-10T08:00:00Z");
    await shared(A, [[A, 300], [B, 250]], "Вода 20 л + 600 ₸", "2026-11-11T08:00:00Z");
    await shared(B, [[B, 100], [A, 150]], "нан", "2026-11-09T08:00:00Z");
    await clearPosts();
    await remind();
    const [p] = await posts();
    expect(p.text.split("\n").slice(1)).toEqual([
      "• 9 нояб · нан — −150 ₸ (его долг тебе)",
      "• 10 нояб · Ip Mahanova. G — 75 ₸",
      "• 11 нояб · Вода 20 л + 600 ₸ — 250 ₸",
    ]);
    expect(p.text.split("\n")[0]).toContain("ты должен");
    expect(p.text.split("\n")[0]).toContain("175 ₸");
    expect(p.reply_markup!.inline_keyboard[0][0].text).toBe("💸 Перевести 175 ₸");
  });
  it("max 8 lines, then «и ещё N»; titles are escaped", async () => {
    for (let i = 0; i < 10; i++) await shared(A, [[A, 10], [B, 100]], i === 0 ? "<b>&x" : `п${i}`, `2026-10-0${(i % 9) + 1}T08:00:00Z`);
    await clearPosts();
    await remind();
    const [p] = await posts();
    const lines = p.text.split("\n").slice(1);
    expect(lines).toHaveLength(9);
    expect(lines[8]).toBe("• и ещё 2");
    expect(p.text).not.toContain("<b>");
    const all = await sel<{ t: string }>(`select private.tg_pair_lines('${hh}', '${B}', '${A}') as t`);
    expect(all[0].t).toContain("&lt;b&gt;&amp;x");
  });
  it("no shares -> null", async () => {
    const r = await sel<{ t: string | null }>(`select private.tg_pair_lines('${hh}', '${B}', '${A}') as t`);
    expect(r[0].t).toBeNull();
  });
});

describe("the debtor's mark is final", () => {
  const settlements = () => sel<{ status: string; kind: string }>(`select status, kind from public.settlements`);
  const openCount = async () =>
    (await sel<{ n: string }>(`select count(*)::text as n from public.shares s join public.purchases p on p.id = s.purchase_id where s.settled_at is null and s.debtor_id <> p.payer_id`))[0].n;
  const settledPosts = async () => (await texts()).filter((t) => t.includes("рассчитались"));
  const check = async () => {
    expect(await settlements()).toMatchObject([{ status: "confirmed", kind: "transfer" }]);
    expect(await openCount()).toBe("0");
    expect(await settledPosts()).toHaveLength(1);
  };
  const setup = async () => {
    await shared(A, [[A, 200], [B, 300]], "нан");
    await clearPosts();
  };
  const prompt = async () => {
    await as(B);
    return (await db.query<{ id: string }>(`select (public.open_paid_prompt($1, $2)).id as id`, [hh, A])).rows[0].id;
  };
  it("mark_settlement", async () => {
    await setup();
    await as(B);
    const r = await db.query<{ r: { status: string } }>(`select to_jsonb(public.mark_settlement($1, $2)) as r`, [hh, A]);
    expect(r.rows[0].r.status).toBe("confirmed");
    await check();
  });
  it("answer_paid_prompt", async () => {
    await setup();
    const id = await prompt();
    const r = await db.query<{ r: { result: string } }>(`select public.answer_paid_prompt($1, true) as r`, [id]);
    expect(r.rows[0].r.result).toBe("marked");
    await check();
  });
  it("tg_answer_paid", async () => {
    await setup();
    const id = await prompt();
    await as(null, "anon");
    const r = await db.query<{ r: { result: string } }>(`select public.tg_answer_paid($1, 777002, $2, true) as r`, [SECRET, id]);
    expect(r.rows[0].r.result).toBe("marked");
    await check();
  });
  it("pay_link_answer", async () => {
    await setup();
    await admin();
    await db.exec(`insert into public.pay_links (code, household_id, from_user, to_user) values ('codecodecode1', '${hh}', '${B}', '${A}')`);
    await as(null, "anon");
    const o = await db.query<{ r: { state: string; prompt_id: string } }>(`select public.pay_link_open($1, 'codecodecode1', true) as r`, [SECRET]);
    expect(o.rows[0].r.state).toBe("pay");
    const r = await db.query<{ r: { result: string } }>(`select public.pay_link_answer($1, 'codecodecode1', $2, true) as r`, [SECRET, o.rows[0].r.prompt_id]);
    expect(r.rows[0].r.result).toBe("marked");
    await check();
  });
  it("a «yes» after the app already closed the debt is answered marked, no second settlement", async () => {
    await setup();
    const id = await prompt();
    await db.query(`select public.mark_settlement($1, $2)`, [hh, A]);
    const r = await db.query<{ r: { result: string } }>(`select public.answer_paid_prompt($1, true) as r`, [id]);
    expect(r.rows[0].r.result).toBe("marked");
    expect(await settlements()).toHaveLength(1);
  });
  it("confirm_settlement on a confirmed row is still a no-op for the creditor", async () => {
    await setup();
    await as(B);
    const r = await db.query<{ id: string }>(`select (public.mark_settlement($1, $2)).id as id`, [hh, A]);
    await as(A);
    const c = await db.query<{ r: { status: string } }>(`select to_jsonb(public.confirm_settlement($1)) as r`, [r.rows[0].id]);
    expect(c.rows[0].r.status).toBe("confirmed");
  });
  it("a write-off still behaves as before (own post, confirmed, shares closed)", async () => {
    await shared(A, [[A, 50], [B, 50]], "мелочь");
    await clearPosts();
    await as(A);
    await db.query(`select public.write_off_small($1, $2)`, [hh, B]);
    expect(await settlements()).toMatchObject([{ status: "confirmed", kind: "writeoff" }]);
    expect(await openCount()).toBe("0");
    expect(await settledPosts()).toHaveLength(0);
    expect(await texts()).toHaveLength(1);
  });
});

describe("migration data step and surface", () => {
  it("a pre-existing marked transfer is finalized by the migration's loop", async () => {
    const id = await shared(A, [[A, 200], [B, 300]], "нан");
    await admin();
    await db.exec(`insert into public.settlements (id, household_id, from_id, to_id, amount, status) values ('00000000-0000-0000-0000-0000000000f1', '${hh}', '${B}', '${A}', 300, 'marked');
      insert into public.settlement_shares (settlement_id, household_id, purchase_id, debtor_id, amount) values ('00000000-0000-0000-0000-0000000000f1', '${hh}', '${id}', '${B}', 300)`);
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/0020_slice22_small_dates_noconfirm.sql"), "utf8");
    await db.exec(sql.slice(sql.lastIndexOf("do $$")));
    expect(await sel<{ status: string }>(`select status from public.settlements`)).toEqual([{ status: "confirmed" }]);
    expect(await sel<{ n: string }>(`select count(*)::text as n from public.shares where settled_at is not null`)).toEqual([{ n: "1" }]);
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
