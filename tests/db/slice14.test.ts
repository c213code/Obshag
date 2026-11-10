import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const A = "00000000-0000-0000-0000-00000000000a"; // admin (creator), joined first
const B = "00000000-0000-0000-0000-00000000000b";
const C = "00000000-0000-0000-0000-00000000000c";
const E = "00000000-0000-0000-0000-00000000000e"; // outsider
const SECRET = "slice14-secret";

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
];

let db: PGlite;
let hh: string;
let duty: string;

async function as(user: string | null, role: "authenticated" | "anon" = "authenticated") {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ""}', false); set role ${role};`);
}
async function admin() {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
}
async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code });
}
async function expectMsg(promise: Promise<unknown>, message: string) {
  await expect(promise).rejects.toMatchObject({ code: "P0001", message });
}
/** An Asia/Almaty date n days from today, 'YYYY-MM-DD' (pure JS: it must not touch the session role). */
async function day(n: number): Promise<string> {
  const d = new Date(Date.now() + 5 * 3600_000 + n * 86400_000);
  return d.toISOString().slice(0, 10);
}
async function almatyHour(): Promise<number> {
  return new Date(Date.now() + 5 * 3600_000).getUTCHours();
}
type Row = { d: string; u: string; s: string; done: boolean; r: string | null; k: string | null };
async function schedule(user: string, from: number, to: number): Promise<Row[]> {
  const f = await day(from);
  const t = await day(to);
  await as(user);
  return (
    await db.query<Row>(
      `select day::text d, user_id u, source s, done, request_id r, skipped_user k from public.duty_schedule($1, $2, $3)`,
      [duty, f, t],
    )
  ).rows;
}
async function whoIs(n: number): Promise<string> {
  return (await schedule(A, n, n))[0].u;
}
async function newDuty(startOffset: number, order: string[] | null = [A, B, C]) {
  await admin();
  await db.exec(`truncate public.duties cascade`);
  await as(A);
  const r = await db.query<{ id: string }>(`select id from public.create_duty($1, 'cooking', 'Готовка', $2, $3)`, [
    hh,
    await day(startOffset),
    order,
  ]);
  duty = r.rows[0].id;
}
type Req = { id: string; status: string; from_user: string; to_user: string; expires_at: string };
async function request(user: string, mine: number, other: number, reason: string | null = null): Promise<Req> {
  const m = await day(mine);
  const o = await day(other);
  await as(user);
  return (await db.query<Req>(`select * from public.request_swap($1, $2, $3, $4)`, [duty, m, o, reason])).rows[0];
}
const respond = async (user: string, id: string, accept: boolean) => {
  await as(user);
  return (await db.query<Req>(`select * from public.respond_swap($1, $2)`, [id, accept])).rows[0];
};
const status = async (id: string) => {
  await admin();
  return (await db.query<{ status: string }>(`select status from public.duty_swap_requests where id = $1`, [id])).rows[0].status;
};

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUB);
  for (const file of MIGRATIONS) await db.exec(readFileSync(join(process.cwd(), "supabase/migrations", file), "utf8"));
  await db.exec(`insert into auth.users values ('${A}'),('${B}'),('${C}'),('${E}');`);
  for (const [id, name] of [[A, "Ерасыл"], [B, "Айдос"], [C, "Даня"], [E, "Чужой"]]) {
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
  // a stable join order: A, B, C
  await db.exec(`update public.members set joined_at = now() - interval '3 days' where user_id = '${A}';
    update public.members set joined_at = now() - interval '2 days' where user_id = '${B}';
    update public.members set joined_at = now() - interval '1 days' where user_id = '${C}';`);
  await db.exec(`insert into private.server_secrets values ('cron', encode(extensions.digest('${SECRET}', 'sha256'), 'hex'))`);
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await admin();
  await db.exec(`truncate public.duties cascade; truncate private.duty_morning_log;
    update public.members set active = true, away_until = null;
    update public.profiles set telegram_user_id = null, telegram_username = null;`);
  await newDuty(0);
});

