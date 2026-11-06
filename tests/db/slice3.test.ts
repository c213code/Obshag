import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const A = "00000000-0000-0000-0000-00000000000a"; // me, debtor in the main scenario
const B = "00000000-0000-0000-0000-00000000000b"; // creditor
const C = "00000000-0000-0000-0000-00000000000c"; // third housemate
const X = "00000000-0000-0000-0000-0000000000f1"; // member of ANOTHER household
const Y = "00000000-0000-0000-0000-0000000000f2"; // signed in, member of nothing

/** Mimics hosted Supabase: roles, auth.uid(), and its permissive default privileges on `public`. */
const STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
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
const MIGRATIONS = ["0001_baseline.sql", "0002_slice1_rpcs.sql", "0003_slice3_settlements.sql"];

let db: PGlite;
let hh: string;
let otherHh: string;

async function as(user: string | null, role: "authenticated" | "anon" = "authenticated") {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ""}', false); set role ${role};`);
}
async function admin() {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
}
async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code });
}

type Settlement = { id: string; from_id: string; to_id: string; amount: number; status: string; confirmed_at: string | null; marked_at: string };

/** A shared purchase paid by `payer`, with one open share per debtor. Runs as the payer through the real RPC. */
async function buy(payer: string, amount: number, debtors: string[], desc = "Покупка"): Promise<string> {
  await as(payer);
  const res = await db.query<{ r: { id: string } }>(`select public.create_purchase_with_shares($1, $2, $3, null, $4) as r`, [
    hh,
    amount,
    desc,
    [payer, ...debtors],
  ]);
  return res.rows[0].r.id;
}
async function mark(user: string, to: string) {
  await as(user);
  return (await db.query<Settlement>(`select * from public.mark_settlement($1, $2)`, [hh, to])).rows[0];
}
async function confirm(user: string, id: string) {
  await as(user);
  return (await db.query<Settlement>(`select * from public.confirm_settlement($1)`, [id])).rows[0];
}
async function cancel(user: string, id: string) {
  await as(user);
  return (await db.query<Settlement>(`select * from public.cancel_settlement($1)`, [id])).rows[0];
}
async function net(a: string, b: string) {
  await admin();
  return Number((await db.query<{ n: string | number | bigint }>(`select private.pair_net($1, $2, $3) as n`, [hh, a, b])).rows[0].n);
}
/** Test fixture reset: runs as the table owner against the in-memory test database only. */
async function resetLedger() {
  await admin();
  await db.exec(`truncate public.settlements, public.purchases cascade; truncate private.settlement_ops;`);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  for (const file of MIGRATIONS) await db.exec(readFileSync(join(process.cwd(), "supabase/migrations", file), "utf8"));
  await db.exec(`insert into auth.users values ('${A}'),('${B}'),('${C}'),('${X}'),('${Y}');`);
  for (const [id, name] of [
    [A, "Ерасыл"],
    [B, "Айдос"],
    [C, "Даня"],
    [X, "Чужой"],
    [Y, "Никто"],
  ]) {
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
  await as(X);
  otherHh = (await db.query<{ id: string }>(`select * from public.create_household('Чужая')`)).rows[0].id;
});

afterAll(async () => {
  await db.close();
});

/** The recorded set of a settlement (what mark_settlement froze). */
async function recorded(settlementId: string) {
  await admin();
  return (
    await db.query<{ purchase_id: string; debtor_id: string; amount: number }>(
      `select purchase_id, debtor_id, amount from public.settlement_shares where settlement_id = $1 order by amount desc, debtor_id`,
      [settlementId],
    )
  ).rows;
}

/** The main scenario: A owes B 2000, B owes A 1800 -> A pays 200. */
async function scenario() {
  await resetLedger();
  await buy(B, 4000, [A], "Интернет"); // A owes B 2000
  await buy(A, 3600, [B], "Картошка"); // B owes A 1800
}

