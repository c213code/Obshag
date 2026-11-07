import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const A = "00000000-0000-0000-0000-00000000000a"; // admin
const B = "00000000-0000-0000-0000-00000000000b";
const C = "00000000-0000-0000-0000-00000000000c";
const X = "00000000-0000-0000-0000-0000000000f1"; // outsider
const SECRET = "test-cron-secret-0123456789abcdef";

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
];

let db: PGlite;
let hh: string;
let code: string;

async function as(user: string | null, role: "authenticated" | "anon" = "authenticated") {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ""}', false); set role ${role};`);
}
async function admin() {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
}
async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code });
}

type Bill = { id: string; participants: string[]; last_generated_month: string | null; payer_id: string };
async function addBill(opts: { title?: string; amount?: number | null; variable?: boolean; day?: number; payer?: string; who?: string[]; user?: string } = {}) {
  await as(opts.user ?? A);
  const r = await db.query<{ r: Bill }>(`select to_jsonb(public.upsert_bill($1, null, $2, 'home', $3, $4, $5, $6, $7)) as r`, [
    hh,
    opts.title ?? "Аренда",
    opts.variable ? null : (opts.amount ?? 180000),
    opts.variable ?? false,
    opts.day ?? 1,
    opts.payer ?? A,
    opts.who ?? [A, B, C],
  ]);
  return r.rows[0].r;
}
type Gen = { created: number; notices: Array<{ to_user: string; title: string; month: string; subscriptions: unknown[] }> };
/** Runs the generator at a given instant (the private body, so the clock can move). */
async function gen(at: string): Promise<Gen> {
  await admin();
  return (await db.query<{ r: Gen }>(`select private.generate_bills($1::timestamptz) as r`, [at])).rows[0].r;
}
const purchases = async () => {
  await admin();
  return (
    await db.query<{ id: string; payer_id: string; amount: number; description: string; source: string; bill_month: string }>(
      `select id, payer_id, amount, description, source, bill_month from public.purchases order by created_at, id`,
    )
  ).rows;
};
const net = async (a: string, b: string) => {
  await admin();
  return Number((await db.query<{ n: string }>(`select private.pair_net($1, $2, $3) as n`, [hh, a, b])).rows[0].n);
};
async function buy(payer: string, amount: number, who: string[]) {
  await as(payer);
  await db.query(`select public.create_purchase_with_shares($1, $2, 'Продукты', null, $3)`, [hh, amount, who]);
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUB);
  for (const file of MIGRATIONS) await db.exec(readFileSync(join(process.cwd(), "supabase/migrations", file), "utf8"));
  await db.exec(`insert into auth.users values ('${A}'),('${B}'),('${C}'),('${X}');`);
  for (const [id, name] of [[A, "Ерасыл"], [B, "Айдос"], [C, "Даня"], [X, "Чужой"]]) {
    await as(id);
    await db.query(`select public.upsert_profile($1, '+77001234567')`, [name]);
  }
  await as(A);
  const h = await db.query<{ id: string; invite_code: string }>(`select * from public.create_household('Квартира 42')`);
  hh = h.rows[0].id;
  code = h.rows[0].invite_code;
  for (const u of [B, C]) {
    await as(u);
    await db.query(`select public.join_household($1)`, [code]);
  }
  await admin();
  await db.exec(`insert into private.server_secrets values ('cron', encode(extensions.digest('${SECRET}', 'sha256'), 'hex'))`);
  await db.exec(`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ('${B}', 'https://fcm.googleapis.com/b1', 'k', 'a')`);
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await admin();
  await db.exec(`truncate public.settlement_shares, public.settlements, public.purchases, public.bills cascade;
    delete from public.members where user_id = '${X}';
    update public.members set active = true, role = 'admin', away_until = null;
    update public.members set role = 'member' where user_id <> '${A}';`);
});