describe("create / order (admins only)", () => {
  it("defaults to the join order and starts today", async () => {
    await newDuty(0, null);
    await as(B);
    const members = await db.query<{ user_id: string; position: number }>(`select user_id, position from public.duty_members where duty_id = $1 order by position`, [duty]);
    expect(members.rows.map((r) => r.user_id)).toEqual([A, B, C]);
    expect((await schedule(B, 0, 0))[0].u).toBe(A);
  });
  it("members and outsiders cannot create or reorder", async () => {
    await as(B);
    await expectCode(db.query(`select * from public.create_duty($1, 'trash', 'Мусор', null, null)`, [hh]), "42501");
    await expectCode(db.query(`select * from public.set_duty_order($1, $2, null)`, [duty, [C, B, A]]), "42501");
    await as(E);
    await expectCode(db.query(`select * from public.create_duty($1, 'trash', 'Мусор', null, null)`, [hh]), "42501");
    await as(null, "anon");
    await expectCode(db.query(`select * from public.create_duty($1, 'trash', 'Мусор', null, null)`, [hh]), "42501");
  });
  it("rejects a bad kind, a blank title, a stranger or a duplicate in the order, and a second cooking duty", async () => {
    await as(A);
    await expectCode(db.query(`select * from public.create_duty($1, 'nope', 'X', null, null)`, [hh]), "23514");
    await expectCode(db.query(`select * from public.create_duty($1, 'trash', '  ', null, null)`, [hh]), "23514");
    await expectCode(db.query(`select * from public.create_duty($1, 'trash', 'Мусор', null, $2)`, [hh, [A, E]]), "23514");
    await expectCode(db.query(`select * from public.create_duty($1, 'trash', 'Мусор', null, $2)`, [hh, [A, A]]), "23514");
    await expectCode(db.query(`select * from public.create_duty($1, 'cooking', 'Готовка 2', null, null)`, [hh]), "23505");
    const ok = await db.query(`select * from public.create_duty($1, 'trash', 'Мусор', null, null)`, [hh]);
    expect(ok.rows).toHaveLength(1);
  });
  it("an admin reorders and moves the start; the rotation follows", async () => {
    await as(A);
    await db.query(`select * from public.set_duty_order($1, $2, null)`, [duty, [C, A, B]]);
    expect(await whoIs(0)).toBe(C);
    expect(await whoIs(1)).toBe(A);
    await db.query(`select * from public.set_duty_order($1, $2, $3)`, [duty, [C, A, B], await day(-1)]);
    expect(await whoIs(0)).toBe(A);
  });
  it("only members read the schedule", async () => {
    await as(E);
    await expectCode(db.query(`select * from public.duty_schedule($1, $2, $3)`, [duty, await day(0), await day(3)]), "42501");
    await as(null, "anon");
    await expectCode(db.query(`select * from public.duty_schedule($1, $2, $3)`, [duty, await day(0), await day(3)]), "42501");
  });
});

describe("assignee math", () => {
  it("rotates [A, B, C] by (day - start) mod 3 across a whole month, past days too", async () => {
    await newDuty(-10);
    const rows = await schedule(C, -10, 30);
    expect(rows).toHaveLength(41);
    rows.forEach((r, i) => expect(r.u).toBe([A, B, C][i % 3]));
    expect(rows.every((r) => r.s === "rotation")).toBe(true);
  });
  it("has no assignee before the start date", async () => {
    await newDuty(5);
    expect(await schedule(A, 0, 6)).toHaveLength(2); // days 5 and 6 only
  });
  it("skips a member who is away: the next available one takes the day, the plan marks the skip", async () => {
    await admin();
    await db.exec(`update public.members set away_until = (private.almaty_today() + 2) where user_id = '${C}'`);
    const rows = await schedule(A, 0, 3);
    expect(rows.map((r) => r.u)).toEqual([A, B, A, A]); // day 2 was C's (away): A is next in order; day 3 is A's own
    expect(rows[2]).toMatchObject({ s: "skip", k: C });
    await admin();
    await db.exec(`update public.members set away_until = (private.almaty_today() + 1) where user_id = '${C}'`);
    expect((await schedule(A, 2, 2))[0]).toMatchObject({ u: C, s: "rotation" }); // back the day after
  });
  it("skips an inactive member from today on, and a day with everybody away falls back to the rotation", async () => {
    await admin();
    await db.exec(`update public.members set active = false where user_id = '${B}'`);
    expect((await schedule(A, 1, 1))[0]).toMatchObject({ u: C, s: "skip" });
    await admin();
    await db.exec(`update public.members set active = true, away_until = private.almaty_today() + 10`);
    expect((await schedule(A, 1, 1))[0]).toMatchObject({ u: B, s: "rotation" });
  });
  it("an override wins over rotation and away", async () => {
    await as(A);
    await db.query(`select public.admin_assign_day($1, $2, $3)`, [duty, await day(1), C]);
    expect((await schedule(A, 1, 1))[0]).toMatchObject({ u: C, s: "admin" });
  });
});

