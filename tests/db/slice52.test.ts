import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const A = "00000000-0000-0000-0000-00000000000a"; // creditor / payer
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

/** A pays `amount` split equally between the given people (A included or not). */
async function buy(amount: number, who: string[], desc = "Продукты"): Promise<string> {
  await as(A);
  const r = await db.query<{ r: { id: string } }>(`select public.create_purchase_with_shares($1, $2, $3, null, $4) as r`, [hh, amount, desc, who]);
  return r.rows[0].r.id;
}
const age = async (hours: number) => {
  await admin();
  await db.exec(`update public.purchases set created_at = now() - interval '${hours} hours'`);
};
type Reminder = { to_user: string; from_user: string; from_name_dative: string; amount: number; subscriptions: Array<{ endpoint: string }> };
async function daily(secret: string | null = SECRET, role: "anon" | "authenticated" = "anon"): Promise<Reminder[]> {
  await as(null, role);
  return (await db.query<{ r: Reminder[] }>(`select public.run_daily_reminders($1) as r`, [secret])).rows[0].r;
}
async function remind(user: string, debtor: string, secret: string | null = SECRET): Promise<Reminder> {
  await as(user);
  return (await db.query<{ r: Reminder }>(`select public.remind($1, $2, $3) as r`, [secret, hh, debtor])).rows[0].r;
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
  for (const u of [B, C]) {
    await as(u);
    await db.query(`select public.join_household($1)`, [h.rows[0].invite_code]);
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
  await db.exec(`truncate public.reminder_log, public.settlement_shares, public.settlements, public.purchases cascade;
    update public.members set reminders_enabled = true;`);
});

describe("server secret", () => {
  it("a missing or wrong secret raises 28000 everywhere", async () => {
    await expectCode(daily("nope"), "28000");
    await expectCode(daily(null), "28000");
    await expectCode(daily(""), "28000");
    await buy(3000, [A, B]);
    await expectCode(remind(A, B, "nope"), "28000");
    await expectCode(remind(A, B, null), "28000");
  });
  it("with no stored hash nothing opens, and clients cannot read the table", async () => {
    await admin();
    await db.exec(`truncate private.server_secrets`);
    await expectCode(daily(SECRET), "28000");
    await admin();
    await db.exec(`insert into private.server_secrets values ('cron', encode(extensions.digest('${SECRET}', 'sha256'), 'hex'))`);
    await as(A);
    await expectCode(db.query(`select * from private.server_secrets`), "42501");
    await as(null, "anon");
    await expectCode(db.query(`select * from private.server_secrets`), "42501");
  });
});

describe("run_daily_reminders", () => {
  it("picks debtors whose oldest open debt is older than 24h, one reminder per pair, with subscriptions", async () => {
    await buy(3000, [A, B, C]);
    await buy(2000, [A, B]);
    await age(30);
    const out = await daily();
    expect(out).toHaveLength(2);
    const b = out.find((r) => r.to_user === B)!;
    expect(b).toMatchObject({ from_user: A, from_name_dative: "Ерасыл", amount: 2000 });
    expect(b.subscriptions).toEqual([{ endpoint: "https://fcm.googleapis.com/b1", p256dh: "k", auth: "a" }]);
    expect(out.find((r) => r.to_user === C)).toMatchObject({ amount: 1000, subscriptions: [] });
    // second run: everyone is in the 6h cooldown
    expect(await daily()).toEqual([]);
    await admin();
    expect((await db.query(`select 1 from public.reminder_log`)).rows).toHaveLength(2);
  });
  it("skips debts younger than 24h", async () => {
    await buy(3000, [A, B]);
    await age(10);
    expect(await daily()).toEqual([]);
  });
  it("uses the NET: a debt that is covered the other way round is not reminded", async () => {
    await buy(3000, [A, B]); // B owes A 1500
    await as(B);
    await db.query(`select public.create_purchase_with_shares($1, 3000, 'Вода', null, $2)`, [hh, [A, B]]); // A owes B 1500
    await age(30);
    expect(await daily()).toEqual([]);
  });
  it("skips debtors who switched reminders off, and honours the 6h cooldown after it expires", async () => {
    await buy(3000, [A, B, C]);
    await age(30);
    await as(B);
    await db.query(`select public.set_reminders_enabled($1, false)`, [hh]);
    expect((await daily()).map((r) => r.to_user)).toEqual([C]);
    await admin();
    await db.exec(`update public.reminder_log set sent_at = now() - interval '7 hours'`);
    expect((await daily()).map((r) => r.to_user)).toEqual([C]);
  });
  it("ignores paid shares", async () => {
    await buy(3000, [A, B]);
    await age(30);
    await admin();
    await db.exec(`update public.shares set settled_at = now() where debtor_id = '${B}'`);
    expect(await daily()).toEqual([]);
  });
});