// previous Asia/Almaty month (YYYY-MM): always due, never "too old" for set_bill_amount
const PREV = (() => { const d = new Date(Date.now() + 5 * 3600e3); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();

describe("bills: writes", () => {
  it("only an admin creates, edits and deletes bills; clients cannot write the table", async () => {
    await expectCode(addBill({ user: B }), "42501");
    const bill = await addBill();
    await as(B);
    await expectCode(db.query(`select public.upsert_bill($1, $2, 'X', 'home', 5000, false, 3, $3, $4)`, [hh, bill.id, A, [A, B]]), "42501");
    await expectCode(db.query(`select public.delete_bill($1)`, [bill.id]), "42501");
    await expectCode(db.query(`insert into public.bills (household_id, title, day_of_month, payer_id) values ($1, 'x', 1, $2)`, [hh, A]), "42501");
    await expectCode(db.query(`update public.bills set title = 'hack'`), "42501");
    await as(X);
    await expectCode(addBill({ user: X }), "42501");
    expect((await db.query(`select * from public.bills`)).rows).toHaveLength(0); // an outsider sees nothing
    await as(B);
    expect((await db.query(`select * from public.bills`)).rows).toHaveLength(1); // a member reads
    await as(A);
    await db.query(`select public.upsert_bill($1, $2, 'Аренда 2', 'bolt', 5000, false, 3, $3, $4)`, [hh, bill.id, B, [A, B]]);
    expect((await db.query<{ title: string; payer_id: string }>(`select title, payer_id from public.bills`)).rows[0]).toEqual({ title: "Аренда 2", payer_id: B });
    await db.query(`select public.delete_bill($1)`, [bill.id]);
    expect((await db.query(`select * from public.bills`)).rows).toHaveLength(0);
  });
  it("validates icon, day, amount, payer and participants", async () => {
    await as(A);
    const call = (over: Partial<{ icon: string; amount: number | null; variable: boolean; day: number; payer: string; who: string[] }>) =>
      db.query(`select public.upsert_bill($1, null, 'T', $2, $3, $4, $5, $6, $7)`, [
        hh,
        over.icon ?? "home",
        over.amount === undefined ? 9000 : over.amount,
        over.variable ?? false,
        over.day ?? 5,
        over.payer ?? A,
        over.who ?? [A, B],
      ]);
    await expectCode(call({ icon: "receipt" }), "23514");
    await expectCode(call({ day: 29 }), "23514");
    await expectCode(call({ day: 0 }), "23514");
    await expectCode(call({ amount: 0 }), "23514");
    await expectCode(call({ amount: null }), "23514");
    await expectCode(call({ variable: true }), "23514"); // variable with a fixed amount
    await expectCode(call({ amount: 1, who: [A, B] }), "23514"); // smaller than the headcount
    await expectCode(call({ who: [] }), "23514");
    await expectCode(call({ who: [A, A] }), "23514");
    await expectCode(call({ payer: X }), "23503");
    await expectCode(call({ who: [A, X] }), "23503");
    await admin();
    await db.exec(`update public.members set active = false where user_id = '${C}'`);
    await as(A);
    await expectCode(call({ who: [A, C] }), "23503");
    await expectCode(call({ payer: C }), "23503");
  });
});

describe("bills: monthly generation", () => {
  it("creates a fixed bill's purchase once, split equally, and a second run creates nothing", async () => {
    const bill = await addBill({ amount: 180000, day: 1, who: [A, B, C] });
    const first = await gen("2026-11-03T08:00:00Z");
    expect(first.created).toBe(1);
    const rows = await purchases();
    expect(rows).toEqual([expect.objectContaining({ payer_id: A, amount: 180000, description: "Аренда", source: "monthly", bill_month: "2026-11" })]);
    await admin();
    const shares = await db.query<{ debtor_id: string; amount: number; settled: boolean }>(
      `select debtor_id, amount, settled_at is not null as settled from public.shares order by debtor_id`,
    );
    expect(shares.rows).toEqual([
      { debtor_id: A, amount: 60000, settled: true },
      { debtor_id: B, amount: 60000, settled: false },
      { debtor_id: C, amount: 60000, settled: false },
    ]);
    expect(await net(B, A)).toBe(60000);
    const again = await gen("2026-11-20T08:00:00Z");
    expect(again.created).toBe(0);
    expect(await purchases()).toHaveLength(1);
    await admin();
    expect((await db.query<{ m: string }>(`select last_generated_month as m from public.bills where id = $1`, [bill.id])).rows[0].m).toBe("2026-11");
    expect((await gen("2026-12-01T08:00:00Z")).created).toBe(1); // next month, again once
    expect(await purchases()).toHaveLength(2);
  });
  it("does nothing before the bill's day and uses the Almaty calendar day at the boundary", async () => {
    await addBill({ amount: 9000, day: 5, who: [A, B, C] });
    expect((await gen("2026-11-04T18:59:59Z")).created).toBe(0); // 23:59:59 on the 4th in Almaty (UTC+5)
    expect((await gen("2026-11-04T19:00:00Z")).created).toBe(1); // midnight: the 5th
    expect(await purchases()).toHaveLength(1);
  });
  it("month boundary: the 30th UTC evening is already the 1st in Almaty", async () => {
    await addBill({ amount: 9000, day: 1, who: [A, B, C] });
    expect((await gen("2026-11-30T18:59:59Z")).created).toBe(1); // 23:59 on Nov 30 in Almaty: still November
    expect((await purchases())[0].bill_month).toBe("2026-11");
    expect((await gen("2026-11-30T19:00:00Z")).created).toBe(1); // 00:00 on Dec 1: December
    expect((await purchases()).map((p) => p.bill_month)).toEqual(["2026-11", "2026-12"]);
  });
  it("a variable bill without an amount creates nothing and notifies the payer, until the amount is entered", async () => {
    const bill = await addBill({ title: "Коммуналка", variable: true, day: 10, payer: B, who: [A, B, C] });
    expect((await gen("2026-11-09T08:00:00Z")).notices).toEqual([]);
    const out = await gen("2026-11-10T08:00:00Z");
    expect(out.created).toBe(0);
    expect(out.notices).toEqual([
      expect.objectContaining({
        to_user: B,
        title: "Коммуналка",
        month: "2026-11",
        subscriptions: [expect.objectContaining({ endpoint: "https://fcm.googleapis.com/b1" })],
      }),
    ]);
    expect(await purchases()).toHaveLength(0);
    expect((await gen("2026-11-11T08:00:00Z")).created).toBe(0);

    // the amount is entered "today" in real time, so use a month that is certainly due
    await as(B);
    const set = await db.query<{ r: { amount: number; bill_month: string; shares: unknown[] } }>(`select public.set_bill_amount($1, $2, 31000) as r`, [bill.id, PREV]);
    expect(set.rows[0].r).toMatchObject({ amount: 31000, bill_month: PREV });
    expect(set.rows[0].r.shares).toHaveLength(3);
    expect((await purchases())[0]).toMatchObject({ payer_id: B, amount: 31000, description: "Коммуналка", source: "monthly" });
    await as(B);
    await expectCode(db.query(`select public.set_bill_amount($1, $2, 5000)`, [bill.id, PREV]), "23514"); // already generated
  });
  it("set_bill_amount: payer or admin only, variable only, not for a future month, sane input", async () => {
    const bill = await addBill({ variable: true, day: 28, payer: B, who: [A, B, C] });
    const set = (user: string, month: string, amount: number, id = bill.id) =>
      as(user).then(() => db.query(`select public.set_bill_amount($1, $2, $3)`, [id, month, amount]));
    await expectCode(set(B, "2099-01", 1000), "23514"); // future month
    await expectCode(set(C, PREV, 1000), "42501"); // neither payer nor admin
    await expectCode(set(X, PREV, 1000), "P0002"); // an outsider sees no bill
    await expectCode(set(B, "bad", 1000), "23514");
    await expectCode(set(B, "2020-01", 1000), "23514"); // too old: back-dating is refused
    await expectCode(set(B, PREV, 0), "23514");
    await expectCode(set(B, PREV, 2), "23514"); // smaller than 3 participants
    await set(A, PREV, 3000); // an admin may
    expect(await purchases()).toHaveLength(1);
    const fixed = await addBill({ amount: 9000, day: 1 });
    await expectCode(set(A, PREV, 3000, fixed.id), "23514"); // not a variable bill
  });
  it("leaves a former member out of the split", async () => {
    await addBill({ amount: 9000, day: 1, who: [A, B, C] });
    await admin();
    await db.exec(`update public.members set active = false where user_id = '${C}'`);
    expect((await gen("2026-11-03T08:00:00Z")).created).toBe(1);
    await admin();
    expect((await db.query(`select * from public.shares`)).rows).toHaveLength(2);
  });
  it("run_monthly_bills needs the secret, works for anon with it, and clients cannot reach the private body", async () => {
    await addBill({ amount: 9000, day: 1, who: [A, B, C] });
    await as(null, "anon");
    await expectCode(db.query(`select public.run_monthly_bills('nope')`), "28000");
    await expectCode(db.query(`select public.run_monthly_bills(null)`), "28000");
    await expectCode(db.query(`select public.run_monthly_bills('')`), "28000");
    await as(A);
    await expectCode(db.query(`select public.run_monthly_bills('${SECRET}')`), "42501"); // authenticated has no execute
    await expectCode(db.query(`select private.generate_bills(now())`), "42501");
    await as(null, "anon");
    const r = await db.query<{ r: Gen }>(`select public.run_monthly_bills('${SECRET}') as r`);
    expect(r.rows[0].r.created).toBe(1);
    expect(r.rows[0].r.notices).toEqual([]);
  });
});

describe("Квартира: roles, removal, leaving, code, away", () => {
  it("only an admin changes roles; the last admin is protected", async () => {
    await as(B);
    await expectCode(db.query(`select public.set_member_role($1, $2, 'admin')`, [hh, B]), "42501");
    await as(A);
    await expectCode(db.query(`select public.set_member_role($1, $2, 'owner')`, [hh, B]), "23514");
    await expectCode(db.query(`select public.set_member_role($1, $2, 'admin')`, [hh, X]), "P0002");
    await expectCode(db.query(`select public.set_member_role($1, $2, 'member')`, [hh, A]), "23514"); // the only admin
    await db.query(`select public.set_member_role($1, $2, 'admin')`, [hh, B]);
    await db.query(`select public.set_member_role($1, $2, 'member')`, [hh, A]); // allowed now: B stays admin
    await as(B);
    await expectCode(db.query(`select public.set_member_role($1, $2, 'member')`, [hh, B]), "23514");
  });
  it("remove_member: admin only, blocked while any net is non-zero, then soft-removes and detaches bills", async () => {
    const bill = await addBill({ amount: 9000, day: 1, payer: C, who: [A, B, C] });
    await buy(A, 3000, [A, C]); // C owes A 1500
    await as(B);
    await expectCode(db.query(`select public.remove_member($1, $2)`, [hh, C]), "42501");
    await as(A);
    await expectCode(db.query(`select public.remove_member($1, $2)`, [hh, C]), "23514"); // not_settled
    await expectCode(db.query(`select public.remove_member($1, $2)`, [hh, A]), "42501"); // yourself: leave instead
    await expectCode(db.query(`select public.remove_member($1, $2)`, [hh, X]), "P0002");
    await admin();
    await db.exec(`update public.shares set settled_at = now()`);
    await as(A);
    await db.query(`select public.remove_member($1, $2)`, [hh, C]);
    await admin();
    expect((await db.query(`select active from public.members where user_id = $1`, [C])).rows).toEqual([{ active: false }]);
    const row = (await db.query<{ participants: string[]; payer_id: string }>(`select participants, payer_id from public.bills where id = $1`, [bill.id])).rows[0];
    expect(row.participants).not.toContain(C);
    expect(row.payer_id).toBe(A);
  });
  it("leave_household: blocked with a non-zero net, allowed once even; the only admin cannot leave", async () => {
    await buy(A, 3000, [A, B]); // B owes A
    await as(B);
    await expectCode(db.query(`select public.leave_household($1)`, [hh]), "23514");
    await as(A);
    await expectCode(db.query(`select public.leave_household($1)`, [hh]), "23514"); // A is owed
    await admin();
    await db.exec(`update public.shares set settled_at = now()`);
    await as(A);
    await expectCode(db.query(`select public.leave_household($1)`, [hh]), "23514"); // the only admin (last-admin trigger)
    await as(B);
    await db.query(`select public.leave_household($1)`, [hh]);
    await admin();
    expect((await db.query(`select active from public.members where user_id = $1`, [B])).rows).toEqual([{ active: false }]);
    await as(X);
    await expectCode(db.query(`select public.leave_household($1)`, [hh]), "42501");
  });
  it("rotate_invite_code: admin only, a new 12-character code that joins, the old one stops", async () => {
    await as(B);
    await expectCode(db.query(`select public.rotate_invite_code($1)`, [hh]), "42501");
    await as(A);
    const r = await db.query<{ invite_code: string }>(`select * from public.rotate_invite_code($1)`, [hh]);
    const fresh = r.rows[0].invite_code;
    expect(fresh).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);
    expect(fresh).not.toBe(code);
    await as(X);
    expect((await db.query<{ id: string | null }>(`select * from public.join_household($1)`, [code])).rows[0]?.id ?? null).toBeNull();
    expect((await db.query<{ id: string }>(`select * from public.join_household($1)`, [fresh])).rows[0].id).toBe(hh);
  });
  it("set_away: own row only, no past date, null clears", async () => {
    await as(B);
    await db.query(`select public.set_away($1, (now() + interval '3 days')::date)`, [hh]);
    await admin();
    expect((await db.query<{ a: string | null }>(`select away_until::text as a from public.members where user_id = $1`, [B])).rows[0].a).not.toBeNull();
    expect((await db.query<{ a: string | null }>(`select away_until::text as a from public.members where user_id = $1`, [C])).rows[0].a).toBeNull();
    await as(B);
    await expectCode(db.query(`select public.set_away($1, '2020-01-01')`, [hh]), "23514");
    await db.query(`select public.set_away($1, null)`, [hh]);
    await admin();
    expect((await db.query<{ a: string | null }>(`select away_until::text as a from public.members where user_id = $1`, [B])).rows[0].a).toBeNull();
    await as(X);
    await expectCode(db.query(`select public.set_away($1, null)`, [hh]), "42501");
  });
});

describe("surface", () => {
  it("anon can execute exactly four functions", async () => {
    await admin();
    const res = await db.query<{ n: string }>(
      `select p.oid::regprocedure::text as n
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute')
       order by 1`,
    );
    expect(res.rows.map((r) => r.n)).toEqual([
      "capture_purchase(text,integer,text)",
      "prune_push_subscription(text,text)",
      "run_daily_reminders(text)",
      "run_monthly_bills(text)",
    ]);
  });
  it("the new functions are security definer with an empty search_path", async () => {
    await admin();
    const names = [
      "upsert_bill", "delete_bill", "set_bill_amount", "run_monthly_bills", "set_member_role", "remove_member", "leave_household",
      "rotate_invite_code", "set_away", "generate_bills", "create_bill_purchase", "require_admin", "has_open_net", "detach_member",
    ];
    const fns = await db.query<{ prosecdef: boolean; proconfig: string[] | null }>(
      `select prosecdef, proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private') and proname = any($1)`,
      [names],
    );
    expect(fns.rows).toHaveLength(names.length);
    for (const f of fns.rows) {
      expect(f.prosecdef).toBe(true);
      expect(f.proconfig).toContain('search_path=""');
    }
  });
});
