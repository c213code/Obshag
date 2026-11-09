import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const A = "00000000-0000-0000-0000-00000000000a"; // admin (creator)
const B = "00000000-0000-0000-0000-00000000000b"; // member, @aidos_k
const C = "00000000-0000-0000-0000-00000000000c"; // member
const SECRET = "slice11-secret";
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
async function insertPurchase(payer: string, status: "pending" | "personal") {
  await admin();
  const r = await db.query<{ id: string }>(
    `insert into public.purchases (household_id, payer_id, amount, description, source, status) values ($1, $2, 700, 'кофе', 'apple_pay', $3) returning id`,
    [hh, payer, status],
  );
  return r.rows[0].id;
}
const exists = async (id: string) => {
  await admin();
  return (await db.query(`select 1 from public.purchases where id = $1`, [id])).rows.length === 1;
};
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

describe("delete_purchase: admins", () => {
  it("an active admin deletes another member's shared purchase", async () => {
    const id = await buy(B, 600, [B, C, A]);
    await as(A);
    await db.query(`select public.delete_purchase($1)`, [id]);
    expect(await exists(id)).toBe(false);
  });
  it("the payer can still delete their own purchase", async () => {
    const id = await buy(B, 600, [B, C]);
    await as(B);
    await db.query(`select public.delete_purchase($1)`, [id]);
    expect(await exists(id)).toBe(false);
  });
  it("a non-admin non-payer is refused with 42501", async () => {
    const id = await buy(B, 600, [B, A]);
    await as(C);
    await expectCode(db.query(`select public.delete_purchase($1)`, [id]), "42501");
    expect(await exists(id)).toBe(true);
  });
  it("an admin cannot see or delete someone's pending or personal purchase (not found)", async () => {
    for (const status of ["pending", "personal"] as const) {
      const id = await insertPurchase(B, status);
      await as(A);
      await expectCode(db.query(`select public.delete_purchase($1)`, [id]), "P0002");
      expect(await exists(id)).toBe(true);
    }
  });
  it("has_payments still blocks an admin", async () => {
    const id = await buy(B, 600, [B, C]);
    await admin();
    await db.exec(`update public.shares set settled_at = now() where debtor_id = '${C}'`);
    await as(A);
    await expect(db.query(`select public.delete_purchase($1)`, [id])).rejects.toMatchObject({ code: "23514", message: "has_payments" });
    expect(await exists(id)).toBe(true);
  });
  it("a settlement that covers the purchase blocks an admin too", async () => {
    const id = await buy(B, 600, [B, C]);
    await as(C);
    await db.query(`select public.mark_settlement($1, $2)`, [hh, B]);
    await as(A);
    await expect(db.query(`select public.delete_purchase($1)`, [id])).rejects.toMatchObject({ code: "23514", message: "has_payments" });
  });
  it("a former admin (inactive) is refused", async () => {
    const id = await buy(B, 600, [B, C]);
    await admin();
    await db.exec(`update public.members set role = 'admin' where user_id = '${C}'; update public.members set active = false where user_id = '${A}'`);
    await as(A);
    await expectCode(db.query(`select public.delete_purchase($1)`, [id]), "P0002");
    expect(await exists(id)).toBe(true);
  });
  it("a promoted member can delete", async () => {
    const id = await buy(B, 600, [B, A]);
    await as(A);
    await db.query(`select public.set_member_role($1, $2, 'admin')`, [hh, C]);
    await as(C);
    await db.query(`select public.delete_purchase($1)`, [id]);
    expect(await exists(id)).toBe(false);
  });
  it("anonymous callers are refused and the anon surface is still 4 functions", async () => {
    await as(null, "anon");
    await expectCode(db.query(`select public.delete_purchase('00000000-0000-0000-0000-0000000000aa')`), "42501");
    await admin();
    const r = await db.query<{ n: string }>(
      `select p.oid::regprocedure::text as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname in ('public', 'private') and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')
         and p.proname not in ('uid')
       order by 1`,
    );
    expect(r.rows).toHaveLength(4);
  });
});

