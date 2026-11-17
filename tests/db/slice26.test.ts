import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const A = "00000000-0000-0000-0000-00000000000a"; // admin, payer
const B = "00000000-0000-0000-0000-00000000000b";
const C = "00000000-0000-0000-0000-00000000000c";
const D = "00000000-0000-0000-0000-00000000000d";

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
const MIG_DIR = join(process.cwd(), "supabase/migrations");
const files = (upTo: string) =>
  readdirSync(MIG_DIR)
    .filter((f) => f.endsWith(".sql") && f.slice(0, 4) <= upTo)
    .sort();

type Row = {
  id: string;
  payer_id: string;
  amount: number;
  status: string;
  shares: Array<{ debtor_id: string; amount: number; settled_at: string | null }>;
  orders: Array<{ purchase_id: string; user_id: string; amount: number; note: string | null }>;
};

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
const mine = (payer: string, amount: number, more: Array<{ user_id: string; amount: number; note?: string }> = []) =>
  JSON.stringify([{ user_id: payer, amount, note: null }, ...more]);
async function create(user: string, amount: number, who: string[], orders: string, desc = "Продукты"): Promise<Row> {
  await as(user);
  return (await db.query<{ r: Row }>(`select public.create_purchase_with_orders($1, $2, $3, null, $4::uuid[], $5::jsonb) r`, [hh, amount, desc, who, orders])).rows[0].r;
}
const shareOf = (r: Row, u: string) => r.shares.find((s) => s.debtor_id === u);
const net = async (a: string, b: string) => {
  await admin();
  return Number((await db.query<{ n: string }>(`select private.pair_net($1, $2, $3)::text as n`, [hh, a, b])).rows[0].n);
};
const tgText = async (id: string) => {
  await admin();
  return (await db.query<{ t: string }>(`select private.tg_purchase_message($1) t`, [id])).rows[0].t;
};

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUB);
  for (const f of files("0024")) await db.exec(readFileSync(join(MIG_DIR, f), "utf8"));
  await db.exec(`insert into auth.users values ('${A}'),('${B}'),('${C}'),('${D}');`);
  for (const [id, name] of [[A, "Ерасыл"], [B, "Айдос"], [C, "Даня"], [D, "Нурдаулет"]]) {
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
  await db.exec(`update public.members set joined_at = now() - interval '4 days' where user_id = '${A}';
    update public.members set joined_at = now() - interval '3 days' where user_id = '${B}';
    update public.members set joined_at = now() - interval '2 days' where user_id = '${C}';
    update public.members set joined_at = now() - interval '1 days' where user_id = '${D}';`);
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await admin();
  await db.exec(`delete from public.purchases; delete from public.settlements;
    update public.members set active = true, away_until = null; update public.households set telegram_chat_id = null;
    delete from private.telegram_sent;`);
});

describe("«Из них моё»: the payer's own part", () => {
  it("3 000, моё 1 000, four people: 500 × 3 owed, the payer's 1 500 settled; nobody owes the payer's part", async () => {
    const r = await create(A, 3000, [A, B, C, D], mine(A, 1000));
    for (const u of [B, C, D]) {
      expect(shareOf(r, u)?.amount).toBe(500);
      expect(shareOf(r, u)?.settled_at).toBeNull();
    }
    expect(shareOf(r, A)?.amount).toBe(1500);
    expect(shareOf(r, A)?.settled_at).not.toBeNull();
    expect(r.shares).toHaveLength(4);
    expect(r.shares.reduce((s, x) => s + x.amount, 0)).toBe(3000);
    expect(r.orders).toEqual([{ purchase_id: r.id, user_id: A, amount: 1000, note: null }]);
    expect(await net(B, A)).toBe(500);
    expect(await net(C, A)).toBe(500);
    expect(await net(D, A)).toBe(500);
    expect(await net(B, C)).toBe(0);
  });
  it("моё goes together with other people's orders", async () => {
    const r = await create(A, 3000, [A, B, C, D], mine(A, 1000, [{ user_id: D, amount: 400, note: "сок" }]));
    // rest 1 600 / 4 = 400
    expect(shareOf(r, A)?.amount).toBe(1400);
    expect(shareOf(r, B)?.amount).toBe(400);
    expect(shareOf(r, D)?.amount).toBe(800);
    expect(await net(D, A)).toBe(800);
  });
  it("a payer who is not a participant keeps only his part, settled", async () => {
    const r = await create(A, 3000, [B, C], mine(A, 1000));
    expect(shareOf(r, A)?.amount).toBe(1000);
    expect(shareOf(r, A)?.settled_at).not.toBeNull();
    expect(shareOf(r, B)?.amount).toBe(1000);
    expect(await net(B, A)).toBe(1000);
  });
  it("two payer parts are an error", async () => {
    await expectCode(create(A, 3000, [A, B, C, D], JSON.stringify([{ user_id: A, amount: 500 }, { user_id: A, amount: 500 }])), "23514");
  });
  it("моё leaving too little for the others is an error", async () => {
    await expectCode(create(A, 1000, [A, B, C, D], mine(A, 997)), "23514");
    await expectCode(create(A, 1000, [A, B], mine(A, 1000)), "23514");
    await admin();
    expect((await db.query(`select 1 from public.purchases`)).rows).toHaveLength(0);
  });
  it("Telegram: the payer's part sits on the «Платил» line, not as a «+ заказ»", async () => {
    await admin();
    await db.exec(`update public.profiles set telegram_username = 'yerasyl' where id = '${A}'`);
    const r = await create(A, 3000, [A, B, C, D], mine(A, 1000, [{ user_id: D, amount: 400 }]));
    const text = await tgText(r.id);
    expect(text).toContain("Платил: @yerasyl (себе 1 000 ₸)");
    expect(text).not.toContain("+ заказ: @yerasyl");
    expect(text).toContain("+ заказ: Нурдаулет 400 ₸");
    expect(text).toContain("Айдос — 400 ₸");
    const plain = await create(A, 900, [A, B, C], "[]");
    expect(await tgText(plain.id)).not.toContain("себе");
  });
});