describe("mark_settlement", () => {
  it("takes the amount from the server: the current net, never anything from the client", async () => {
    await scenario();
    expect(await net(A, B)).toBe(200);
    const s = await mark(A, B);
    expect(s).toMatchObject({ from_id: A, to_id: B, amount: 200, status: "marked", confirmed_at: null });
    // the RPC has no amount parameter at all
    const sig = await db.query<{ args: string }>(`select pg_get_function_identity_arguments('public.mark_settlement'::regproc) as args`);
    expect(sig.rows[0].args).toBe("p_household_id uuid, p_to uuid");
  });

  it("is idempotent: a second call returns the same open row and creates no second one", async () => {
    await scenario();
    const first = await mark(A, B);
    // more debt appears: asking again returns the SAME row, refreshed to the current open set (S2)
    await buy(B, 1000, [A]);
    const second = await mark(A, B);
    expect(second.id).toBe(first.id);
    expect(second.amount).toBe(700);
    expect(await recorded(first.id)).toHaveLength(3);
    await admin();
    const n = await db.query<{ n: number }>(`select count(*)::int as n from public.settlements where status = 'marked'`);
    expect(n.rows[0].n).toBe(1);
  });

  it("a non-debtor cannot mark: the creditor and an even pair are refused", async () => {
    await scenario();
    await expectCode(mark(B, A), "23514"); // B is owed 200, owes nothing net
    await expectCode(mark(A, C), "23514"); // even with C
    await expectCode(mark(A, A), "23514");
  });

  it("rejects strangers, outsiders, missing arguments and unauthenticated callers", async () => {
    await scenario();
    await expectCode(mark(Y, B), "42501"); // not a member
    await expectCode(mark(X, B), "42501"); // member of ANOTHER household
    await as(A);
    await expectCode(db.query(`select public.mark_settlement($1, $2)`, [hh, X]), "23503"); // counterparty is no member here
    await expectCode(db.query(`select public.mark_settlement(null, $1)`, [B]), "42501");
    await as(null);
    await expectCode(db.query(`select public.mark_settlement($1, $2)`, [hh, B]), "28000");
    await as(null, "anon");
    await expectCode(db.query(`select public.mark_settlement($1, $2)`, [hh, B]), "42501");
  });

  it("takes the pair lock before it reads (simulated lock order; PGlite is single-connection)", async () => {
    await admin();
    const def = await db.query<{ def: string }>(`select pg_get_functiondef('public.mark_settlement'::regproc) as def`);
    const body = def.rows[0].def;
    const lock = body.indexOf("private.lock_pair");
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(body.indexOf("private.pair_net"));
    expect(lock).toBeLessThan(body.indexOf("from public.settlements st"));
    const lockDef = await db.query<{ def: string }>(`select pg_get_functiondef('private.lock_pair'::regproc) as def`);
    expect(lockDef.rows[0].def).toContain("pg_advisory_xact_lock");
    expect(lockDef.rows[0].def).toContain("least(");
    expect(lockDef.rows[0].def).toContain("greatest(");

    // and the lock really is taken inside the transaction, on the same key for both directions
    await scenario();
    const locksAfter = async (from: string, to: string) => {
      await admin();
      await db.exec("begin");
      try {
        await as(from);
        await db.query(`select public.mark_settlement($1, $2)`, [hh, to]);
        await admin();
        const r = await db.query<{ classid: string; objid: string }>(
          `select classid::text, objid::text from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()`,
        );
        return r.rows;
      } finally {
        await admin();
        await db.exec("rollback");
      }
    };
    const forward = await locksAfter(A, B);
    expect(forward.length).toBeGreaterThan(0);
    // the reverse direction (B -> A, once B owes) must queue on the identical key
    await buy(A, 20000, [B]); // now B owes A 10000 more... B pays A: B owes A
    await buy(A, 20000, [B]);
    const reverse = await locksAfter(B, A);
    // pair lock (shared by both directions) + per-user rate-limit lock (differs per user)
    const key = (l: { classid: string; objid: string }) => `${l.classid}:${l.objid}`;
    expect(forward).toHaveLength(2);
    expect(reverse).toHaveLength(2);
    expect(forward.map(key).filter((k) => reverse.map(key).includes(k))).toHaveLength(1);
  });

  it("concurrent marks end up as one row (the second caller sees the first one's row after the lock)", async () => {
    await scenario();
    // Same lock key for two callers means they run one after another: the second one finds the first one's row.
    const first = await mark(A, B);
    const second = await mark(A, B);
    expect(second.id).toBe(first.id);
    await admin();
    expect((await db.query(`select 1 from public.settlements where status = 'marked'`)).rows).toHaveLength(1);
  });
});