describe("admin_assign_day", () => {
  it("is admin only, not for the past, and clears with a null user", async () => {
    await as(B);
    await expectCode(db.query(`select public.admin_assign_day($1, $2, $3)`, [duty, await day(1), C]), "42501");
    await as(A);
    await expectMsg(db.query(`select public.admin_assign_day($1, $2, $3)`, [duty, await day(-1), C]), "past_day");
    await expectCode(db.query(`select public.admin_assign_day($1, $2, $3)`, [duty, await day(1), E]), "23514");
    await db.query(`select public.admin_assign_day($1, $2, $3)`, [duty, await day(1), C]);
    expect(await whoIs(1)).toBe(C);
    await db.query(`select public.admin_assign_day($1, $2, null)`, [duty, await day(1)]);
    expect(await whoIs(1)).toBe(B);
  });
  it("cancels a pending swap that touches the day", async () => {
    const req = await request(A, 3, 1);
    await as(A);
    await db.query(`select public.admin_assign_day($1, $2, $3)`, [duty, await day(1), C]);
    expect(await status(req.id)).toBe("cancelled");
  });
});

describe("swap requests", () => {
  it("happy path: pending shows in the schedule, accept writes both overrides, expiry = earlier day 10:00 Almaty", async () => {
    const req = await request(A, 3, 1, "  пары до вечера  ");
    expect(req).toMatchObject({ status: "pending", from_user: A, to_user: B });
    await admin();
    const exp = await db.query<{ ok: boolean }>(
      `select expires_at = ((private.almaty_today() + 1)::timestamp + interval '10 hours') at time zone 'Asia/Almaty' as ok from public.duty_swap_requests where id = $1`,
      [req.id],
    );
    expect(exp.rows[0].ok).toBe(true);
    const pending = await schedule(C, 1, 3);
    expect(pending[0].r).toBe(req.id);
    expect(pending[2].r).toBe(req.id);
    expect(pending[1].r).toBeNull();

    const done = await respond(B, req.id, true);
    expect(done.status).toBe("accepted");
    const rows = await schedule(C, 1, 3);
    expect(rows.map((r) => [r.u, r.s])).toEqual([[A, "swap"], [C, "rotation"], [B, "swap"]]);
    expect(rows[0].r).toBeNull(); // no longer pending
    await admin();
    const o = await db.query<{ reason: string }>(`select reason from public.duty_overrides where duty_id = $1 limit 1`, [duty]);
    expect(o.rows[0].reason).toBe("пары до вечера");
  });
  it("decline and cancel free the days", async () => {
    const r1 = await request(A, 3, 1);
    expect((await respond(B, r1.id, false)).status).toBe("declined");
    const r2 = await request(A, 3, 1);
    await as(A);
    expect((await db.query<Req>(`select * from public.cancel_swap($1)`, [r2.id])).rows[0].status).toBe("cancelled");
    expect((await db.query<Req>(`select * from public.cancel_swap($1)`, [r2.id])).rows[0].status).toBe("cancelled"); // twice is a no-op
    expect(await whoIs(1)).toBe(B);
  });
  it("busy: a day that sits in a pending request cannot be used again", async () => {
    await request(A, 3, 1);
    await expectMsg(request(C, 2, 3), "busy");
    await expectMsg(request(C, 2, 1), "busy");
  });
  it("not_assignee and past_day and a swap with yourself", async () => {
    await expectMsg(request(B, 3, 1), "not_assignee"); // day 3 is A's
    await expectMsg(request(A, -1, 1), "past_day");
    await expectMsg(request(A, 3, -1), "past_day");
    await expectCode(request(A, 3, 3), "23514");
    await expectCode(request(A, 3, 6), "23514"); // day 6 is A's own too
  });
  it("outsiders and a reason over 140 characters are refused", async () => {
    await as(E);
    await expectCode(db.query(`select * from public.request_swap($1, $2, $3, null)`, [duty, await day(3), await day(1)]), "42501");
    await expectCode(request(A, 3, 1, "x".repeat(141)), "23514");
    expect((await request(A, 3, 1, "x".repeat(140))).status).toBe("pending");
  });
  it("only the counterparty answers; only the requester cancels", async () => {
    const req = await request(A, 3, 1);
    await expectCode(respond(C, req.id, true), "42501");
    await expectCode(respond(A, req.id, true), "42501");
    await as(B);
    await expectCode(db.query(`select * from public.cancel_swap($1)`, [req.id]), "42501");
    await as(E);
    await expectCode(db.query(`select * from public.respond_swap($1, true)`, [req.id]), "42501");
  });
  it("expired: an answer after the deadline only marks it expired and changes nothing", async () => {
    const req = await request(A, 3, 1);
    await admin();
    await db.query(`update public.duty_swap_requests set expires_at = now() - interval '1 minute' where id = $1`, [req.id]);
    expect((await respond(B, req.id, true)).status).toBe("expired");
    expect(await whoIs(1)).toBe(B);
    expect(await status(req.id)).toBe("expired");
    expect((await respond(B, req.id, true)).status).toBe("expired");
    // the stale pending request no longer blocks the days
    expect((await request(A, 3, 1)).status).toBe("pending");
  });
  it("a request is expired lazily by the next request on the same duty, and the schedule hides it", async () => {
    const req = await request(A, 3, 1);
    await admin();
    await db.query(`update public.duty_swap_requests set expires_at = now() - interval '1 minute' where id = $1`, [req.id]);
    expect((await schedule(B, 1, 1))[0].r).toBeNull();
    await request(A, 3, 1);
    expect(await status(req.id)).toBe("expired");
  });
  it("stale: the assignees changed since the request", async () => {
    const req = await request(A, 3, 1);
    await admin();
    await db.query(`insert into public.duty_overrides (duty_id, day, user_id, source) values ($1, (private.almaty_today() + 1), $2, 'admin')`, [duty, C]);
    await expectMsg(respond(B, req.id, true), "stale");
    expect(await status(req.id)).toBe("pending");
  });
  it("first accept wins: the same answer twice is a no-op, the opposite answer is stale", async () => {
    const req = await request(A, 3, 1);
    expect((await respond(B, req.id, true)).status).toBe("accepted");
    expect((await respond(B, req.id, true)).status).toBe("accepted");
    await expectMsg(respond(B, req.id, false), "stale");
    await as(A);
    await expectMsg(db.query(`select * from public.cancel_swap($1)`, [req.id]), "stale");
    // two independent swaps both go through
    const x = await request(B, 4, 2); // B has day 4, C has day 2
    expect((await respond(C, x.id, true)).status).toBe("accepted");
    expect(await whoIs(4)).toBe(C);
    expect(await whoIs(2)).toBe(B);
  });
  it("a swapped day can be swapped again (the override owner is the assignee)", async () => {
    const req = await request(A, 3, 1);
    await respond(B, req.id, true); // A has day 1, B has day 3
    const again = await request(A, 1, 2); // A gives the day 1 to C for day 2
    expect(again.to_user).toBe(C);
  });
});

