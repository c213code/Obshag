import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const A = "00000000-0000-0000-0000-00000000000a"; // admin (creator)
const B = "00000000-0000-0000-0000-00000000000b"; // member, @aidos_k
const C = "00000000-0000-0000-0000-00000000000c"; // member
const SECRET = "slice17-secret";

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

const TG_B = 555001;
const TG_C = 555002;

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
  const h = await db.query<{ id: string; invite_code: string }>(`select * from public.create_household('Квартира 42')`);
  hh = h.rows[0].id;
  // B created it: A and C join
  for (const u of [A, C]) {
    await as(u);
    await db.query(`select public.join_household($1)`, [h.rows[0].invite_code]);
  }
  await admin();
  await db.exec(`update public.profiles set telegram_user_id = ${TG_B} where id = '${B}'; update public.profiles set telegram_user_id = ${TG_C} where id = '${C}';`);
  await db.exec(`insert into private.server_secrets values ('cron', encode(extensions.digest('${SECRET}', 'sha256'), 'hex'))`);
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await admin();
  await db.exec(`truncate public.paid_prompts, public.settlement_shares, public.settlements, public.purchases cascade; delete from private.settlement_ops;`);
});

const open = async (user: string, to: string) => {
  await as(user);
  return (await db.query<{ r: { id: string; amount: number; status: string; asked_at: string | null } }>(`select to_jsonb(public.open_paid_prompt($1, $2)) as r`, [hh, to])).rows[0].r;
};
const mine = async (user: string) => {
  await as(user);
  return (await db.query<{ id: string; amount: number }>(`select * from public.my_paid_prompts($1)`, [hh])).rows;
};
const answer = async (user: string, id: string, yes: boolean) => {
  await as(user);
  return (await db.query<{ r: { result: string; to_name: string } }>(`select public.answer_paid_prompt($1, $2) as r`, [id, yes])).rows[0].r;
};
const tgAnswer = async (tg: number, id: string, yes: boolean, secret = SECRET) => {
  await as(null, "anon");
  return (await db.query<{ r: { result: string; to_name: string } }>(`select public.tg_answer_paid($1, $2, $3, $4) as r`, [secret, tg, id, yes])).rows[0].r;
};
const notice = async (user: string, id: string, secret = SECRET) => {
  await as(user);
  return (await db.query<{ r: Record<string, unknown> }>(`select public.paid_prompt_notice($1, $2) as r`, [secret, id])).rows[0].r;
};
const statusOf = async (id: string) => {
  await admin();
  return (await db.query<{ status: string }>(`select status from public.paid_prompts where id = $1`, [id])).rows[0].status;
};
const setAge = async (id: string, interval: string) => {
  await admin();
  await db.query(`update public.paid_prompts set opened_at = now() - $2::interval where id = $1`, [id, interval]);
};
const marked = async () => {
  await admin();
  return (await db.query<{ from_id: string; to_id: string; amount: number }>(`select from_id, to_id, amount from public.settlements where status = 'marked'`)).rows;
};

describe("open_paid_prompt", () => {
  it("records a pending prompt with the current net", async () => {
    await buy(A, 600, [A, B, C]); // B and C owe A 200 each
    const p = await open(B, A);
    expect(p).toMatchObject({ amount: 200, status: "pending", asked_at: null });
  });
  it("re-open refreshes the same pending row: opened_at, amount and asked_at", async () => {
    await buy(A, 600, [A, B, C]);
    const p = await open(B, A);
    await setAge(p.id, "100 seconds");
    await admin();
    await db.query(`update public.paid_prompts set asked_at = now() where id = $1`, [p.id]);
    await buy(A, 300, [A, B]); // B owes 150 more
    const again = await open(B, A);
    expect(again.id).toBe(p.id);
    expect(again.amount).toBe(350);
    expect(again.asked_at).toBeNull();
    await admin();
    expect((await db.query(`select 1 from public.paid_prompts`)).rows).toHaveLength(1);
  });
  it("keeps one pending per pair but separate rows per creditor", async () => {
    await buy(A, 600, [A, B, C]);
    await buy(C, 600, [A, B, C]); // B owes C 200 too
    await open(B, A);
    await open(B, C);
    expect(await mine(B)).toHaveLength(2);
  });
  it("is too_small below 100 and creates nothing", async () => {
    await buy(A, 150, [A, B]); // 75
    await as(B);
    await expect(db.query(`select public.open_paid_prompt($1, $2)`, [hh, A])).rejects.toMatchObject({ code: "P0001", message: "too_small" });
    await admin();
    expect((await db.query(`select 1 from public.paid_prompts`)).rows).toHaveLength(0);
  });
  it("is exactly 100 allowed", async () => {
    await buy(A, 200, [A, B]);
    expect((await open(B, A)).amount).toBe(100);
  });
  it("nothing owed is 23514, not a member 42501, yourself 23514, anonymous 28000", async () => {
    await expectCode(open(B, A), "23514");
    await expectCode(open(B, B), "23514");
    await as(null);
    await expectCode(db.query(`select public.open_paid_prompt($1, $2)`, [hh, A]), "28000");
    const outsider = "00000000-0000-0000-0000-0000000000dd";
    await admin();
    await db.query(`insert into auth.users values ($1)`, [outsider]);
    await as(outsider);
    await db.query(`select public.upsert_profile('Чужой', '+77001234567')`);
    await expectCode(db.query(`select public.open_paid_prompt($1, $2)`, [hh, A]), "42501");
  });
});