describe("settlement_shares", () => {
  it("mark records exactly the open shares between the pair, both directions, and derives the amount from them", async () => {
    await scenario();
    await buy(C, 900, [A, B], "С Даней"); // shares toward C are not part of the pair
    const s = await mark(A, B);
    const rows = await recorded(s.id);
    expect(rows.map((r) => r.amount)).toEqual([2000, 1800]);
    expect(rows.reduce((sum, r) => sum + (r.debtor_id === A ? r.amount : -r.amount), 0)).toBe(s.amount);
    expect(s.amount).toBe(200);
  });

  it("asking again refreshes the record and the amount; a shrunk debt that is not owed any more is refused", async () => {
    await scenario();
    const s = await mark(A, B);
    await buy(A, 20000, [B], "Большая"); // B now owes A: A owes nothing net
    await expectCode(mark(A, B), "23514");
    expect((await recorded(s.id)).map((r) => r.amount).sort((a, b) => b - a)).toEqual([2000, 1800]); // untouched on refusal
  });

  it("clients can read the recorded set of their household only, and cannot write it", async () => {
    await scenario();
    const s = await mark(A, B);
    await as(C);
    expect((await db.query(`select 1 from public.settlement_shares where settlement_id = $1`, [s.id])).rows).toHaveLength(2);
    await as(X);
    expect((await db.query(`select 1 from public.settlement_shares`)).rows).toHaveLength(0);
    await as(A);
    await expectCode(db.query(`delete from public.settlement_shares`), "42501");
    await expectCode(db.query(`update public.settlement_shares set amount = 1`), "42501");
    await expectCode(
      db.query(`insert into public.settlement_shares values ($1, $2, $3, $4, 1)`, [s.id, hh, "00000000-0000-0000-0000-0000000000aa", A]),
      "42501",
    );
    await as(A);
    await expectCode(db.query(`select * from private.settlement_ops`), "42501");
  });
});

describe("rate limit", () => {
  it("allows 20 mark/cancel calls per user per hour, then refuses with rate_limited", async () => {
    await scenario();
    for (let i = 0; i < 20; i++) await mark(A, B);
    await expect(mark(A, B)).rejects.toMatchObject({ code: "P0001", message: expect.stringContaining("rate_limited") });
    await admin();
    await db.exec(`update private.settlement_ops set at = now() - interval '2 hours'`);
    expect((await mark(A, B)).status).toBe("marked"); // old attempts expire
  });
});

