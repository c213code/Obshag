import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const A = "00000000-0000-0000-0000-00000000000a"; // admin, payer
const B = "00000000-0000-0000-0000-00000000000b";
const C = "00000000-0000-0000-0000-00000000000c";
const D = "00000000-0000-0000-0000-00000000000d";
const E = "00000000-0000-0000-0000-00000000000e"; // outsider

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

type Row = {
  id: string;
  payer_id: string;
  amount: number;
  status: string;
  description: string;
  shares: Array<{ debtor_id: string; amount: number; settled_at: string | null }>;
  orders: Array<{ purchase_id: string; user_id: string; amount: number; note: string | null }>;
};

let db: PGlite;
let hh: string;
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
const ord = (user: string, amount: number, note?: string) => JSON.stringify([{ user_id: user, amount, ...(note ? { note } : {}) }]);
async function create(user: string, amount: number, who: string[], orders: string, desc = "Продукты"): Promise<Row> {
  await as(user);
  return (await db.query<{ r: Row }>(`select public.create_purchase_with_orders($1, $2, $3, null, $4::uuid[], $5::jsonb) r`, [hh, amount, desc, who, orders])).rows[0].r;
}
const shareOf = (r: Row, u: string) => r.shares.find((s) => s.debtor_id === u)?.amount;

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUB);
  for (const file of MIGRATIONS) await db.exec(readFileSync(join(process.cwd(), "supabase/migrations", file), "utf8"));
  await db.exec(`insert into auth.users values ('${A}'),('${B}'),('${C}'),('${D}'),('${E}');`);
  for (const [id, name] of [[A, "Ерасыл"], [B, "Айдос"], [C, "Даня"], [D, "Нурдаулет"], [E, "Чужой"]]) {
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
  await as(A);
  water = (await db.query<{ id: string }>(`select id from public.create_duty($1, 'water', 'Вода', null, $2)`, [hh, [A, B, C, D]])).rows[0].id;
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await admin();
  await db.exec(`delete from public.purchases; delete from public.settlements; delete from public.duty_events;
    update public.members set active = true, away_until = null; update public.households set telegram_chat_id = null;
    delete from private.telegram_sent;`);
});

describe("orders math", () => {
  it("3000, four people, Нурдаулет orders 500: 625 / 625 / 625 / 1125, the payer's part settled", async () => {
    const r = await create(A, 3000, [A, B, C, D], ord(D, 500, "энергетик"));
    expect(shareOf(r, A)).toBe(625);
    expect(shareOf(r, B)).toBe(625);
    expect(shareOf(r, C)).toBe(625);
    expect(shareOf(r, D)).toBe(1125);
    expect(r.shares.reduce((s, x) => s + x.amount, 0)).toBe(3000);
    expect(r.shares.find((s) => s.debtor_id === A)?.settled_at).not.toBeNull();
    expect(r.shares.find((s) => s.debtor_id === D)?.settled_at).toBeNull();
    expect(r.orders).toEqual([{ purchase_id: r.id, user_id: D, amount: 500, note: "энергетик" }]);
  });
  it("the remainder goes to non-payers in participant order", async () => {
    const r = await create(A, 1000, [A, B, C, D], ord(D, 1)); // rest 999 / 4 = 249 r 3
    expect(shareOf(r, A)).toBe(249);
    expect(shareOf(r, B)).toBe(250);
    expect(shareOf(r, C)).toBe(250);
    expect(shareOf(r, D)).toBe(251);
  });
  it("a person outside the participants pays only for the order; several orders of one person add up", async () => {
    const orders = JSON.stringify([{ user_id: D, amount: 300 }, { user_id: D, amount: 200, note: "чипсы" }]);
    const r = await create(A, 2000, [A, B], orders);
    expect(shareOf(r, D)).toBe(500);
    expect(shareOf(r, A)).toBe(750);
    expect(shareOf(r, B)).toBe(750);
    expect(r.orders).toHaveLength(2);
  });
  it("rest smaller than the number of participants is an error", async () => {
    await expectCode(create(A, 1000, [A, B, C, D], ord(D, 998)), "23514");
    await expectCode(create(A, 1000, [A, B], ord(D, 1000)), "23514");
  });
  it("an order by the payer, a stranger, a bad amount, a long note or more than 20 rows is rejected", async () => {
    await expectCode(create(A, 3000, [A, B], ord(A, 500)), "23514");
    await expectCode(create(A, 3000, [A, B], ord(E, 500)), "23503");
    await expectCode(create(A, 3000, [A, B], ord(D, 0)), "23514");
    await expectCode(create(A, 3000, [A, B], JSON.stringify([{ user_id: D, amount: 5, note: "x".repeat(61) }])), "23514");
    const many = JSON.stringify(Array.from({ length: 21 }, () => ({ user_id: D, amount: 1 })));
    await expectCode(create(A, 3000, [A, B], many), "23514");
  });
  it("a non-member cannot create, an empty orders array behaves like the plain purchase", async () => {
    await as(E);
    await expectCode(db.query(`select public.create_purchase_with_orders($1, 900, 'x', null, $2::uuid[], '[]'::jsonb)`, [hh, [A, B, C]]), "42501");
    const r = await create(A, 900, [A, B, C], "[]");
    expect(r.shares.map((s) => s.amount)).toEqual([300, 300, 300]);
    expect(r.orders).toEqual([]);
  });
  it("members read the orders, outsiders do not, nobody writes directly", async () => {
    const r = await create(A, 3000, [A, B, C, D], ord(D, 500));
    await as(B);
    expect((await db.query(`select * from public.purchase_orders where purchase_id = $1`, [r.id])).rows).toHaveLength(1);
    await as(E);
    expect((await db.query(`select * from public.purchase_orders where purchase_id = $1`, [r.id])).rows).toHaveLength(0);
    await as(B);
    await expectCode(db.query(`insert into public.purchase_orders (purchase_id, household_id, user_id, amount) values ($1, $2, $3, 5)`, [r.id, hh, B]), "42501");
  });
});

