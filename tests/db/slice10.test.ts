import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const A = "00000000-0000-0000-0000-00000000000a"; // payer, token owner
const B = "00000000-0000-0000-0000-00000000000b";
const C = "00000000-0000-0000-0000-00000000000c"; // can be away

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
];

type Captured = { status: string; purchase_id: string; subscriptions: unknown[]; deduped?: boolean };

let db: PGlite;
let hh: string;
let token: string;

async function as(user: string | null, role: "authenticated" | "anon" = "authenticated") {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ""}', false); set role ${role};`);
}
async function admin() {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
}
async function capture(tok: string, amount: number, merchant: string | null, ...choice: Array<string | null>) {
  await as(null, "anon");
  const r = choice.length
    ? await db.query<{ r: Captured }>(`select public.capture_purchase($1, $2, $3, $4) as r`, [tok, amount, merchant, choice[0]])
    : await db.query<{ r: Captured }>(`select public.capture_purchase($1, $2, $3) as r`, [tok, amount, merchant]);
  return r.rows[0].r;
}
async function shares(id: string) {
  await admin();
  return (
    await db.query<{ debtor_id: string; amount: number; settled: boolean }>(
      `select debtor_id, amount, settled_at is not null as settled from public.shares where purchase_id = $1 order by debtor_id`,
      [id],
    )
  ).rows;
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUB);
  for (const file of MIGRATIONS) await db.exec(readFileSync(join(process.cwd(), "supabase/migrations", file), "utf8"));
  await db.exec(`insert into auth.users values ('${A}'),('${B}'),('${C}');`);
  for (const [id, name] of [[A, "Ерасыл"], [B, "Айдос"], [C, "Дана"]]) {
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
  await as(A);
  token = (await db.query<{ t: string }>(`select public.rotate_capture_token() as t`)).rows[0].t;
  await admin();
});
afterAll(async () => {
  await db.close();
});
// Test fixture reset: runs as the table owner against the in-memory test database only.
beforeEach(async () => {
  await admin();
  await db.exec(`truncate public.purchases cascade; truncate private.capture_ops; update public.members set away_until = null;`);
});