describe("confirm_settlement", () => {
  it("only the creditor can confirm; the debtor, a housemate, outsiders and anon cannot", async () => {
    await scenario();
    const s = await mark(A, B);
    await expectCode(confirm(A, s.id), "42501"); // the debtor
    await expectCode(confirm(C, s.id), "P0002"); // housemate who is no party: the same answer as a missing id
    await expectCode(confirm(X, s.id), "P0002"); // other household
    await expectCode(confirm(Y, s.id), "P0002");
    await as(null);
    await expectCode(db.query(`select public.confirm_settlement($1)`, [s.id]), "28000");
    await as(null, "anon");
    await expectCode(db.query(`select public.confirm_settlement($1)`, [s.id]), "42501");
    await as(B);
    await expectCode(db.query(`select public.confirm_settlement('00000000-0000-0000-0000-000000000099')`), "P0002");
    await admin();
    const row = await db.query<{ status: string }>(`select status from public.settlements where id = $1`, [s.id]);
    expect(row.rows[0].status).toBe("marked");
  });

  it("closes every open share between the pair in both directions: the pair is at 0", async () => {
    await scenario();
    const withC = await buy(C, 900, [A, B]); // a share toward C must stay open
    const s = await mark(A, B);
    const done = await confirm(B, s.id);
    expect(done).toMatchObject({ status: "confirmed" });
    expect(done.confirmed_at).not.toBeNull();
    expect(await net(A, B)).toBe(0);
    await admin();
    const closed = await db.query<{ n: number }>(
      `select count(*)::int as n from public.shares where settlement_id = $1 and settled_at is not null`,
      [s.id],
    );
    expect(closed.rows[0].n).toBe(2); // one share per direction
    const open = await db.query<{ purchase_id: string }>(`select purchase_id from public.shares where settled_at is null`);
    expect(open.rows.every((r) => r.purchase_id === withC)).toBe(true);
    expect(await net(A, C)).toBe(300);
  });

  it("a double confirm is a no-op that returns the same row", async () => {
    await scenario();
    const s = await mark(A, B);
    const first = await confirm(B, s.id);
    await buy(A, 2000, [B]); // new debt after the first confirm must not be swallowed by a second one
    const second = await confirm(B, s.id);
    expect(second).toEqual(first);
    expect(await net(A, B)).toBe(-1000);
    await admin();
    const n = await db.query<{ n: number }>(`select count(*)::int as n from public.shares where settlement_id = $1`, [s.id]);
    expect(n.rows[0].n).toBe(2);
  });

  it("a purchase committed after the mark stays open (it was never part of the payment)", async () => {
    await scenario();
    const s = await mark(A, B);
    await buy(B, 600, [A], "После отметки");
    const done = await confirm(B, s.id);
    expect(done.status).toBe("confirmed");
    expect(await net(A, B)).toBe(300); // 600 split over B and A: A still owes 300
    await admin();
    const open = await db.query<{ amount: number }>(`select amount from public.shares where settled_at is null`);
    expect(open.rows).toEqual([{ amount: 300 }]);
  });

  it("a purchase that was pending at the mark and became shared later stays open", async () => {
    await scenario();
    const pending = await buy(B, 600, [A], "Ожидает");
    await admin();
    await db.query(`update public.purchases set status = 'pending' where id = $1`, [pending]);
    const s = await mark(A, B);
    expect(s.amount).toBe(200); // the pending one is not part of the net
    await admin();
    await db.query(`update public.purchases set status = 'shared' where id = $1`, [pending]);
    await confirm(B, s.id);
    expect(await net(A, B)).toBe(300);
    await admin();
    const open = await db.query<{ purchase_id: string }>(`select purchase_id from public.shares where settled_at is null`);
    expect(open.rows).toEqual([{ purchase_id: pending }]);
  });

  it("a recorded purchase deleted after the mark makes the confirm stale: nothing is closed", async () => {
    await scenario();
    const extra = await buy(B, 800, [A], "Удалят");
    const s = await mark(A, B);
    expect(s.amount).toBe(600); // 2000 + 400 - 1800
    await as(B);
    await db.query(`delete from public.purchases where id = $1`, [extra]); // the payer deletes it (allowed by RLS)
    await as(B);
    await expect(db.query(`select public.confirm_settlement($1)`, [s.id])).rejects.toMatchObject({
      code: "23514",
      message: expect.stringContaining("stale_settlement"),
    });
    await admin();
    expect((await db.query(`select 1 from public.shares where settlement_id is not null`)).rows).toHaveLength(0);
    expect((await db.query<{ status: string }>(`select status from public.settlements where id = $1`, [s.id])).rows[0].status).toBe("marked");
    // the client cancels the stale row and the debtor marks again for the right amount
    await cancel(B, s.id);
    expect((await mark(A, B)).amount).toBe(200);
  });

  it("a recorded share already closed by the opposite settlement, or a purchase no longer shared, is stale", async () => {
    await scenario();
    const s1 = await mark(A, B); // A -> B 200, records Интернет (A 2000) and Картошка (B 1800)
    await buy(A, 20000, [B], "Большая"); // now B owes A 10000 on top: the net flips
    const s2 = await mark(B, A); // B -> A 9800 records all three shares
    expect(s2.amount).toBe(9800);
    await confirm(A, s2.id); // A confirms: all three shares are closed
    await expect(confirm(B, s1.id)).rejects.toMatchObject({ code: "23514", message: expect.stringContaining("stale_settlement") });

    await scenario();
    const s3 = await mark(A, B);
    await admin();
    await db.query(`update public.purchases set status = 'personal' where description = 'Интернет'`);
    await expect(confirm(B, s3.id)).rejects.toMatchObject({ code: "23514", message: expect.stringContaining("stale_settlement") });
  });

  it("cannot confirm a cancelled settlement", async () => {
    await scenario();
    const s = await mark(A, B);
    await cancel(A, s.id);
    await expectCode(confirm(B, s.id), "23514");
    expect(await net(A, B)).toBe(200);
  });

  it("expected amount: a mismatch is stale and closes nothing; a match confirms", async () => {
    await scenario();
    const s = await mark(A, B);
    await as(B);
    await expect(db.query(`select public.confirm_settlement($1, $2)`, [s.id, s.amount + 1])).rejects.toMatchObject({
      code: "23514",
      message: expect.stringContaining("stale_settlement"),
    });
    await admin();
    expect((await db.query(`select 1 from public.shares where settlement_id is not null`)).rows).toHaveLength(0);
    await as(B);
    const ok = await db.query<Settlement>(`select * from public.confirm_settlement($1, $2)`, [s.id, s.amount]);
    expect(ok.rows[0].status).toBe("confirmed");
  });

  it("checks the closed row count against the recorded set", async () => {
    const def = await db.query<{ def: string }>(`select pg_get_functiondef('public.confirm_settlement'::regproc) as def`);
    const text = def.rows[0].def.toLowerCase();
    expect(text).toContain("row_count");
    expect(text.indexOf("for update of s")).toBeLessThan(text.indexOf("row_count"));
  });

  it("takes the pair lock before any FOR UPDATE in mark, confirm and cancel (pair -> user -> row)", async () => {
    for (const fn of ["mark_settlement", "confirm_settlement", "cancel_settlement"]) {
      const def = await db.query<{ def: string }>(`select pg_get_functiondef('public.${fn}'::regproc) as def`);
      const text = def.rows[0].def.toLowerCase();
      expect(text.indexOf("private.lock_pair"), fn).toBeGreaterThan(-1);
      expect(text.indexOf("for update"), fn).toBeGreaterThan(text.indexOf("private.lock_pair"));
    }
    const rate = await db.query<{ def: string }>(`select pg_get_functiondef('private.check_settlement_rate'::regproc) as def`);
    expect(rate.rows[0].def).toContain("pg_advisory_xact_lock");
  });

  it("locks the settlement row and the pair before writing", async () => {
    const def = await db.query<{ def: string }>(`select pg_get_functiondef('public.confirm_settlement'::regproc) as def`);
    expect(def.rows[0].def).toContain("for update");
    expect(def.rows[0].def.indexOf("private.lock_pair")).toBeLessThan(def.rows[0].def.indexOf("update public.shares"));
  });
});