describe("mark_duty_done", () => {
  const mark = async (user: string, d: number) => {
    const t = await day(d);
    await as(user);
    return db.query<{ user_id: string }>(`select * from public.mark_duty_done($1, $2)`, [duty, t]);
  };
  it("the assignee marks today; twice is a no-op; the schedule shows done", async () => {
    await newDuty(0, [A, B, C]);
    expect((await mark(A, 0)).rows[0].user_id).toBe(A);
    await mark(A, 0);
    expect((await schedule(B, 0, 0))[0]).toMatchObject({ u: A, done: true });
  });
  it("not the assignee, not the future, not outsiders", async () => {
    await expectMsg(mark(B, 0), "not_assignee");
    await expectMsg(mark(A, 1), "future_day");
    await as(E);
    await expectCode(db.query(`select * from public.mark_duty_done($1, $2)`, [duty, await day(0)]), "42501");
  });
  it("yesterday is open until 09:00, older days are locked", async () => {
    await newDuty(-2, [A, B, C]); // -2 A, -1 B, 0 C
    await expectMsg(mark(A, -2), "locked");
    if ((await almatyHour()) < 9) expect((await mark(B, -1)).rows[0].user_id).toBe(B);
    else await expectMsg(mark(B, -1), "locked");
  });
  it("a done day keeps its cook even when the order changes later", async () => {
    await mark(A, 0);
    await as(A);
    await db.query(`select * from public.set_duty_order($1, $2, null)`, [duty, [B, C, A]]);
    expect(await whoIs(0)).toBe(A);
    await admin();
    await expect(db.query(`select public.admin_assign_day($1, $2, $3)`, [duty, await day(0), B])).rejects.toBeDefined(); // not an admin session
  });
  it("admins cannot reassign a day that is already done", async () => {
    await mark(A, 0);
    await as(A);
    await expectMsg(db.query(`select public.admin_assign_day($1, $2, $3)`, [duty, await day(0), B]), "locked");
  });
});

