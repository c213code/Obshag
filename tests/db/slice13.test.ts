import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const A = "00000000-0000-0000-0000-00000000000a"; // admin (creator)
const B = "00000000-0000-0000-0000-00000000000b"; // member, @aidos_k
const C = "00000000-0000-0000-0000-00000000000c"; // member
const SECRET = "slice13-secret";
const CHAT = 987654321;

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
const sends = async () => {
  await admin();
  return (await db.query<{ chat: string; text: string }>(`select chat::text, text from private.tg_log order by id`)).rows;
};
const remind = async (user: string, debtor: string) => {
  await as(user);
  return db.query(`select public.remind($1, $2, $3) as r`, [SECRET, hh, debtor]);
};

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUB);
  for (const file of MIGRATIONS) await db.exec(readFileSync(join(process.cwd(), "supabase/migrations", file), "utf8"));
  await db.exec(`insert into auth.users values ('${A}'),('${B}'),('${C}');`);
  for (const [id, name] of [[A, "Ерасыл"], [B, "Айдос"], [C, "Даня"]]) {
    await as(id);
    await db.query(`select public.upsert_profile($1, '+77001234567')`, [name]);
  }
  await as(B);
  await db.query(`select public.set_telegram_username('@aidos_k')`);
  await as(A);
  await db.query(`select public.set_telegram_username('erasyl_a')`);
  const h = await db.query<{ id: string; invite_code: string }>(`select * from public.create_household('Квартира 42')`);
  hh = h.rows[0].id;
  for (const u of [B, C]) {
    await as(u);
    await db.query(`select public.join_household($1)`, [h.rows[0].invite_code]);
  }
  await admin();
  await db.exec(`insert into private.server_secrets values ('cron', encode(extensions.digest('${SECRET}', 'sha256'), 'hex'))`);
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await admin();
  await db.exec(`truncate public.reminder_log, public.settlement_shares, public.settlements, public.purchases cascade;
    update public.members set role = 'admin', active = true where user_id = '${A}';
    update public.members set role = 'member', active = true where user_id <> '${A}';
    update public.households set telegram_chat_id = null;`);
});


const netOf = async (debtor: string, creditor: string) => {
  await admin();
  return Number((await db.query<{ n: string }>(`select private.pair_net($1, $2, $3)::text as n`, [hh, debtor, creditor])).rows[0].n);
};
const openShares = async () => {
  await admin();
  return Number((await db.query<{ n: string }>(`select count(*)::text as n from public.shares where settled_at is null and amount > 0`)).rows[0].n);
};
const writeOff = async (user: string, debtor: string) => {
  await as(user);
  return db.query<{ r: { id: string; kind: string; status: string; amount: number; from_id: string; to_id: string } }>(
    `select to_jsonb(public.write_off_small($1, $2)) as r`, [hh, debtor]);
};
const mark = async (user: string, to: string) => {
  await as(user);
  return db.query(`select public.mark_settlement($1, $2)`, [hh, to]);
};
const logRows = async () => {
  await admin();
  return Number((await db.query<{ n: string }>(`select count(*)::text as n from public.reminder_log`)).rows[0].n);
};
const reminders = async () => {
  await as(null, "anon");
  return (await db.query<{ r: unknown[] }>(`select public.run_daily_reminders($1) as r`, [SECRET])).rows[0].r;
};
const age = async () => {
  await admin();
  await db.exec(`update public.purchases set created_at = now() - interval '3 days'`);
};

describe("min_transfer", () => {
  it("is 100", async () => {
    await admin();
    expect((await db.query<{ n: number }>(`select private.min_transfer() as n`)).rows[0].n).toBe(100);
  });
});