describe("cancel_settlement", () => {
  it("the debtor can cancel; the shares stay open and a new mark is possible", async () => {
    await scenario();
    const s = await mark(A, B);
    expect((await cancel(A, s.id)).status).toBe("cancelled");
    expect(await net(A, B)).toBe(200);
    const again = await mark(A, B);
    expect(again.id).not.toBe(s.id);
    expect(again.status).toBe("marked");
  });

  it("the creditor can cancel too", async () => {
    await scenario();
    const s = await mark(A, B);
    expect((await cancel(B, s.id)).status).toBe("cancelled");
  });

  it("a housemate, an outsider and anon cannot; cancelling twice is a no-op; a confirmed one cannot be cancelled", async () => {
    await scenario();
    const s = await mark(A, B);
    await expectCode(cancel(C, s.id), "P0002");
    await expectCode(cancel(X, s.id), "P0002");
    await expectCode(cancel(Y, s.id), "P0002");
    await as(null, "anon");
    await expectCode(db.query(`select public.cancel_settlement($1)`, [s.id]), "42501");
    await cancel(A, s.id);
    expect((await cancel(A, s.id)).status).toBe("cancelled");
    await as(A);
    await expectCode(db.query(`select public.cancel_settlement('00000000-0000-0000-0000-000000000099')`), "P0002");

    const s2 = await mark(A, B);
    await confirm(B, s2.id);
    await expectCode(cancel(A, s2.id), "23514");
  });
});