describe("morning cron", () => {
  const morning = async (secret = SECRET) => {
    await as(null, "anon");
    return (await db.query<{ r: Array<Record<string, unknown>> }>(`select public.run_duty_morning($1) as r`, [secret])).rows[0].r;
  };
  it("needs the server secret", async () => {
    await expectCode(morning("nope"), "28000");
    await as(A);
    await expectCode(db.query(`select public.run_duty_morning($1)`, [SECRET]), "42501");
  });
  it("returns today's and tomorrow's cook with devices and the chat, once per day", async () => {
    await admin();
    await db.exec(`update public.households set telegram_chat_id = -100123;
      update public.profiles set telegram_username = 'aidos_k' where id = '${B}';
      insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ('${A}', 'https://fcm.googleapis.com/a', 'k', 'a');`);
    const first = await morning();
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      kind: "cooking",
      today_user: A,
      today_name: "Ерасыл",
      tomorrow_user: B,
      tomorrow_name: "@aidos_k",
      telegram_chat_id: -100123,
    });
    expect(first[0].subscriptions).toEqual([{ endpoint: "https://fcm.googleapis.com/a", p256dh: "k", auth: "a" }]);
    expect(await morning()).toEqual([]); // idempotent
    await admin();
    expect((await db.query(`select 1 from private.duty_morning_log`)).rows).toHaveLength(1);
  });
  it("follows swaps and skips, and expires stale requests", async () => {
    const req = await request(A, 3, 1);
    await admin();
    await db.query(`update public.duty_swap_requests set expires_at = now() - interval '1 minute' where id = $1`, [req.id]);
    await db.exec(`update public.members set away_until = private.almaty_today() where user_id = '${A}'`);
    const out = await morning();
    expect(out[0]).toMatchObject({ today_user: B, tomorrow_user: B });
    expect(await status(req.id)).toBe("expired");
  });
});

describe("swap_notice (the counterparty's devices, server only)", () => {
  const notice = async (user: string, secret: string, id: string, event: string) => {
    await as(user);
    return (await db.query<{ n: Record<string, unknown> }>(`select public.swap_notice($1, $2, $3) as n`, [secret, id, event])).rows[0].n;
  };
  it("requested -> the other side; declined -> the requester; needs the secret and the right caller", async () => {
    await admin();
    await db.exec(`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ('${B}', 'https://fcm.googleapis.com/b', 'k', 'a');
      update public.profiles set telegram_user_id = 777 where id = '${B}';`);
    const req = await request(A, 3, 1, "пары");
    const n = await notice(A, SECRET, req.id, "requested");
    expect(n).toMatchObject({ target_user: B, telegram_user_id: 777, from_label: expect.any(String), reason: "пары", from_name: "Ерасыл" });
    expect(n.subscriptions).toHaveLength(1);
    await expectCode(notice(A, "nope", req.id, "requested"), "28000");
    await expectCode(notice(B, SECRET, req.id, "requested"), "23514");
    await expectCode(notice(E, SECRET, req.id, "requested"), "42501");
    await respond(B, req.id, false);
    const d = await notice(B, SECRET, req.id, "declined");
    expect(d).toMatchObject({ target_user: A });
  });
});