describe("the other entry points accept the payer's part", () => {
  it("resolve_pending_with_orders", async () => {
    await admin();
    const id = (
      await db.query<{ id: string }>(
        `insert into public.purchases (household_id, payer_id, amount, description, source, status) values ($1, $2, 3000, 'Apple Pay', 'apple_pay', 'pending') returning id`,
        [hh, A],
      )
    ).rows[0].id;
    await as(A);
    const r = (await db.query<{ r: Row }>(`select public.resolve_pending_with_orders($1, 'Продукты', $2::uuid[], $3::jsonb) r`, [id, [A, B, C, D], mine(A, 1000)])).rows[0].r;
    expect(r.status).toBe("shared");
    expect(shareOf(r, A)?.amount).toBe(1500);
    expect(shareOf(r, B)?.amount).toBe(500);
    expect(await net(C, A)).toBe(500);
  });
  it("update_purchase, also when the payer changes (моё follows the new payer)", async () => {
    const r = await create(A, 3000, [A, B, C, D], "[]");
    await as(A);
    const u = (await db.query<{ r: Row }>(`select public.update_purchase($1, 3000, 'Правка', $2, $3::uuid[], $4::jsonb) r`, [r.id, A, [A, B, C, D], mine(A, 1000)])).rows[0].r;
    expect(shareOf(u, A)?.amount).toBe(1500);
    expect(shareOf(u, D)?.amount).toBe(500);
    const v = (await db.query<{ r: Row }>(`select public.update_purchase($1, 3000, 'Правка', $2, $3::uuid[], $4::jsonb) r`, [r.id, B, [A, B, C, D], mine(B, 1000)])).rows[0].r;
    expect(shareOf(v, B)?.amount).toBe(1500);
    expect(shareOf(v, B)?.settled_at).not.toBeNull();
    expect(shareOf(v, A)?.amount).toBe(500);
    expect(await net(A, B)).toBe(500);
    await as(A);
    await expectCode(
      db.query(`select public.update_purchase($1, 3000, 'x', $2, $3::uuid[], $4::jsonb)`, [r.id, B, [A, B], JSON.stringify([{ user_id: B, amount: 1 }, { user_id: B, amount: 1 }])]),
      "23514",
    );
  });
});

describe("surface", () => {
  it("the anon surface stays thirteen", async () => {
    await admin();
    const r = await db.query<{ n: string }>(
      `select p.proname n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname in ('public', 'private') and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')
         and p.proname not in ('uid')`,
    );
    expect(r.rows).toHaveLength(13);
  });
  it("check_orders stays private", async () => {
    await admin();
    const r = await db.query<{ auth: boolean; anon: boolean }>(
      `select has_function_privilege('authenticated', 'private.check_orders(uuid, uuid, integer, jsonb)', 'execute') auth,
              has_function_privilege('anon', 'private.check_orders(uuid, uuid, integer, jsonb)', 'execute') anon`,
    );
    expect(r.rows[0]).toEqual({ auth: false, anon: false });
  });
});