describe("resolve_pending_with_orders", () => {
  async function pending(): Promise<string> {
    await admin();
    return (
      await db.query<{ id: string }>(
        `insert into public.purchases (household_id, payer_id, amount, description, source, status) values ($1, $2, 3000, 'Apple Pay', 'apple_pay', 'pending') returning id`,
        [hh, A],
      )
    ).rows[0].id;
  }
  it("shares a capture with an order, idempotently", async () => {
    const id = await pending();
    await as(A);
    const r = (await db.query<{ r: Row }>(`select public.resolve_pending_with_orders($1, 'Продукты', $2::uuid[], $3::jsonb) r`, [id, [A, B, C, D], ord(D, 500)])).rows[0].r;
    expect(shareOf(r, D)).toBe(1125);
    expect(shareOf(r, B)).toBe(625);
    expect(r.status).toBe("shared");
    const again = (await db.query<{ r: Row }>(`select public.resolve_pending_with_orders($1, null, $2::uuid[], $3::jsonb) r`, [id, [A, B, C, D], ord(D, 500)])).rows[0].r;
    expect(again.shares).toHaveLength(4);
    expect(again.orders).toHaveLength(1);
  });
  it("only the payer; a personal purchase stays resolved", async () => {
    const id = await pending();
    await as(B);
    await expectCode(db.query(`select public.resolve_pending_with_orders($1, null, $2::uuid[], '[]'::jsonb)`, [id, [A, B]]), "P0002");
    await as(A);
    await db.query(`select public.resolve_pending($1, false, null, '{}'::uuid[])`, [id]);
    await expectCode(db.query(`select public.resolve_pending_with_orders($1, null, $2::uuid[], '[]'::jsonb)`, [id, [A, B]]), "23514");
  });
});