describe("visibility and expiry", () => {
  it("only the from_user sees the row, through RLS and through my_paid_prompts", async () => {
    await buy(A, 600, [A, B, C]);
    const p = await open(B, A);
    await as(A);
    expect((await db.query(`select * from public.paid_prompts`)).rows).toHaveLength(0);
    expect(await mine(A)).toHaveLength(0);
    await as(B);
    expect((await db.query(`select * from public.paid_prompts`)).rows).toHaveLength(1);
    await expectCode(db.query(`insert into public.paid_prompts (household_id, from_user, to_user, amount) values ($1, $2, $3, 100)`, [hh, B, A]), "42501");
    await expectCode(db.query(`update public.paid_prompts set status = 'yes' where id = $1`, [p.id]), "42501");
  });
  it("a pending prompt older than 30 minutes is expired on read and then a new open starts a fresh row", async () => {
    await buy(A, 600, [A, B, C]);
    const p = await open(B, A);
    await setAge(p.id, "31 minutes");
    expect(await mine(B)).toHaveLength(0);
    expect(await statusOf(p.id)).toBe("expired");
    const fresh = await open(B, A);
    expect(fresh.id).not.toBe(p.id);
  });
  it("a 29 minute old prompt is still listed", async () => {
    await buy(A, 600, [A, B, C]);
    const p = await open(B, A);
    await setAge(p.id, "29 minutes");
    expect(await mine(B)).toHaveLength(1);
  });
});

describe("answer_paid_prompt", () => {
  it("yes marks the settlement (creditor still has to confirm) and sets status yes", async () => {
    await buy(A, 600, [A, B, C]);
    const p = await open(B, A);
    expect(await answer(B, p.id, true)).toMatchObject({ result: "marked", to_name: "Ерасыл" });
    expect(await statusOf(p.id)).toBe("yes");
    expect(await marked()).toEqual([{ from_id: B, to_id: A, amount: 200 }]);
  });
  it("yes after the PWA already marked does not create a second settlement", async () => {
    await buy(A, 600, [A, B, C]);
    const p = await open(B, A);
    await as(B);
    await db.query(`select public.mark_settlement($1, $2)`, [hh, A]);
    await answer(B, p.id, true);
    expect(await marked()).toHaveLength(1);
  });
  it("no sets status no and marks nothing; a second answer is already", async () => {
    await buy(A, 600, [A, B, C]);
    const p = await open(B, A);
    expect(await answer(B, p.id, false)).toMatchObject({ result: "no" });
    expect(await statusOf(p.id)).toBe("no");
    expect(await marked()).toHaveLength(0);
    expect(await answer(B, p.id, true)).toMatchObject({ result: "already" });
    expect(await marked()).toHaveLength(0);
  });
  it("an expired prompt answers expired and marks nothing", async () => {
    await buy(A, 600, [A, B, C]);
    const p = await open(B, A);
    await setAge(p.id, "40 minutes");
    expect(await answer(B, p.id, true)).toMatchObject({ result: "expired" });
    expect(await marked()).toHaveLength(0);
  });
  it("someone else's prompt is 42501", async () => {
    await buy(A, 600, [A, B, C]);
    const p = await open(B, A);
    await expectCode(answer(C, p.id, true), "42501");
    await expectCode(answer(A, p.id, true), "42501");
  });
  it("the net fell below 100 meanwhile: too_small, nothing marked", async () => {
    await buy(A, 600, [A, B, C]);
    const p = await open(B, A);
    await buy(B, 250, [A, B]); // A owes B 125 -> B owes A 75
    expect(await answer(B, p.id, true)).toMatchObject({ result: "too_small" });
    expect(await marked()).toHaveLength(0);
  });
  it("nothing owed any more: stale", async () => {
    await buy(A, 600, [A, B, C]);
    const p = await open(B, A);
    await buy(B, 600, [A, B, C]); // A owes B 200: even
    expect(await answer(B, p.id, true)).toMatchObject({ result: "stale" });
  });
});