describe("daily reminders", () => {
  it("skip a pair below 100 and keep the ones at 100 or more", async () => {
    await buy(A, 300, [A, B, C]); // B and C owe A 100 each
    await buy(A, 150, [A, B]); // B owes A 75 more -> 175
    await buy(B, 150, [B, C]); // C owes B 75: below the minimum
    await age();
    const out = (await reminders()) as Array<{ to_user: string; from_user: string; amount: number }>;
    expect(out.map((r) => `${r.to_user}>${r.from_user}:${r.amount}`).sort()).toEqual([`${B}>${A}:175`, `${C}>${A}:100`].sort());
  });
  it("sends nothing when every net is below 100", async () => {
    await buy(A, 150, [A, B]); // B owes 75
    await age();
    expect(await reminders()).toEqual([]);
    expect(await logRows()).toBe(0);
  });
});

describe("remind", () => {
  it("raises too_small below 100, logs nothing and posts nothing", async () => {
    await admin();
    await db.exec(`
      create table if not exists private.tg_log (id serial primary key, chat bigint, text text);
      create or replace function private.tg_send(p_chat bigint, p_text text) returns void language sql as
        $$ insert into private.tg_log (chat, text) values (p_chat, p_text) $$;
      truncate private.tg_log;
      update public.households set telegram_chat_id = ${CHAT};`);
    await buy(A, 150, [A, B]);
    await admin();
    await db.exec(`truncate private.tg_log`); // the purchase post itself is not under test
    await expect(remind(A, B)).rejects.toMatchObject({ code: "P0001", message: "too_small" });
    expect(await logRows()).toBe(0);
    expect(await sends()).toEqual([]);
  });
  it("still works at exactly 100", async () => {
    await buy(A, 200, [A, B]);
    await remind(A, B);
    expect(await logRows()).toBe(1);
  });
});

describe("mark_settlement", () => {
  it("refuses below 100 with too_small and creates nothing", async () => {
    await buy(A, 150, [A, B]);
    await expect(mark(B, A)).rejects.toMatchObject({ code: "P0001", message: "too_small" });
    await admin();
    expect((await db.query(`select 1 from public.settlements`)).rows).toHaveLength(0);
  });
  it("marks at exactly 100", async () => {
    await buy(A, 200, [A, B]);
    await mark(B, A);
    await admin();
    expect((await db.query(`select 1 from public.settlements where status = 'marked'`)).rows).toHaveLength(1);
  });
  it("nothing owed is still 23514", async () => {
    await expectCode(mark(B, A), "23514");
  });
});

describe("write_off_small", () => {
  it("the creditor closes exactly the open shares and the net becomes 0", async () => {
    await buy(A, 90, [A, B]); // 45
    await buy(A, 60, [A, B]); // 30
    const before = await netOf(B, A);
    expect(before).toBeGreaterThan(0);
    expect(before).toBeLessThan(100);
    const r = (await writeOff(A, B)).rows[0].r;
    expect(r).toMatchObject({ kind: "writeoff", status: "confirmed", amount: before, from_id: B, to_id: A });
    expect(await netOf(B, A)).toBe(0);
    expect(await openShares()).toBe(0);
    await admin();
    const cov = await db.query(`select 1 from public.settlement_shares where settlement_id = $1`, [r.id]);
    expect(cov.rows).toHaveLength(2);
    const closed = await db.query(`select 1 from public.shares where settlement_id = $1 and settled_at is not null`, [r.id]);
    expect(closed.rows).toHaveLength(2);
  });
  it("nets the opposite direction: covers both sides", async () => {
    await buy(A, 400, [A, B]); // B owes A 200
    await buy(B, 250, [B, A]); // A owes B 125 -> net B->A 75
    expect(await netOf(B, A)).toBe(75);
    const r = (await writeOff(A, B)).rows[0].r;
    expect(r.amount).toBe(75);
    expect(await netOf(B, A)).toBe(0);
    expect(await openShares()).toBe(0);
  });
  it("is refused at 100 or more (not_small), nothing changes", async () => {
    await buy(A, 200, [A, B]);
    await expect(writeOff(A, B)).rejects.toMatchObject({ code: "P0001", message: "not_small" });
    expect(await netOf(B, A)).toBe(100);
  });
  it("the debtor cannot write off (42501) and the stranger neither", async () => {
    await buy(A, 150, [A, B]);
    await expectCode(writeOff(B, A), "42501");
    await expectCode(writeOff(C, B), "42501");
    expect(await netOf(B, A)).toBe(75);
  });
  it("nothing owed is refused", async () => {
    await expectCode(writeOff(A, B), "42501");
  });
  it("is closed by a repeat call (nothing left)", async () => {
    await buy(A, 150, [A, B]);
    await writeOff(A, B);
    await expectCode(writeOff(A, B), "42501");
  });
  it("supersedes a pending «paid» mark made before the amount shrank", async () => {
    await buy(A, 400, [A, B]); // 200
    await mark(B, A);
    await buy(B, 250, [B, A]); // A owes 125 -> net 75
    await writeOff(A, B);
    await admin();
    const st = await db.query<{ status: string; kind: string }>(`select status, kind from public.settlements order by marked_at, kind`);
    expect(st.rows.map((x) => `${x.kind}:${x.status}`).sort()).toEqual(["transfer:cancelled", "writeoff:confirmed"]);
  });
  it("anon cannot call it", async () => {
    await as(null, "anon");
    await expectCode(db.query(`select public.write_off_small($1, $2)`, [hh, B]), "42501");
  });
  it("default kind is transfer", async () => {
    await buy(A, 200, [A, B]);
    await mark(B, A);
    await admin();
    expect((await db.query<{ kind: string }>(`select kind from public.settlements`)).rows[0].kind).toBe("transfer");
  });
});