describe("tg_purchase_message", () => {
  it("lists the order line and keeps the per-person debts", async () => {
    await admin();
    await db.exec(`update public.profiles set telegram_username = 'nurdaulet' where id = '${D}'`);
    const r = await create(A, 3000, [A, B, C, D], ord(D, 500, "энергетик"));
    await admin();
    const text = (await db.query<{ t: string }>(`select private.tg_purchase_message($1) t`, [r.id])).rows[0].t;
    expect(text).toContain("+ заказ: @nurdaulet 500 ₸ (энергетик)");
    expect(text).toContain("@nurdaulet — 1 125 ₸");
    expect(text).toContain("Айдос — 625 ₸");
  });
  it("a purchase without orders keeps the old text", async () => {
    const r = await create(A, 900, [A, B, C], "[]");
    await admin();
    const text = (await db.query<{ t: string }>(`select private.tg_purchase_message($1) t`, [r.id])).rows[0].t;
    expect(text).not.toContain("заказ");
  });
});

describe("water_brought payer", () => {
  type Ev = { purchase_id: string; user_id: string; partner_id: string | null };
  async function brought(user: string, partner: string | null, payer?: string | null) {
    await as(user);
    const q =
      payer === undefined
        ? await db.query<Ev>(`select * from public.water_brought($1, $2)`, [water, partner])
        : await db.query<Ev>(`select * from public.water_brought($1, $2, $3)`, [water, partner, payer]);
    return q.rows[0];
  }
  async function payerOf(purchase: string) {
    await admin();
    return (await db.query<{ payer_id: string; amount: number }>(`select payer_id, amount from public.purchases where id = $1`, [purchase])).rows[0];
  }
  it("the old two-argument call and a null payer default to the caller", async () => {
    const e = await brought(A, B);
    expect((await payerOf(e.purchase_id)).payer_id).toBe(A);
    const e2 = await brought(B, null, null);
    expect((await payerOf(e2.purchase_id)).payer_id).toBe(B);
  });
  it("an explicit payer (the partner, or a third member) owns the purchase; the queue keeps who went", async () => {
    const e = await brought(A, B, B);
    expect((await payerOf(e.purchase_id)).payer_id).toBe(B);
    expect(e.user_id).toBe(A);
    expect(e.partner_id).toBe(B);
    await admin();
    const shares = (await db.query<{ debtor_id: string; settled_at: string | null }>(`select debtor_id, settled_at from public.shares where purchase_id = $1`, [e.purchase_id])).rows;
    expect(shares.find((s) => s.debtor_id === B)?.settled_at).not.toBeNull();
    expect(shares.find((s) => s.debtor_id === A)?.settled_at).toBeNull();
    const e2 = await brought(A, null, D);
    expect((await payerOf(e2.purchase_id)).payer_id).toBe(D);
  });
  it("a non-member or a former member cannot be the payer", async () => {
    await expectCode(brought(A, B, E), "23514");
    await admin();
    await db.exec(`update public.members set active = false where user_id = '${C}'`);
    await expectCode(brought(A, null, C), "23514");
  });
});

