import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const A = "00000000-0000-0000-0000-00000000000a"; // payer
const B = "00000000-0000-0000-0000-00000000000b"; // has @aidos_k
const C = "00000000-0000-0000-0000-00000000000c"; // no handle, name needs escaping
const CHAT = 1234567890;

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
const msg = async (id: string) => {
  await admin();
  return (await db.query<{ m: string }>(`select private.tg_purchase_message($1) as m`, [id])).rows[0].m;
};
const sentRows = async () => {
  await admin();
  return (await db.query<{ kind: string; ref: string }>(`select kind, ref from private.telegram_sent order by kind`)).rows;
};
async function buy(payer: string, amount: number, desc: string, who: string[], merchant: string | null = null) {
  await as(payer);
  const r = await db.query<{ r: { id: string } }>(`select to_jsonb(public.create_purchase_with_shares($1, $2, $3, $4, $5)) as r`, [hh, amount, desc, merchant, who]);
  return (r.rows[0].r as unknown as { purchase?: { id: string }; id?: string }).purchase?.id ?? r.rows[0].r.id;
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUB);
  for (const file of MIGRATIONS) await db.exec(readFileSync(join(process.cwd(), "supabase/migrations", file), "utf8"));
  await db.exec(`insert into auth.users values ('${A}'),('${B}'),('${C}');`);
  for (const [id, name] of [[A, "Ерасыл"], [B, "Айдос"], [C, "Дана <b>&"]]) {
    await as(id);
    await db.query(`select public.upsert_profile($1, '+77001234567')`, [name]);
  }
  await as(B);
  await db.query(`select public.set_telegram_username('@aidos_k')`);
  await as(A);
  const h = await db.query<{ id: string; invite_code: string }>(`select * from public.create_household('Квартира 42')`);
  hh = h.rows[0].id;
  for (const u of [B, C]) {
    await as(u);
    await db.query(`select public.join_household($1)`, [h.rows[0].invite_code]);
  }
  await admin();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await admin();
  await db.exec(`truncate private.telegram_sent; update public.households set telegram_chat_id = null;`);
});

describe("set_telegram_username", () => {
  it("accepts @name and name, trims, clears on empty or null", async () => {
    await as(A);
    expect((await db.query<{ r: string }>(`select public.set_telegram_username(' @Erasyl_1 ') as r`)).rows[0].r).toBe("Erasyl_1");
    await db.query(`select public.set_telegram_username('plain_name')`);
    expect((await db.query<{ t: string }>(`select telegram_username t from public.profiles where id = $1`, [A])).rows[0].t).toBe("plain_name");
    expect((await db.query<{ r: string | null }>(`select public.set_telegram_username('@') as r`)).rows[0].r).toBeNull();
    await db.query(`select public.set_telegram_username('plain_name')`);
    await db.query(`select public.set_telegram_username(null)`);
    expect((await db.query<{ t: string | null }>(`select telegram_username t from public.profiles where id = $1`, [A])).rows[0].t).toBeNull();
  });
  it("rejects bad values with 23514 and anonymous callers", async () => {
    await as(A);
    for (const bad of ["abcd", "has space", "@@twice", "a".repeat(33), "bad-dash", "кириллица"]) {
      await expectCode(db.query(`select public.set_telegram_username($1)`, [bad]), "23514");
    }
    await as(null, "anon");
    await expectCode(db.query(`select public.set_telegram_username('valid_name')`), "42501");
  });
  it("cannot be written directly by a client", async () => {
    await as(A);
    await expectCode(db.query(`update public.profiles set telegram_username = 'sneaky_one' where id = $1`, [A]), "42501");
    await expectCode(db.query(`insert into public.profiles (id, display_name, telegram_username) values (gen_random_uuid(), 'x', 'sneaky_one')`), "42501");
  });
});

describe("message builders", () => {
  it("tags by @username or name, excludes the payer, escapes HTML, formats thousands", async () => {
    const id = await buy(A, 6000, "Хлеб <i>&", [A, B, C]);
    const m = await msg(id);
    expect(m).toBe("🛒 Хлеб &lt;i&gt;&amp; — 6 000 ₸\nПлатил: Ерасыл\nДолжны:\n@aidos_k — 2 000 ₸\nДана &lt;b&gt;&amp; — 2 000 ₸");
  });
  it("falls back to the merchant, then «Покупка»; big amounts are grouped", async () => {
    await admin();
    const id = await buy(A, 1234567, "x", [A, B]);
    await admin();
    await db.exec(`update public.purchases set description = ' ', merchant = 'Magnum' where id = '${id}'`);
    // description has a >=1 char check; a blank one is still a non-empty string, so the merchant fallback is exercised
    expect(await msg(id)).toContain("Magnum — 1 234 567 ₸");
  });
  it("uses the house icon for monthly bills", async () => {
    const id = await buy(A, 180000, "Квартплата", [A, B]);
    await admin();
    const bill = await db.query<{ id: string }>(
      `insert into public.bills (household_id, title, day_of_month, payer_id) values ($1, 'Квартплата', 1, $2) returning id`,
      [hh, A],
    );
    await db.query(`update public.purchases set bill_id = $1, bill_month = '2026-11' where id = $2`, [bill.rows[0].id, id]);
    expect(await msg(id)).toMatch(/^🏠 Квартплата — 180 000 ₸\nПлатил: Ерасыл\nДолжны:\n@aidos_k — 90 000 ₸$/);
  });
  it("settlement message tags both sides with an arrow", async () => {
    await admin();
    const st = await db.query<{ id: string }>(
      `insert into public.settlements (household_id, from_id, to_id, amount, status) values ($1, $2, $3, 200, 'marked') returning id`,
      [hh, B, A],
    );
    const r = await db.query<{ m: string }>(`select private.tg_settlement_message($1) as m`, [st.rows[0].id]);
    expect(r.rows[0].m).toBe("✅ @aidos_k → Ерасыл · 200 ₸ · рассчитались");
  });
});