describe("Telegram write-off message", () => {
  beforeAll(async () => {
    await admin();
    await db.exec(`
      create table if not exists private.tg_log (id serial primary key, chat bigint, text text);
      create or replace function private.tg_send(p_chat bigint, p_text text) returns void language sql as
        $$ insert into private.tg_log (chat, text) values (p_chat, p_text) $$;
    `);
  });
  it("the builder names both people and the minimum", async () => {
    await buy(A, 150, [A, B]);
    const id = (await writeOff(A, B)).rows[0].r.id;
    await admin();
    const m = (await db.query<{ m: string }>(`select private.tg_writeoff_message($1) as m`, [id])).rows[0].m;
    expect(m).toBe("🧾 @erasyl_a списал(а) @aidos_k 75 ₸ (меньше 100 — Kaspi не переводит)");
  });
  it("the settlement trigger posts it instead of «рассчитались»", async () => {
    await admin();
    await db.exec(`truncate private.tg_log; update public.households set telegram_chat_id = ${CHAT}; truncate private.telegram_sent;`);
    await buy(A, 150, [A, B]);
    await admin();
    await db.exec(`truncate private.tg_log`);
    await writeOff(A, B);
    const out = await sends();
    expect(out).toHaveLength(1);
    expect(out[0].text).toContain("списал(а)");
    expect(out[0].text).not.toContain("рассчитались");
  });
  it("a normal confirmation still says «рассчитались»", async () => {
    await admin();
    await db.exec(`truncate private.tg_log; update public.households set telegram_chat_id = ${CHAT}; truncate private.telegram_sent;`);
    await buy(A, 400, [A, B]);
    await mark(B, A);
    await admin();
    await db.exec(`truncate private.tg_log`);
    await as(A);
    const id = (await db.query<{ id: string }>(`select id from public.settlements`)).rows[0].id;
    await db.query(`select public.confirm_settlement($1)`, [id]);
    const out = await sends();
    expect(out.some((x) => x.text.includes("рассчитались"))).toBe(true);
  });
});

describe("anon surface", () => {
  it("is still exactly the seven server-secret / token functions", async () => {
    await admin();
    const r = await db.query<{ n: string }>(
      `select p.proname as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname in ('public', 'private') and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')
         and p.proname not in ('uid')
       order by 1`,
    );
    expect(r.rows.map((x) => x.n)).toEqual([
      "capture_purchase",
      "prune_push_subscription",
      "run_daily_reminders",
      "run_monthly_bills",
      "run_pending_digest",
      "tg_link_account",
      "tg_resolve_pending",
    ]);
  });
});