describe("update_purchase", () => {
  async function update(user: string, id: string, amount: number, payer: string, who: string[], orders = "[]", desc = "Исправлено") {
    await as(user);
    return (await db.query<{ r: Row }>(`select public.update_purchase($1, $2, $3, $4, $5::uuid[], $6::jsonb) r`, [id, amount, desc, payer, who, orders])).rows[0].r;
  }
  it("the payer rebuilds amount, participants and orders", async () => {
    const r = await create(A, 3000, [A, B, C, D], ord(D, 500));
    const u = await update(A, r.id, 2000, A, [A, B], ord(C, 400, "сок"));
    expect(u.amount).toBe(2000);
    expect(shareOf(u, A)).toBe(800);
    expect(shareOf(u, B)).toBe(800);
    expect(shareOf(u, C)).toBe(400);
    expect(shareOf(u, D)).toBeUndefined();
    expect(u.orders).toHaveLength(1);
    expect(u.description).toBe("Исправлено");
  });
  it("an admin can change the payer of somebody else's purchase", async () => {
    const r = await create(B, 3000, [A, B, C], "[]");
    const u = await update(A, r.id, 3000, C, [A, B, C]);
    expect(u.payer_id).toBe(C);
    expect(u.shares.find((s) => s.debtor_id === C)?.settled_at).not.toBeNull();
    expect(u.shares.find((s) => s.debtor_id === B)?.settled_at).toBeNull();
  });
  it("a plain member who is not the payer is refused; an order by the new payer is refused", async () => {
    const r = await create(A, 3000, [A, B, C], "[]");
    await expectCode(update(B, r.id, 3000, A, [A, B]), "42501");
    await expectCode(update(A, r.id, 3000, B, [A, B], ord(B, 100)), "23514");
    await expectCode(update(A, r.id, 3000, E, [A, B]), "23503");
  });
  it("is blocked once somebody paid or a settlement covers it", async () => {
    const r = await create(A, 3000, [A, B, C], "[]");
    await as(B);
    await db.query(`select public.mark_settlement($1, $2)`, [hh, A]);
    await expectCode(update(A, r.id, 3000, A, [A, B, C]), "23514");
    await as(A);
    const st = (await db.query<{ id: string }>(`select id from public.settlements where status = 'marked'`)).rows[0];
    await db.query(`select public.confirm_settlement($1)`, [st.id]);
    await expectCode(update(A, r.id, 3000, A, [A, B, C]), "23514");
  });
  it("is allowed again after the settlement was cancelled", async () => {
    const r = await create(A, 3000, [A, B, C], "[]");
    await as(B);
    const st = (await db.query<{ id: string }>(`select id from public.mark_settlement($1, $2)`, [hh, A])).rows[0];
    await db.query(`select public.cancel_settlement($1)`, [st.id]);
    const u = await update(A, r.id, 3000, A, [A, B]);
    expect(u.shares).toHaveLength(2);
  });
  it("pending purchases are not editable here", async () => {
    await admin();
    const id = (
      await db.query<{ id: string }>(
        `insert into public.purchases (household_id, payer_id, amount, description, source, status) values ($1, $2, 900, 'Apple Pay', 'apple_pay', 'pending') returning id`,
        [hh, A],
      )
    ).rows[0].id;
    await expectCode(update(A, id, 900, A, [A, B]), "P0002");
  });
  it("posts one «Исправлено» record per edit and never breaks the edit", async () => {
    await admin();
    await db.exec(`update public.households set telegram_chat_id = 12345`);
    const r = await create(A, 3000, [A, B, C], "[]");
    await admin();
    await db.exec(`delete from private.telegram_sent`);
    await update(A, r.id, 3300, A, [A, B, C]);
    await update(A, r.id, 3600, A, [A, B, C]);
    await admin();
    const n = (await db.query<{ n: number }>(`select count(*)::int n from private.telegram_sent where kind = 'purchase_edit'`)).rows[0].n;
    expect(n).toBe(2);
    const line = (await db.query<{ t: string }>(`select private.tg_purchase_line($1) t`, [r.id])).rows[0].t;
    expect(line).toContain("3 600 ₸");
  });
});

describe("surface", () => {
  it("the anon surface is thirteen (0017 adds pay_link_open, pay_link_answer and anon paid_prompt_notice)", async () => {
    await admin();
    const r = await db.query<{ n: string }>(
      `select p.proname n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname in ('public', 'private') and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')
         and p.proname not in ('uid')`,
    );
    expect(r.rows).toHaveLength(13);
  });
  it("new functions are security definer with an empty search_path; only authenticated may call them", async () => {
    await admin();
    const r = await db.query<{ n: string; definer: boolean; cfg: string[] | null; auth: boolean; anon: boolean }>(
      `select p.proname n, p.prosecdef definer, p.proconfig cfg,
              has_function_privilege('authenticated', p.oid, 'execute') auth, has_function_privilege('anon', p.oid, 'execute') anon
       from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname = 'public' and p.proname in ('create_purchase_with_orders','resolve_pending_with_orders','update_purchase','water_brought')`,
    );
    expect(r.rows).toHaveLength(4);
    for (const f of r.rows) {
      expect(f.definer).toBe(true);
      expect(f.cfg).toContain(`search_path=""`);
      expect(f.auth).toBe(true);
      expect(f.anon).toBe(false);
    }
  });
  it("only one water_brought remains", async () => {
    await admin();
    const r = await db.query(`select 1 from pg_proc where proname = 'water_brought'`);
    expect(r.rows).toHaveLength(1);
  });
});
