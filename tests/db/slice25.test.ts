import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const A = "00000000-0000-0000-0000-00000000000a"; // admin
const B = "00000000-0000-0000-0000-00000000000b";
const C = "00000000-0000-0000-0000-00000000000c";
const X = "00000000-0000-0000-0000-00000000000e"; // a stranger
const SECRET = "slice25-secret";
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

let db: PGlite;
let hh: string;

async function as(user: string | null, role: "authenticated" | "anon" = "authenticated") {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ""}', false); set role ${role};`);
}
async function admin() {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
}
const texts = async (): Promise<string[]> => {
  await admin();
  return (await db.query<{ body: { text: string } }>(`select body from public.fake_http`)).rows.map((r) => r.body.text);
};
async function boot(upTo: string) {
  const d = new PGlite({ extensions: { pgcrypto } });
  await d.exec(STUB);
  for (const f of files(upTo)) await d.exec(readFileSync(join(MIG_DIR, f), "utf8"));
  await d.exec(`insert into auth.users values ('${A}'),('${B}'),('${C}'),('${X}');`);
  db = d;
  for (const [id, name] of [
    [A, "Нурдаулет"],
    [B, "Нурбол"],
    [C, "Ерасыл"],
    [X, "Чужой"],
  ]) {
    await as(id);
    await d.query(`select public.upsert_profile($1, '+77001234567')`, [name]);
  }
  await as(A);
  const h = await d.query<{ id: string; invite_code: string }>(`select * from public.create_household('Квартира 42')`);
  hh = h.rows[0].id;
  for (const u of [B, C]) {
    await as(u);
    await d.query(`select public.join_household($1)`, [h.rows[0].invite_code]);
  }
  await as(X);
  await d.query(`select * from public.create_household('Чужая')`);
  await admin();
  await d.exec(FAKE_TG);
  await d.exec(`insert into private.server_secrets values ('cron', encode(extensions.digest('${SECRET}', 'sha256'), 'hex'))`);
}
async function reset() {
  await admin();
  await db.exec(`truncate public.fake_http, public.settlement_shares, public.settlements, public.purchases, public.paid_prompts cascade;
    truncate private.telegram_sent;
    update public.households set telegram_chat_id = ${CHAT} where id = '${hh}';`);
}
async function buy(payer: string, amount: number, who: string[], title = "нан") {
  await as(payer);
  const r = await db.query<{ r: { id: string; purchase?: { id: string } } }>(
    `select to_jsonb(public.create_purchase_with_shares($1, $2, $3, null, $4)) as r`,
    [hh, amount, title, who],
  );
  return r.rows[0].r.purchase?.id ?? r.rows[0].r.id;
}
const net = async (a: string, b: string) => {
  await admin();
  return Number((await db.query<{ n: string }>(`select private.pair_net($1, $2, $3)::text as n`, [hh, a, b])).rows[0].n);
};
const purchases = async () => {
  await admin();
  return (await db.query<{ id: string; description: string }>(`select id, description from public.purchases order by created_at, id`)).rows;
};
const clearPosts = async () => {
  await admin();
  await db.exec(`truncate public.fake_http; truncate private.telegram_sent;`);
};

describe("A. delete just removes (slice 25)", () => {
  beforeAll(() => boot("0023"));
  afterAll(() => db.close());
  beforeEach(reset);

  it("A1: delete with a settled share -> no refund purchase, the 🗑 post has no «Вернётся»", async () => {
    const id = await buy(A, 3000, [A, B, C]);
    await as(B);
    await db.query(`select public.mark_settlement($1, $2)`, [hh, A]);
    await clearPosts();
    await as(A);
    await db.query(`select public.delete_purchase($1)`, [id]);
    expect(await purchases()).toEqual([]);
    expect(await net(A, B)).toBe(0);
    const t = await texts();
    expect(t).toEqual(["🗑 Нурдаулет удалил «нан» — 3 000 ₸"]);
    expect(t.join("\n")).not.toContain("Вернётся");
  });
});