describe("capture_purchase with a choice", () => {
  it("shared: created shared at once, equal split among all members, payer's own share settled, no subscriptions", async () => {
    await as(A);
    await db.query(`select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/1', 'k', 'a')`);
    const r = await capture(token, 1000, "Magnum", "shared");
    expect(r.status).toBe("shared");
    expect(r.subscriptions).toEqual([]);
    const s = await shares(r.purchase_id);
    expect(s.map((x) => x.debtor_id).sort()).toEqual([A, B, C]);
    expect(s.reduce((n, x) => n + x.amount, 0)).toBe(1000);
    expect(s.find((x) => x.debtor_id === A)).toMatchObject({ settled: true });
    expect(s.find((x) => x.debtor_id === B)).toMatchObject({ settled: false });
    await admin();
    const p = (await db.query<{ status: string; description: string; payer_id: string; source: string }>(`select status, description, payer_id, source from public.purchases where id = $1`, [r.purchase_id])).rows[0];
    expect(p).toEqual({ status: "shared", description: "Magnum", payer_id: A, source: "apple_pay" });
    expect(hh).toBeTruthy();
  });

  it("shared accepts the Russian word with spaces and capitals; description falls back to «Покупка»", async () => {
    const r = await capture(token, 900, null, "  ОБЩЕЕ ");
    expect(r.status).toBe("shared");
    await admin();
    expect((await db.query<{ d: string }>(`select description d from public.purchases where id = $1`, [r.purchase_id])).rows[0].d).toBe("Покупка");
  });

  it("shared skips away members; if everybody is away it splits among everyone", async () => {
    await admin();
    await db.exec(`update public.members set away_until = (now() at time zone 'Asia/Almaty')::date + 3 where user_id = '${C}'`);
    const r = await capture(token, 1000, "a", "shared");
    expect((await shares(r.purchase_id)).map((x) => x.debtor_id).sort()).toEqual([A, B]);
    await admin();
    await db.exec(`update public.members set away_until = (now() at time zone 'Asia/Almaty')::date`);
    const all = await capture(token, 1001, "b", "shared");
    expect((await shares(all.purchase_id)).map((x) => x.debtor_id).sort()).toEqual([A, B, C]);
    await admin();
    // back the day after: C is home again while A and B are still away, so only C is split
    await db.exec(`update public.members set away_until = (now() at time zone 'Asia/Almaty')::date - 1 where user_id = '${C}'`);
    expect((await shares((await capture(token, 1002, "c", "shared")).purchase_id)).map((x) => x.debtor_id)).toEqual([C]);
  });

  it("shared with an amount smaller than the head count stays pending", async () => {
    const r = await capture(token, 2, "tiny", "shared");
    expect(r.status).toBe("pending");
  });

  it("personal: created personal, no shares, no subscriptions, invisible to housemates", async () => {
    const r = await capture(token, 500, "Кофе", "моё");
    expect(r.status).toBe("personal");
    expect(r.subscriptions).toEqual([]);
    expect(await shares(r.purchase_id)).toEqual([]);
    await as(B);
    expect((await db.query(`select id from public.purchases where id = $1`, [r.purchase_id])).rows).toEqual([]);
    await as(A);
    expect((await db.query(`select id from public.purchases where id = $1`, [r.purchase_id])).rows).toHaveLength(1);
  });

  it("null, missing, later, потом, empty and junk all give pending, with the owner's subscriptions", async () => {
    await as(A);
    await db.query(`select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/1', 'k', 'a')`);
    let amount = 100;
    for (const choice of [null, "later", "потом", "", "whatever"]) {
      const r = await capture(token, amount++, "m", choice);
      expect(r.status, String(choice)).toBe("pending");
      expect(r.subscriptions).toHaveLength(1);
    }
    expect((await capture(token, amount++, "m")).status).toBe("pending"); // the old 3-argument call
  });

  it("a retry with the same choice within 60 s returns the same purchase and does not double the shares", async () => {
    const first = await capture(token, 1200, "Magnum", "shared");
    const again = await capture(token, 1200, "Magnum", "shared");
    expect(again.purchase_id).toBe(first.purchase_id);
    expect(again.deduped).toBe(true);
    expect(await shares(first.purchase_id)).toHaveLength(3);
  });

  it("a bad token is rejected whatever the choice, and nothing is created", async () => {
    for (const choice of [null, "shared", "personal"]) {
      await expect(capture("x".repeat(43), 100, "m", choice)).rejects.toMatchObject({ code: "28000" });
    }
    await admin();
    expect((await db.query(`select 1 from public.purchases`)).rows).toHaveLength(0);
  });

  it("decided captures count against the 30/hour limit", async () => {
    for (let i = 0; i < 30; i++) await capture(token, 100 + i, "m", "personal");
    await expect(capture(token, 999, "m", "personal")).rejects.toMatchObject({ code: "P0001" });
  });
});

describe("surface", () => {
  it("the anon surface is still exactly 4 functions: the 4-argument capture_purchase replaced the 3-argument one", async () => {
    await admin();
    const r = await db.query<{ n: string }>(
      `select p.oid::regprocedure::text as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname in ('public', 'private') and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')
         and p.proname not in ('uid')
       order by 1`,
    );
    expect(r.rows.map((x) => x.n)).toEqual([
      "capture_purchase(text,integer,text,text)",
      "prune_push_subscription(text,text)",
      "run_daily_reminders(text)",
      "run_monthly_bills(text)",
    ]);
  });
  it("capture_purchase is security definer with an empty search_path, and authenticated cannot execute it", async () => {
    await admin();
    const r = await db.query<{ definer: boolean; cfg: string[]; auth: boolean }>(
      `select prosecdef definer, proconfig cfg, has_function_privilege('authenticated', oid, 'execute') auth
       from pg_proc where proname = 'capture_purchase'`,
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toEqual({ definer: true, cfg: ["search_path=\"\""], auth: false });
  });
});