describe("remind", () => {
  it("lets a creditor remind, logs it, and enforces the 6h cooldown per pair", async () => {
    await buy(3000, [A, B]);
    const r = await remind(A, B);
    expect(r).toMatchObject({ to_user: B, from_user: A, from_name_dative: "Ерасыл", amount: 1500 });
    expect(r.subscriptions).toHaveLength(1);
    await as(A);
    await expect(db.query(`select public.remind($1, $2, $3)`, [SECRET, hh, B])).rejects.toMatchObject({ code: "P0001", message: "rate_limited" });
    // the hint carries the seconds left
    try {
      await db.query(`select public.remind($1, $2, $3)`, [SECRET, hh, B]);
    } catch (e) {
      const secs = Number((e as { hint?: string }).hint);
      expect(secs).toBeGreaterThan(5 * 3600);
      expect(secs).toBeLessThanOrEqual(6 * 3600);
    }
    // another debtor is not affected; the cooldown is per pair
    await buy(3000, [A, C]);
    await expect(remind(A, C)).resolves.toMatchObject({ to_user: C });
  });
  it("forbids a debtor, an outsider, yourself, and a pair that owes nothing", async () => {
    await buy(3000, [A, B]);
    await expectCode(remind(B, A), "42501"); // B is the debtor, not the creditor
    await expectCode(remind(X, B), "42501"); // outsider
    await expectCode(remind(A, A), "42501");
    await expectCode(remind(A, C), "42501"); // C owes nothing
    await expectCode(remind(A, X), "42501"); // not a member
    await admin();
    expect((await db.query(`select 1 from public.reminder_log`)).rows).toHaveLength(0);
  });
  it("is closed to anon", async () => {
    await as(null, "anon");
    await expectCode(db.query(`select public.remind($1, $2, $3)`, [SECRET, hh, B]), "42501");
  });
});

describe("set_reminders_enabled", () => {
  it("changes only your own row, members only", async () => {
    await as(C);
    await db.query(`select public.set_reminders_enabled($1, false)`, [hh]);
    await admin();
    const rows = (await db.query<{ user_id: string; reminders_enabled: boolean }>(`select user_id, reminders_enabled from public.members where household_id = $1`, [hh])).rows;
    expect(rows.filter((r) => !r.reminders_enabled).map((r) => r.user_id)).toEqual([C]);
    await as(X);
    await expectCode(db.query(`select public.set_reminders_enabled($1, false)`, [hh]), "42501");
    await as(null, "anon");
    await expectCode(db.query(`select public.set_reminders_enabled($1, false)`, [hh]), "42501");
  });
});

describe("create_purchase_custom", () => {
  const call = async (user: string, amount: number, shares: unknown, desc = "Ужин") => {
    await as(user);
    return (await db.query<{ r: { id: string; shares: Array<{ debtor_id: string; amount: number; settled_at: string | null }> } }>(
      `select public.create_purchase_custom($1, $2, $3, null, $4::jsonb) as r`,
      [hh, amount, desc, JSON.stringify(shares)],
    )).rows[0].r;
  };

  it("stores 3000/2000/1000, settles the payer's own entry and nothing else", async () => {
    const r = await call(A, 6000, [{ user_id: A, amount: 3000 }, { user_id: B, amount: 2000 }, { user_id: C, amount: 1000 }]);
    const byUser = Object.fromEntries(r.shares.map((s) => [s.debtor_id, s]));
    expect(byUser[A].amount).toBe(3000);
    expect(byUser[A].settled_at).not.toBeNull();
    expect(byUser[B]).toMatchObject({ amount: 2000, settled_at: null });
    expect(byUser[C]).toMatchObject({ amount: 1000, settled_at: null });
  });
  it("works without the payer's own entry and allows zero amounts", async () => {
    const r = await call(A, 1000, [{ user_id: B, amount: 1000 }, { user_id: C, amount: 0 }]);
    expect(r.shares).toHaveLength(2);
  });
  it("rejects sums that do not match, duplicates, only-payer, bad amounts, bad shape and >50 entries", async () => {
    await expectCode(call(A, 6000, [{ user_id: B, amount: 5999 }]), "23514");
    await expectCode(call(A, 6000, [{ user_id: B, amount: 6001 }]), "23514");
    await expectCode(call(A, 6000, [{ user_id: B, amount: 3000 }, { user_id: B, amount: 3000 }]), "23514");
    await expectCode(call(A, 6000, [{ user_id: A, amount: 6000 }]), "23514");
    await expectCode(call(A, 6000, [{ user_id: B, amount: -1 }, { user_id: C, amount: 6001 }]), "23514");
    await expectCode(call(A, 6000, [{ user_id: B, amount: 1000.5 }, { user_id: C, amount: 4999.5 }]), "23514");
    await expectCode(call(A, 6000, [{ user_id: B, amount: "6000" }]), "23514");
    await expectCode(call(A, 6000, [{ user_id: "nope", amount: 6000 }]), "23514");
    await expectCode(call(A, 6000, {}), "23514");
    await expectCode(call(A, 6000, []), "23514");
    await expectCode(call(A, 6000, Array.from({ length: 51 }, () => ({ user_id: B, amount: 1 }))), "23514");
    await expectCode(call(A, 6000, [{ user_id: B, amount: 6000 }], "   "), "23514");
    await expectCode(call(A, 0, [{ user_id: B, amount: 0 }]), "23514");
    await admin();
    expect((await db.query(`select 1 from public.purchases`)).rows).toHaveLength(0);
  });
  it("rejects non-members and outsiders", async () => {
    await expectCode(call(A, 1000, [{ user_id: X, amount: 1000 }]), "23503");
    await expectCode(call(X, 1000, [{ user_id: A, amount: 1000 }]), "42501");
    await as(null, "anon");
    await expectCode(db.query(`select public.create_purchase_custom($1, 1000, 'x', null, '[]'::jsonb)`, [hh]), "42501");
  });
});