describe("paid_prompt_notice", () => {
  it("is not due before 120 seconds", async () => {
    await buy(A, 600, [A, B, C]);
    const p = await open(B, A);
    expect(await notice(B, p.id)).toEqual({ ask: false });
  });
  it("after 120 seconds returns who to ask once and sets asked_at", async () => {
    await buy(A, 600, [A, B, C]);
    const p = await open(B, A);
    await setAge(p.id, "150 seconds");
    const n = await notice(B, p.id);
    expect(n).toMatchObject({ ask: true, prompt_id: p.id, to_user: A, to_name: "Ерасыл", amount: 200, telegram_user_id: TG_B });
    expect(n.subscriptions).toEqual([]);
    expect(await notice(B, p.id)).toEqual({ ask: false });
  });
  it("a re-open resets the clock and asked_at", async () => {
    await buy(A, 600, [A, B, C]);
    const p = await open(B, A);
    await setAge(p.id, "150 seconds");
    await open(B, A);
    expect(await notice(B, p.id)).toEqual({ ask: false });
  });
  it("an answered prompt is never asked", async () => {
    await buy(A, 600, [A, B, C]);
    const p = await open(B, A);
    await answer(B, p.id, false);
    await setAge(p.id, "150 seconds");
    expect(await notice(B, p.id)).toEqual({ ask: false });
  });
  it("wrong secret 28000, somebody else's prompt 42501", async () => {
    await buy(A, 600, [A, B, C]);
    const p = await open(B, A);
    await setAge(p.id, "150 seconds");
    await expectCode(notice(B, p.id, "nope"), "28000");
    await expectCode(notice(C, p.id), "42501");
  });
});

describe("tg_answer_paid", () => {
  it("the linked from_user says yes: the settlement is marked", async () => {
    await buy(A, 600, [A, B, C]);
    const p = await open(B, A);
    expect(await tgAnswer(TG_B, p.id, true)).toMatchObject({ result: "marked", to_name: "Ерасыл" });
    expect(await statusOf(p.id)).toBe("yes");
    expect(await marked()).toEqual([{ from_id: B, to_id: A, amount: 200 }]);
  });
  it("no sets no", async () => {
    await buy(A, 600, [A, B, C]);
    const p = await open(B, A);
    expect(await tgAnswer(TG_B, p.id, false)).toMatchObject({ result: "no" });
    expect(await statusOf(p.id)).toBe("no");
  });
  it("another linked user is 42501 and nothing changes", async () => {
    await buy(A, 600, [A, B, C]);
    const p = await open(B, A);
    await expectCode(tgAnswer(TG_C, p.id, true), "42501");
    await expectCode(tgAnswer(999999, p.id, true), "42501");
    expect(await statusOf(p.id)).toBe("pending");
  });
  it("a wrong secret is 28000", async () => {
    await buy(A, 600, [A, B, C]);
    const p = await open(B, A);
    await expectCode(tgAnswer(TG_B, p.id, true, "wrong"), "28000");
  });
  it("min 100 is enforced at answer time", async () => {
    await buy(A, 600, [A, B, C]);
    const p = await open(B, A);
    await buy(B, 250, [A, B]);
    expect(await tgAnswer(TG_B, p.id, true)).toMatchObject({ result: "too_small" });
    expect(await marked()).toHaveLength(0);
  });
  it("an expired prompt is expired", async () => {
    await buy(A, 600, [A, B, C]);
    const p = await open(B, A);
    await setAge(p.id, "45 minutes");
    expect(await tgAnswer(TG_B, p.id, true)).toMatchObject({ result: "expired" });
  });
});

describe("surface", () => {
  it("the anon surface is exactly ten functions and includes tg_answer_paid only from this slice", async () => {
    await admin();
    const r = await db.query<{ n: string }>(
      `select p.proname n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname in ('public', 'private') and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')
         and p.proname not in ('uid')
       order by 1`,
    );
    expect(r.rows).toHaveLength(10);
    expect(r.rows.map((x) => x.n)).toContain("tg_answer_paid");
    for (const hidden of ["open_paid_prompt", "answer_paid_prompt", "paid_prompt_notice", "my_paid_prompts", "paid_prompt_answer", "mark_settlement_for"]) {
      expect(r.rows.map((x) => x.n)).not.toContain(hidden);
    }
  });
  it("every new function is security definer with an empty search_path", async () => {
    await admin();
    const r = await db.query<{ definer: boolean; cfg: string[] | null }>(
      `select p.prosecdef definer, p.proconfig cfg from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname in ('public', 'private') and p.proname in ('open_paid_prompt','my_paid_prompts','answer_paid_prompt','paid_prompt_notice','tg_answer_paid','paid_prompt_answer','mark_settlement_for','paid_prompt_expire')`,
    );
    expect(r.rows).toHaveLength(8);
    for (const f of r.rows) {
      expect(f.definer).toBe(true);
      expect(f.cfg).toContain(`search_path=""`);
    }
  });
});