describe("access", () => {
  it("clients cannot write settlements or shares directly; members of other households cannot read them", async () => {
    await scenario();
    const s = await mark(A, B);
    await as(A);
    await expectCode(db.query(`update public.settlements set status = 'confirmed' where id = $1`, [s.id]), "42501");
    await expectCode(db.query(`delete from public.settlements where id = $1`, [s.id]), "42501");
    await expectCode(
      db.query(`insert into public.settlements (household_id, from_id, to_id, amount) values ($1, $2, $3, 5)`, [hh, A, B]),
      "42501",
    );
    await expectCode(db.query(`update public.shares set settled_at = now()`), "42501");
    // members see it, outsiders see nothing
    expect((await db.query(`select id from public.settlements where id = $1`, [s.id])).rows).toHaveLength(1);
    await as(X);
    expect((await db.query(`select id from public.settlements`)).rows).toHaveLength(0);
    await as(Y);
    expect((await db.query(`select id from public.settlements`)).rows).toHaveLength(0);
    expect(otherHh).not.toBe(hh);
  });

  it("only authenticated can execute the RPCs; the helpers are private", async () => {
    await admin();
    const r = await db.query<{ proname: string; anon: boolean; auth: boolean; pub: boolean }>(
      `select p.proname,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as auth,
              has_function_privilege('public', p.oid, 'execute') as pub
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where (n.nspname = 'public' and p.proname in ('mark_settlement', 'confirm_settlement', 'cancel_settlement'))
          or (n.nspname = 'private' and p.proname in ('pair_net', 'lock_pair', 'open_pair_shares', 'record_settlement_shares', 'check_settlement_rate'))
       order by p.proname`,
    );
    expect(r.rows.map((x) => x.proname)).toEqual(
      expect.arrayContaining(["cancel_settlement", "confirm_settlement", "lock_pair", "mark_settlement", "pair_net"]),
    );
    for (const row of r.rows) {
      expect(row.anon).toBe(false);
      expect(row.pub).toBe(false);
      expect(row.auth).toBe(["mark_settlement", "confirm_settlement", "cancel_settlement"].includes(row.proname));
    }
  });

  it("anon can execute NO function in public or private, and has no privilege on the new tables", async () => {
    await admin();
    const fns = await db.query<{ name: string; anon: boolean }>(
      `select n.nspname || '.' || p.proname as name, has_function_privilege('anon', p.oid, 'execute') as anon
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private')`,
    );
    expect(fns.rows.length).toBeGreaterThan(8);
    expect(fns.rows.filter((f) => f.anon)).toEqual([]);
    const tables = await db.query<{ anon: boolean; auth: boolean }>(
      `select has_table_privilege('anon', 'public.settlement_shares', 'select') as anon,
              has_table_privilege('authenticated', 'public.settlement_shares', 'insert') as auth`,
    );
    expect(tables.rows[0]).toEqual({ anon: false, auth: false });
  });

  it("the helper bodies are security definer with an empty search_path", async () => {
    await admin();
    const defs = await db.query<{ cfg: string[] | null; secdef: boolean }>(
      `select p.proconfig as cfg, p.prosecdef as secdef from pg_proc p
       where p.proname in ('mark_settlement', 'confirm_settlement', 'cancel_settlement')`,
    );
    for (const row of defs.rows) {
      expect(row.secdef).toBe(true);
      expect(row.cfg).toContain('search_path=""');
    }
  });
});
