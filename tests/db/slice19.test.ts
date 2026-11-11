import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const A = "00000000-0000-0000-0000-00000000000a"; // admin (creator)
const B = "00000000-0000-0000-0000-00000000000b"; // member, @aidos_k
const C = "00000000-0000-0000-0000-00000000000c"; // member
const SECRET = "slice19-secret";

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
async function buy(payer: string, amount: number, who: string[]) {
  await as(payer);
  const r = await db.query<{ r: { id: string } }>(`select to_jsonb(public.create_purchase_with_shares($1, $2, 'нан', null, $3)) as r`, [hh, amount, who]);
  const v = r.rows[0].r as unknown as { purchase?: { id: string }; id?: string };
  return v.purchase?.id ?? (v.id as string);
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

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUB);
  for (const file of MIGRATIONS) await db.exec(readFileSync(join(process.cwd(), "supabase/migrations", file), "utf8"));
  await db.exec(`insert into auth.users values ('${A}'),('${B}'),('${C}');`);
  for (const [id, name] of [[A, "Нурдаулет"], [B, "Нурбол"], [C, "Даня"]]) {
    await as(id);
    await db.query(`select public.upsert_profile($1, '+77001234567')`, [name]);
  }
  await as(B);
  await db.query(`select public.set_telegram_username('@nurbol')`);
  const h = await db.query<{ id: string; invite_code: string }>(`select * from public.create_household('Квартира 42')`);
  hh = h.rows[0].id;
  for (const u of [A, C]) {
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
beforeEach(async () => {
  await admin();
  await db.exec(
    `delete from public.fake_http; delete from public.pay_links; delete from public.paid_prompts; delete from public.settlement_shares; delete from public.settlements; delete from public.purchases; delete from public.reminder_log;
     delete from private.settlement_ops; update public.households set telegram_chat_id = null;`,
  );
});

const net = async (a: string, b: string) => {
  await admin();
  return Number((await db.query<{ n: string }>(`select private.pair_net($1, $2, $3) as n`, [hh, a, b])).rows[0].n);
};
const mark = async (from: string, to: string) => {
  await as(from);
  return (await db.query<{ r: { id: string; amount: number } }>(`select to_jsonb(public.mark_settlement($1, $2)) as r`, [hh, to])).rows[0].r;
};
const confirm = async (by: string, id: string) => {
  await as(by);
  return (await db.query(`select public.confirm_settlement($1)`, [id])).rows;
};
const cancel = async (by: string, id: string) => {
  await as(by);
  return (await db.query(`select public.cancel_settlement($1)`, [id])).rows;
};
const remind = async (creditor: string, debtor: string) => {
  await as(creditor);
  return (await db.query<{ r: { amount: number } }>(`select public.remind($1, $2, $3) as r`, [SECRET, hh, debtor])).rows[0].r;
};
const posts = async () => {
  await admin();
  return (await db.query<{ body: { text: string; reply_markup?: { inline_keyboard: Array<Array<{ text: string; url: string }>> } } }>(`select body from public.fake_http`)).rows.map((r) => r.body);
};
const linkOpen = async (code: string, open: boolean, secret = SECRET) => {
  await as(null, "anon");
  return (await db.query<{ r: { state: string; amount?: number; to_name?: string; to_phone?: string; from_name?: string; prompt_id?: string | null } }>(`select public.pay_link_open($1, $2, $3) as r`, [secret, code, open])).rows[0].r;
};
const linkAnswer = async (code: string, prompt: string, yes: boolean, secret = SECRET) => {
  await as(null, "anon");
  return (await db.query<{ r: { result: string; to_name: string } }>(`select public.pay_link_answer($1, $2, $3, $4) as r`, [secret, code, prompt, yes])).rows[0].r;
};
const links = async () => {
  await admin();
  return (await db.query<{ code: string; from_user: string; to_user: string; opened_at: string | null }>(`select code, from_user, to_user, opened_at from public.pay_links`)).rows;
};
const markedRows = async () => {
  await admin();
  return (await db.query<{ from_id: string; to_id: string; amount: number }>(`select from_id, to_id, amount from public.settlements where status = 'marked'`)).rows;
};
const markedId = async () => {
  await admin();
  return (await db.query<{ id: string }>(`select id from public.settlements where status = 'marked'`)).rows[0].id;
};
const coveredOf = async (id: string) => {
  await admin();
  return (await db.query(`select 1 from public.settlement_shares where settlement_id = $1`, [id])).rows.length;
};

/** The live case: B (Нурбол) paid A (Нурдаулет) 150 and marked it; later A owes B 450. */
async function liveCase() {
  await buy(A, 300, [A, B]); // B owes A 150
  const st = await mark(B, A);
  await buy(B, 900, [A, B]); // A owes B 450
  return st;
}

describe("A. a marked transfer counts as paid", () => {
  it("the live case: 450 owed, not 450 - 150 = 300", async () => {
    await liveCase();
    expect(await net(A, B)).toBe(450);
    expect(await net(B, A)).toBe(-450);
  });
  it("reject (cancel) puts the share back: 300", async () => {
    const st = await liveCase();
    await cancel(B, st.id);
    expect(await net(A, B)).toBe(300);
  });
  it("confirm keeps it settled: still 450", async () => {
    const st = await liveCase();
    await confirm(A, st.id);
    expect(await net(A, B)).toBe(450);
    await admin();
    const settled = await db.query(`select 1 from public.shares where settled_at is not null and settlement_id is not null and debtor_id = '${B}'`);
    expect(settled.rows).toHaveLength(1);
  });
  it("marking itself takes the debt out of the net; the rows stay open until confirmed", async () => {
    await buy(A, 600, [A, B, C]); // B and C owe A 200
    await mark(B, A);
    expect(await net(B, A)).toBe(0);
    await admin();
    const open = await db.query(`select 1 from public.shares where debtor_id = '${B}' and settled_at is null`);
    expect(open.rows).toHaveLength(1);
  });
  it("a re-mark of my own pending settlement re-records its own shares", async () => {
    await buy(A, 600, [A, B, C]);
    const st = await mark(B, A);
    expect(st.amount).toBe(200);
    await buy(A, 400, [A, B]); // B owes 200 more
    const again = await mark(B, A);
    expect(again.id).toBe(st.id);
    expect(again.amount).toBe(400);
    expect(await coveredOf(st.id)).toBe(2);
    expect(await markedRows()).toEqual([{ from_id: B, to_id: A, amount: 400 }]);
  });
  it("the other side cannot mark the same covered shares again", async () => {
    await buy(A, 600, [A, B, C]);
    await mark(B, A);
    await as(A);
    await expect(db.query(`select public.mark_settlement($1, $2)`, [hh, B])).rejects.toMatchObject({ code: "23514" });
    expect(await markedRows()).toHaveLength(1);
  });
  it("the daily reminder job skips an in-flight debt", async () => {
    await buy(A, 600, [A, B, C]);
    await admin();
    await db.exec(`update public.purchases set created_at = now() - interval '2 days'`);
    await as(null, "anon");
    const before = (await db.query<{ r: unknown[] }>(`select public.run_daily_reminders($1) as r`, [SECRET])).rows[0].r;
    expect(before).toHaveLength(2);
    await admin();
    await db.exec(`delete from public.reminder_log`);
    await mark(B, A);
    await as(null, "anon");
    const after = (await db.query<{ r: Array<{ to_user: string }> }>(`select public.run_daily_reminders($1) as r`, [SECRET])).rows[0].r;
    expect(after.map((x) => x.to_user)).toEqual([C]);
  });
  it("answering the sheet «yes» after the PWA already marked is «marked», without a second settlement", async () => {
    await buy(A, 600, [A, B, C]);
    await as(B);
    const p = (await db.query<{ r: { id: string } }>(`select to_jsonb(public.open_paid_prompt($1, $2)) as r`, [hh, A])).rows[0].r;
    await mark(B, A);
    await as(B);
    const out = (await db.query<{ r: { result: string } }>(`select public.answer_paid_prompt($1, true) as r`, [p.id])).rows[0].r;
    expect(out.result).toBe("marked");
    expect(await markedRows()).toHaveLength(1);
  });
  it("leaving is still refused while a transfer with that person is pending", async () => {
    await buy(A, 600, [A, B]); // B owes A 300
    await mark(B, A);
    await admin();
    expect((await db.query<{ b: boolean }>(`select private.has_open_net($1, $2) as b`, [hh, B])).rows[0].b).toBe(true);
  });
  it("a write-off does not cancel or swallow the debtor's pending mark", async () => {
    await buy(A, 600, [A, B]); // B owes A 300
    await mark(B, A);
    await buy(A, 150, [A, B]); // B owes 75 more (open)
    await as(A);
    await db.query(`select public.write_off_small($1, $2)`, [hh, B]);
    expect(await markedRows()).toEqual([{ from_id: B, to_id: A, amount: 300 }]);
    expect(await net(B, A)).toBe(0);
  });
});

describe("remind", () => {
  it("posts the «И подтверди» line when the creditor already sent money, plus the Перевести button", async () => {
    await liveCase();
    await admin();
    await db.exec(`update public.households set telegram_chat_id = ${CHAT}`);
    expect(await remind(B, A)).toMatchObject({ amount: 450 });
    const [p] = await posts();
    expect(p.text).toContain("ты должен @nurbol 450");
    expect(p.text).toContain("\nИ подтверди, что @nurbol перевёл тебе 150");
    const btn = p.reply_markup!.inline_keyboard[0][0];
    expect(btn.text).toBe("💸 Перевести 450 ₸");
    const [link] = await links();
    expect(link).toMatchObject({ from_user: A, to_user: B, opened_at: null });
    expect(btn.url).toBe(`https://obshak-gules.vercel.app/k/${link.code}`);
    expect(link.code).toMatch(/^[A-Za-z0-9_-]{12}$/);
  });
  it("has no extra line when nothing is pending, and no message or link without a group chat", async () => {
    await buy(A, 600, [A, B]); // B owes A 300
    await admin();
    await db.exec(`update public.households set telegram_chat_id = ${CHAT}`);
    await remind(A, B);
    const [p] = await posts();
    expect(p.text).not.toContain("И подтверди");
    expect(await links()).toHaveLength(1);
    await admin();
    await db.exec(`delete from public.fake_http; delete from public.pay_links; delete from public.reminder_log; update public.households set telegram_chat_id = null`);
    await remind(A, B);
    expect(await posts()).toEqual([]);
    expect(await links()).toEqual([]);
  });
});

describe("pay_link_open", () => {
  async function linkFor(debtor: string, creditor: string) {
    await admin();
    await db.exec(`update public.households set telegram_chat_id = ${CHAT}`);
    await remind(creditor, debtor);
    return (await links())[0].code;
  }
  it("pay: shows who to pay and how much; a plain view records nothing", async () => {
    await buy(A, 600, [A, B]); // B owes A 300
    const code = await linkFor(B, A);
    expect(await linkOpen(code, false)).toMatchObject({ state: "pay", amount: 300, to_name: "Нурдаулет", to_phone: "+77001234567", from_name: "Нурбол", prompt_id: null });
    await admin();
    expect((await db.query(`select 1 from public.paid_prompts`)).rows).toHaveLength(0);
    expect((await links())[0].opened_at).toBeNull();
  });
  it("open = true creates exactly one pending prompt, however often it is opened", async () => {
    await buy(A, 600, [A, B]);
    const code = await linkFor(B, A);
    const first = await linkOpen(code, true);
    const second = await linkOpen(code, true);
    expect(first.state).toBe("pay");
    expect(second.prompt_id).toBe(first.prompt_id);
    await admin();
    const rows = await db.query<{ status: string; amount: number }>(`select status, amount from public.paid_prompts`);
    expect(rows.rows).toEqual([{ status: "pending", amount: 300 }]);
    expect((await links())[0].opened_at).not.toBeNull();
  });
  it("small: below 100, nothing is recorded", async () => {
    await buy(A, 600, [A, B]);
    const code = await linkFor(B, A);
    await buy(B, 500, [A, B]); // A owes B 250 -> B owes A 50
    expect(await linkOpen(code, true)).toMatchObject({ state: "small", amount: 50, prompt_id: null });
    await admin();
    expect((await db.query(`select 1 from public.paid_prompts`)).rows).toHaveLength(0);
  });
  it("paid: the transfer is already marked; back to pay when it is withdrawn", async () => {
    await buy(A, 600, [A, B]);
    const code = await linkFor(B, A);
    await mark(B, A);
    expect(await linkOpen(code, true)).toMatchObject({ state: "paid", amount: 0, prompt_id: null });
    await cancel(B, await markedId());
    expect(await linkOpen(code, false)).toMatchObject({ state: "pay", amount: 300 });
  });
  it("expired: unknown code, past expiry, or a member who left", async () => {
    await buy(A, 600, [A, B]);
    const code = await linkFor(B, A);
    expect(await linkOpen("nope-nope-nope", false)).toEqual({ state: "expired" });
    await admin();
    await db.query(`update public.pay_links set expires_at = now() - interval '1 minute' where code = $1`, [code]);
    expect(await linkOpen(code, true)).toEqual({ state: "expired" });
    await admin();
    await db.query(`update public.pay_links set expires_at = now() + interval '1 day' where code = $1`, [code]);
    expect(await linkOpen(code, false)).toMatchObject({ state: "pay" });
    await admin();
    await db.query(`update public.members set active = false where user_id = $1`, [A]);
    expect(await linkOpen(code, false)).toEqual({ state: "expired" });
    await admin();
    await db.query(`update public.members set active = true where user_id = $1`, [A]);
  });
  it("a wrong secret is 28000 and the table is closed to every client", async () => {
    await expectCode(linkOpen("whatever-code", false, "wrong"), "28000");
    await as(B);
    await expectCode(db.query(`select * from public.pay_links`), "42501");
    await as(null, "anon");
    await expectCode(db.query(`select * from public.pay_links`), "42501");
  });
});

describe("pay_link_answer", () => {
  async function opened() {
    await buy(A, 600, [A, B]);
    await admin();
    await db.exec(`update public.households set telegram_chat_id = ${CHAT}`);
    await remind(A, B);
    const code = (await links())[0].code;
    const o = await linkOpen(code, true);
    return { code, prompt: o.prompt_id as string };
  }
  it("yes marks the settlement; the creditor still confirms", async () => {
    const { code, prompt } = await opened();
    expect(await linkAnswer(code, prompt, true)).toMatchObject({ result: "marked", to_name: "Нурдаулет" });
    expect(await markedRows()).toEqual([{ from_id: B, to_id: A, amount: 300 }]);
    expect(await linkAnswer(code, prompt, true)).toMatchObject({ result: "already" });
  });
  it("no only closes the prompt", async () => {
    const { code, prompt } = await opened();
    expect(await linkAnswer(code, prompt, false)).toMatchObject({ result: "no" });
    expect(await markedRows()).toEqual([]);
  });
  it("a prompt of another pair is refused", async () => {
    const { code } = await opened();
    await buy(C, 600, [C, B]);
    await as(B);
    const other = (await db.query<{ r: { id: string } }>(`select to_jsonb(public.open_paid_prompt($1, $2)) as r`, [hh, C])).rows[0].r;
    await expectCode(linkAnswer(code, other.id, true), "42501");
    await expectCode(linkAnswer(code, "00000000-0000-0000-0000-0000000000ff", true), "42501");
    expect(await markedRows()).toEqual([]);
  });
  it("a wrong secret is 28000; an unknown link is expired", async () => {
    const { code, prompt } = await opened();
    await expectCode(linkAnswer(code, prompt, true, "wrong"), "28000");
    expect(await linkAnswer("no-such-link-1", prompt, true)).toMatchObject({ result: "expired" });
  });
});

describe("paid_prompt_notice without a session", () => {
  it("the anon server client may ask for the delayed question (secret only)", async () => {
    await buy(A, 600, [A, B]);
    await as(B);
    const p = (await db.query<{ r: { id: string } }>(`select to_jsonb(public.open_paid_prompt($1, $2)) as r`, [hh, A])).rows[0].r;
    await admin();
    await db.query(`update public.paid_prompts set opened_at = now() - interval '150 seconds' where id = $1`, [p.id]);
    await as(null, "anon");
    const n = (await db.query<{ r: { ask: boolean; to_name: string } }>(`select public.paid_prompt_notice($1, $2) as r`, [SECRET, p.id])).rows[0].r;
    expect(n).toMatchObject({ ask: true, to_name: "Нурдаулет" });
    await expectCode(db.query(`select public.paid_prompt_notice('bad', $1)`, [p.id]), "28000");
  });
});

describe("surface", () => {
  it("the anon surface is thirteen: ten before + pay_link_open, pay_link_answer, paid_prompt_notice", async () => {
    await admin();
    const r = await db.query<{ n: string }>(
      `select p.proname n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname in ('public', 'private') and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')
         and p.proname not in ('uid', 'http_post')
       order by 1`,
    );
    expect(r.rows).toHaveLength(13);
    for (const n of ["pay_link_open", "pay_link_answer", "paid_prompt_notice"]) expect(r.rows.map((x) => x.n)).toContain(n);
    for (const hidden of ["open_paid_prompt_for", "tg_send_markup", "app_url", "paid_prompt_answer", "open_pair_shares"]) {
      expect(r.rows.map((x) => x.n)).not.toContain(hidden);
    }
  });
  it("every new function is security definer with an empty search_path", async () => {
    await admin();
    const r = await db.query<{ proname: string; definer: boolean; cfg: string[] | null }>(
      `select p.proname, p.prosecdef definer, p.proconfig cfg from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname in ('public', 'private') and p.proname in ('pay_link_open','pay_link_answer','open_paid_prompt_for','tg_send_markup','app_url')`,
    );
    expect(r.rows).toHaveLength(5);
    for (const f of r.rows) {
      if (f.proname !== "app_url") expect(f.definer).toBe(true);
      expect(f.cfg).toContain(`search_path=""`);
    }
  });
});