describe("remind posts to Telegram", () => {
  const owed = async () => {
    const id = await buy(A, 2400, [A, B]); // B owes A 1 200
    await admin();
    return id;
  };

  it("still works when pg_net is absent (the real tg_send is a no-op in PGlite)", async () => {
    await owed();
    await admin();
    await db.exec(`update public.households set telegram_chat_id = ${CHAT}`);
    const r = await remind(A, B);
    expect((r.rows[0] as { r: { amount: number } }).r.amount).toBe(1200);
    await admin();
    expect((await db.query(`select 1 from public.reminder_log`)).rows).toHaveLength(1);
  });

  describe("with a recording tg_send", () => {
    beforeAll(async () => {
      await admin();
      await db.exec(`
        create table private.tg_log (id serial primary key, chat bigint, text text);
        create or replace function private.tg_send(p_chat bigint, p_text text) returns void language sql as
          $$ insert into private.tg_log (chat, text) values (p_chat, p_text) $$;
      `);
    });
    beforeEach(async () => {
      await admin();
      await db.exec(`truncate private.tg_log`);
    });

    it("the builder tags both people and formats the amount", async () => {
      await admin();
      const m = (await db.query<{ m: string }>(`select private.tg_remind_message($1, $2, 1200) as m`, [B, A])).rows[0].m;
      expect(m).toBe("🔔 @aidos_k, напоминание: ты должен @erasyl_a 1 200 ₸");
      const noHandle = (await db.query<{ m: string }>(`select private.tg_remind_message($1, $2, 50000) as m`, [C, A])).rows[0].m;
      expect(noHandle).toBe("🔔 Даня, напоминание: ты должен @erasyl_a 50 000 ₸");
    });

    it("a manual remind posts once to the group with the current net", async () => {
      await owed();
      await admin();
      await db.exec(`update public.households set telegram_chat_id = ${CHAT}`);
      await remind(A, B);
      expect(await sends()).toEqual([{ chat: String(CHAT), text: "🔔 @aidos_k, напоминание: ты должен @erasyl_a 1 200 ₸" }]);
    });

    it("a cooldown-blocked remind posts nothing", async () => {
      await owed();
      await admin();
      await db.exec(`update public.households set telegram_chat_id = ${CHAT}`);
      await remind(A, B);
      await expectCode(remind(A, B), "P0001");
      expect(await sends()).toHaveLength(1);
    });

    it("no chat id: nothing is sent, the reminder still works", async () => {
      await owed();
      await remind(A, B);
      expect(await sends()).toEqual([]);
      await admin();
      expect((await db.query(`select 1 from public.reminder_log`)).rows).toHaveLength(1);
    });

    it("the daily cron reminders never post to Telegram", async () => {
      await owed();
      await admin();
      await db.exec(`update public.households set telegram_chat_id = ${CHAT}; update public.purchases set created_at = now() - interval '2 days';`);
      await db.query(`select public.run_daily_reminders($1)`, [SECRET]);
      expect((await db.query(`select 1 from public.reminder_log`)).rows).toHaveLength(1);
      expect(await sends()).toEqual([]);
    });

    it("a failing Telegram send never breaks the reminder", async () => {
      await owed();
      await admin();
      await db.exec(`
        update public.households set telegram_chat_id = ${CHAT};
        create or replace function private.tg_send(p_chat bigint, p_text text) returns void language plpgsql as
          $$ begin raise exception 'telegram down'; end $$;
      `);
      const r = await remind(A, B);
      expect((r.rows[0] as { r: { amount: number } }).r.amount).toBe(1200);
      await admin();
      expect((await db.query(`select 1 from public.reminder_log`)).rows).toHaveLength(1);
    });
  });
});