describe("tg_respond_swap", () => {
  const tg = async (id: number, req: string, accept: boolean, secret = SECRET) => {
    await as(null, "anon");
    return (await db.query<{ r: { result: string; notice: Record<string, unknown> | null } }>(`select public.tg_respond_swap($1, $2, $3, $4) as r`, [secret, id, req, accept])).rows[0].r;
  };
  it("needs the secret and a linked counterparty; an unlinked or wrong Telegram user is refused", async () => {
    await admin();
    await db.exec(`update public.profiles set telegram_user_id = 111 where id = '${A}'; update public.profiles set telegram_user_id = 222 where id = '${B}'; update public.profiles set telegram_user_id = 333 where id = '${C}';`);
    const req = await request(A, 3, 1);
    await expectCode(tg(222, req.id, true, "nope"), "28000");
    await expectCode(tg(999, req.id, true), "42501"); // nobody
    await expectCode(tg(111, req.id, true), "42501"); // the requester cannot accept
    await expectCode(tg(333, req.id, true), "42501"); // a third member cannot
    expect((await tg(222, req.id, true)).result).toBe("accepted");
    expect(await whoIs(1)).toBe(A);
    expect((await tg(222, req.id, false)).result).toBe("stale");
  });
  it("a decline returns the requester's notice", async () => {
    await admin();
    await db.exec(`update public.profiles set telegram_user_id = 222 where id = '${B}'; update public.profiles set telegram_user_id = 111 where id = '${A}';`);
    const req = await request(A, 3, 1);
    const out = await tg(222, req.id, false);
    expect(out.result).toBe("declined");
    expect(out.notice).toMatchObject({ target_user: A, telegram_user_id: 111 });
  });
  it("an expired request answers expired", async () => {
    await admin();
    await db.exec(`update public.profiles set telegram_user_id = 222 where id = '${B}'`);
    const req = await request(A, 3, 1);
    await admin();
    await db.query(`update public.duty_swap_requests set expires_at = now() - interval '1 second' where id = $1`, [req.id]);
    expect((await tg(222, req.id, true)).result).toBe("expired");
  });
});

describe("permissions", () => {
  it("clients cannot write the tables or run private helpers", async () => {
    await as(A);
    await expectCode(db.query(`insert into public.duty_overrides (duty_id, day, user_id, source) values ($1, current_date, $2, 'admin')`, [duty, A]), "42501");
    await expectCode(db.query(`update public.duties set title = 'x'`), "42501");
    await expectCode(db.query(`delete from public.duty_done`), "42501");
    await expectCode(db.query(`select private.duty_assignee($1, current_date)`, [duty]), "42501");
    await expectCode(db.query(`select * from private.duty_morning_log`), "42501");
    await as(E);
    expect((await db.query(`select * from public.duties`)).rows).toHaveLength(0);
    expect((await db.query(`select * from public.duty_members`)).rows).toHaveLength(0);
    await as(B);
    expect((await db.query(`select * from public.duties`)).rows).toHaveLength(1);
  });
  it("the anon surface is exactly the nine server-secret / token functions", async () => {
    await admin();
    const r = await db.query<{ n: string }>(
      `select p.proname n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname in ('public', 'private') and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')
         and p.proname not in ('uid')
       order by 1`,
    );
    expect(r.rows.map((x) => x.n)).toEqual([
      "capture_purchase",
      "prune_push_subscription",
      "run_daily_reminders",
      "run_duty_morning",
      "run_monthly_bills",
      "run_pending_digest",
      "tg_link_account",
      "tg_resolve_pending",
      "tg_respond_swap",
    ]);
  });
  it("every duty function is security definer with an empty search_path", async () => {
    await admin();
    const r = await db.query<{ n: string; definer: boolean; cfg: string[] | null }>(
      `select p.proname n, p.prosecdef definer, p.proconfig cfg from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname = 'public' and p.proname in ('duty_schedule','create_duty','set_duty_order','admin_assign_day','mark_duty_done','request_swap','respond_swap','cancel_swap','swap_notice','tg_respond_swap','run_duty_morning')`,
    );
    expect(r.rows).toHaveLength(11);
    for (const f of r.rows) {
      expect(f.definer).toBe(true);
      expect(f.cfg).toContain(`search_path=""`);
    }
  });
});