describe("A2. the cleanup of the slice-24 refund purchases", () => {
  beforeAll(() => boot("0022"));
  afterAll(() => db.close());

  it("removes exactly the slice-24 refund shape and nothing else", async () => {
    await admin();
    await db.exec(`update public.households set telegram_chat_id = ${CHAT} where id = '${hh}'`);
    // the slice-24 shape: the old payer's share unsettled, the refund payer's own share 0 and settled
    const mk = async (payer: string, other: string, desc: string, otherAmount: number, otherSettled: boolean, payerAmount = 0, payerSettled = true) => {
      await admin();
      const id = (
        await db.query<{ id: string }>(
          `insert into public.purchases (household_id, payer_id, amount, description, source, status) values ($1, $2, $3, $4, 'manual', 'shared') returning id`,
          [hh, payer, otherAmount, desc],
        )
      ).rows[0].id;
      await db.query(`insert into public.shares (purchase_id, household_id, debtor_id, amount, settled_at) values ($1, $2, $3, $4, ${otherSettled ? "now()" : "null"})`, [id, hh, other, otherAmount]);
      await db.query(`insert into public.shares (purchase_id, household_id, debtor_id, amount, settled_at) values ($1, $2, $3, $4, ${payerSettled ? "now()" : "null"})`, [id, hh, payer, payerAmount]);
      await db.query(`insert into private.telegram_sent (kind, ref) values ('purchase', $1) on conflict do nothing`, [id]);
      return id;
    };
    const refund1 = await mk(B, A, "↩︎ Возврат: Хлеб", 500, false);
    const refund2 = await mk(C, A, "↩︎ Возврат: Су", 300, false);
    const lookalikeSettled = await mk(B, A, "↩︎ Возврат: Хлеб", 500, true); // the creditor's share is settled: kept
    const lookalikeOther = await mk(B, A, "Возврат долга", 500, false); // a different description: kept
    const realPayer = await mk(B, A, "↩︎ Возврат: Чай", 500, false, 250, false); // the payer's own share is real: kept
    await admin();
    await db.exec(`truncate public.fake_http`);
    await db.exec(readFileSync(join(MIG_DIR, "0023_slice25_plain_delete_received.sql"), "utf8"));
    expect((await purchases()).map((p) => p.id).sort()).toEqual([lookalikeSettled, lookalikeOther, realPayer].sort());
    const sent = (await db.query<{ ref: string }>(`select ref from private.telegram_sent`)).rows.map((r) => r.ref);
    expect(sent).not.toContain(refund1);
    expect(sent).not.toContain(refund2);
    expect(sent).toContain(lookalikeOther);
    expect(await texts()).toEqual([]); // no Telegram post for the cleanup
  });
});

describe("B. the creditor marks «X перевёл мне»", () => {
  beforeAll(() => boot("0023"));
  afterAll(() => db.close());
  beforeEach(reset);

  it("B1: the creditor marks received -> settlement confirmed, shares settled, pair_net 0, one «рассчитались» post", async () => {
    await buy(A, 3000, [A, B, C]); // B owes A 1000
    await clearPosts();
    await as(A);
    const r = await db.query<{ s: { status: string; from_id: string; to_id: string; amount: number } }>(`select to_jsonb(public.mark_received($1, $2)) as s`, [hh, B]);
    expect(r.rows[0].s).toMatchObject({ status: "confirmed", from_id: B, to_id: A, amount: 1000 });
    expect(await net(B, A)).toBe(0);
    expect(await net(C, A)).toBe(1000); // someone else's debt is untouched
    await admin();
    const open = await db.query(`select 1 from public.shares where debtor_id = $1 and settled_at is null and amount > 0`, [B]);
    expect(open.rows).toHaveLength(0);
    const t = await texts();
    expect(t).toHaveLength(1);
    expect(t[0]).toContain("рассчитал");
  });

  it("B2: not owed / debtor side / self / stranger / not a member / below the minimum / anon -> errors", async () => {
    await as(A);
    await expect(db.query(`select public.mark_received($1, $2)`, [hh, B])).rejects.toMatchObject({ code: "23514" }); // nothing owed
    await buy(A, 3000, [A, B, C]);
    await as(B);
    await expect(db.query(`select public.mark_received($1, $2)`, [hh, A])).rejects.toMatchObject({ code: "23514" }); // B is the debtor
    await expect(db.query(`select public.mark_received($1, $2)`, [hh, B])).rejects.toMatchObject({ code: "23514" }); // self
    await as(X);
    await expect(db.query(`select public.mark_received($1, $2)`, [hh, B])).rejects.toMatchObject({ code: "42501" }); // stranger
    await as(A);
    await expect(db.query(`select public.mark_received($1, $2)`, [hh, X])).rejects.toMatchObject({ code: "23503" }); // not a member
    await reset();
    await buy(A, 150, [A, B]); // 75 owed
    await as(A);
    await expect(db.query(`select public.mark_received($1, $2)`, [hh, B])).rejects.toThrow(/too_small/);
    await as(null, "anon");
    await expect(db.query(`select public.mark_received($1, $2)`, [hh, B])).rejects.toThrow();
  });

  it("B3: nothing_owed message, and the anon surface stays 13", async () => {
    await as(A);
    await expect(db.query(`select public.mark_received($1, $2)`, [hh, B])).rejects.toThrow(/nothing_owed/);
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

describe("C. the «Ты перевёл?» notice after 20 s", () => {
  beforeAll(() => boot("0023"));
  afterAll(() => db.close());
  beforeEach(reset);

  it("C1: a 20-s-old prompt is asked, a 5-s-old one is not", async () => {
    await buy(A, 3000, [A, B, C]);
    await as(B);
    await db.query(`select public.open_paid_prompt($1, $2)`, [hh, A]);
    await admin();
    const id = (await db.query<{ id: string }>(`select id from public.paid_prompts`)).rows[0].id;
    await db.query(`update public.paid_prompts set opened_at = now() - interval '5 seconds' where id = $1`, [id]);
    await as(null, "anon");
    expect((await db.query<{ r: { ask: boolean } }>(`select public.paid_prompt_notice($1, $2) as r`, [SECRET, id])).rows[0].r.ask).toBe(false);
    await admin();
    await db.query(`update public.paid_prompts set opened_at = now() - interval '20 seconds' where id = $1`, [id]);
    await as(null, "anon");
    expect((await db.query<{ r: { ask: boolean } }>(`select public.paid_prompt_notice($1, $2) as r`, [SECRET, id])).rows[0].r.ask).toBe(true);
  });
});