describe("triggers", () => {
  it("do nothing without a group chat", async () => {
    await buy(A, 3000, "Молоко", [A, B]);
    expect(await sentRows()).toEqual([]);
  });
  it("write one idempotency row for a shared purchase and never break the insert without pg_net", async () => {
    await admin();
    await db.exec(`update public.households set telegram_chat_id = ${CHAT}`);
    const id = await buy(A, 3000, "Молоко", [A, B]);
    expect(await sentRows()).toEqual([{ kind: "purchase", ref: id }]);
    // a rename of the shared row does not post again
    await admin();
    await db.exec(`update public.purchases set description = 'Молоко 2' where id = '${id}'`);
    expect(await sentRows()).toHaveLength(1);
  });
  it("never posts personal or pending purchases; a pending one posts once when it becomes shared", async () => {
    await admin();
    await db.exec(`update public.households set telegram_chat_id = ${CHAT}`);
    const p = await db.query<{ id: string }>(
      `insert into public.purchases (household_id, payer_id, amount, description, source, status) values ($1, $2, 500, 'Кофе', 'apple_pay', 'pending') returning id`,
      [hh, A],
    );
    await db.exec(`insert into public.purchases (household_id, payer_id, amount, description, status) values ('${hh}', '${A}', 700, 'Своё', 'personal')`);
    expect(await sentRows()).toEqual([]);
    await db.exec(`update public.purchases set status = 'shared' where id = '${p.rows[0].id}'`);
    expect(await sentRows()).toEqual([{ kind: "purchase", ref: p.rows[0].id }]);
  });
  it("posts a confirmed settlement once", async () => {
    await admin();
    await db.exec(`update public.households set telegram_chat_id = ${CHAT}`);
    const st = await db.query<{ id: string }>(
      `insert into public.settlements (household_id, from_id, to_id, amount, status) values ($1, $2, $3, 200, 'marked') returning id`,
      [hh, B, A],
    );
    expect(await sentRows()).toEqual([]);
    await db.exec(`update public.settlements set status = 'confirmed', confirmed_at = now() where id = '${st.rows[0].id}'`);
    await db.exec(`update public.settlements set amount = 201 where id = '${st.rows[0].id}'`);
    expect(await sentRows()).toEqual([{ kind: "settlement", ref: st.rows[0].id }]);
  });
  it("tg_send is a clean no-op when pg_net or the vault secret is missing", async () => {
    await admin();
    await expect(db.query(`select private.tg_send(${CHAT}, 'hi')`)).resolves.toBeDefined();
    await expect(db.query(`select private.tg_send(null, 'hi')`)).resolves.toBeDefined();
  });
});

describe("permissions", () => {
  it("clients cannot execute any private telegram function or read the idempotency table", async () => {
    for (const role of ["authenticated", "anon"] as const) {
      await as(A, role);
      for (const call of [
        `private.tg_send(1, 'x')`,
        `private.tg_purchase_message(gen_random_uuid())`,
        `private.tg_settlement_message(gen_random_uuid())`,
        `private.tg_esc('x')`,
        `private.tg_money(1)`,
        `private.tg_tag(gen_random_uuid())`,
      ]) {
        await expect(db.query(`select ${call}`)).rejects.toMatchObject({ code: "42501" });
      }
      await expect(db.query(`select * from private.telegram_sent`)).rejects.toMatchObject({ code: "42501" });
    }
  });
  it("the anon surface is still exactly 4 functions", async () => {
    await admin();
    const r = await db.query<{ n: string }>(
      `select p.proname n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname in ('public', 'private') and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')
         and p.proname not in ('uid')
       order by 1`,
    );
    expect(r.rows.map((x) => x.n)).toEqual(["capture_purchase", "prune_push_subscription", "run_daily_reminders", "run_monthly_bills"]);
  });
});