describe("delete_purchase and update_purchase_description", () => {
  it("the payer deletes an untouched purchase (shares cascade)", async () => {
    const id = await buy(3000, [A, B]);
    await as(A);
    await db.query(`select public.delete_purchase($1)`, [id]);
    await admin();
    expect((await db.query(`select 1 from public.purchases`)).rows).toHaveLength(0);
    expect((await db.query(`select 1 from public.shares`)).rows).toHaveLength(0);
  });
  it("is payer-only: a housemate gets 42501, an outsider and an unknown id P0002", async () => {
    const id = await buy(3000, [A, B]);
    await as(B);
    await expectCode(db.query(`select public.delete_purchase($1)`, [id]), "42501");
    await expectCode(db.query(`select public.update_purchase_description($1, 'x')`, [id]), "42501");
    await as(X);
    await expectCode(db.query(`select public.delete_purchase($1)`, [id]), "P0002");
    await as(A);
    await expectCode(db.query(`select public.delete_purchase('00000000-0000-0000-0000-0000000000aa')`), "P0002");
  });
  it("is blocked with has_payments once a share is settled", async () => {
    const id = await buy(3000, [A, B]);
    await admin();
    await db.exec(`update public.shares set settled_at = now() where debtor_id = '${B}'`);
    await as(A);
    await expect(db.query(`select public.delete_purchase($1)`, [id])).rejects.toMatchObject({ code: "23514", message: "has_payments" });
  });
  it("is blocked while a marked settlement covers it, allowed again after the settlement is cancelled", async () => {
    const id = await buy(3000, [A, B]);
    await as(B);
    const s = (await db.query<{ id: string }>(`select (public.mark_settlement($1, $2)).id as id`, [hh, A])).rows[0];
    await as(A);
    await expect(db.query(`select public.delete_purchase($1)`, [id])).rejects.toMatchObject({ code: "23514", message: "has_payments" });
    await as(B);
    await db.query(`select public.cancel_settlement($1)`, [s.id]);
    await as(A);
    await db.query(`select public.delete_purchase($1)`, [id]);
  });
  it("edits the description (1..200) and nothing else", async () => {
    const id = await buy(3000, [A, B]);
    await as(A);
    const r = (await db.query<{ r: { description: string; amount: number } }>(`select public.update_purchase_description($1, '  Хлеб  ') as r`, [id])).rows[0].r;
    expect(r).toMatchObject({ description: "Хлеб", amount: 3000 });
    await expectCode(db.query(`select public.update_purchase_description($1, '   ')`, [id]), "23514");
    await expectCode(db.query(`select public.update_purchase_description($1, $2)`, [id, "я".repeat(201)]), "23514");
  });
  it("direct client update and delete on purchases are revoked", async () => {
    const id = await buy(3000, [A, B]);
    await as(A);
    await expectCode(db.query(`update public.purchases set description = 'hack' where id = $1`, [id]), "42501");
    await expectCode(db.query(`delete from public.purchases where id = $1`, [id]), "42501");
    await expectCode(db.query(`update public.purchases set merchant = 'x' where id = $1`, [id]), "42501");
  });
});

describe("anon surface", () => {
  it("anon can execute only capture_purchase, prune_push_subscription and run_daily_reminders", async () => {
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
    ]);
  });
  it("the new functions are security definer with an empty search_path", async () => {
    await admin();
    const names = ["server_secret_ok", "subscriptions_of", "run_daily_reminders", "remind", "set_reminders_enabled", "create_purchase_custom", "delete_purchase", "update_purchase_description"];
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
  it("authenticated cannot call run_daily_reminders directly", async () => {
    await expectCode(daily(SECRET, "authenticated"), "42501");
  });
});
