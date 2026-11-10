import { describe, expect, it } from "vitest";
import { createMockRepo, memorySession, memoryStorage } from "./mockRepo";
import { HOUSEHOLD_ID, SEED_PASSWORD, createSeed } from "./seed";
import type { Repo } from "./repo";

const SECRET = "unit-test-cron-secret-0123456789";
const [ME, AIDOS, DANYA, NURIK] = createSeed().profiles.map((p) => p.id);
const EMAIL: Record<string, string> = { [ME]: "erasyl@obshak.test", [AIDOS]: "aidos@obshak.test", [DANYA]: "danya@obshak.test", [NURIK]: "nurik@obshak.test" };

/** Monday 9 Nov 2026, 17:00 in Almaty (12:00Z). */
function setup(startIso = "2026-11-09T12:00:00Z") {
  const storage = memoryStorage();
  let t = Date.parse(startIso);
  const now = () => new Date(t);
  const as = async (id: string): Promise<Repo> => {
    const r = createMockRepo({ storage, session: memorySession(), now, serverSecret: SECRET });
    await r.signIn(EMAIL[id], SEED_PASSWORD);
    return r;
  };
  return { as, set: (iso: string) => (t = Date.parse(iso)) };
}
const D = (n: number) => new Date(Date.UTC(2026, 10, 9 + n)).toISOString().slice(0, 10); // D(0) = 2026-11-09

async function withDuty(env: ReturnType<typeof setup>, startOffset = 0) {
  const me = await env.as(ME);
  const duty = await me.createDuty({ household_id: HOUSEHOLD_ID, kind: "cooking", title: "Готовка", start_date: D(startOffset) });
  return { me, duty };
}

describe("mock duty: create and rotation", () => {
  it("only admins create; default order = members; a second cooking duty is refused", async () => {
    const env = setup();
    const aidos = await env.as(AIDOS);
    await expect(aidos.createDuty({ household_id: HOUSEHOLD_ID, kind: "cooking", title: "Готовка" })).rejects.toMatchObject({ code: "forbidden" });
    const { me, duty } = await withDuty(env);
    expect(duty.order).toEqual([ME, AIDOS, DANYA, NURIK]);
    await expect(me.createDuty({ household_id: HOUSEHOLD_ID, kind: "cooking", title: "Ещё" })).rejects.toMatchObject({ code: "invalid" });
    await expect(me.createDuty({ household_id: HOUSEHOLD_ID, kind: "custom", title: "  " })).rejects.toMatchObject({ code: "invalid" });
    expect(await aidos.listDuties(HOUSEHOLD_ID)).toHaveLength(1);
  });

  it("rotates by (day - start) mod n, skips an away member, and lets an override win", async () => {
    const env = setup();
    const { me, duty } = await withDuty(env);
    const plan = await me.dutySchedule(duty.id, D(0), D(8));
    expect(plan.map((p) => p.user_id)).toEqual([ME, AIDOS, DANYA, NURIK, ME, AIDOS, DANYA, NURIK, ME]);
    const danya = await env.as(DANYA);
    await danya.setAway(HOUSEHOLD_ID, D(2));
    const skip = (await me.dutySchedule(duty.id, D(2), D(2)))[0];
    expect(skip).toMatchObject({ user_id: NURIK, source: "skip", skipped_user: DANYA });
    await me.adminAssignDay(duty.id, D(1), NURIK);
    expect((await me.dutySchedule(duty.id, D(1), D(1)))[0]).toMatchObject({ user_id: NURIK, source: "admin" });
    await expect((await env.as(AIDOS)).adminAssignDay(duty.id, D(1), ME)).rejects.toMatchObject({ code: "forbidden" });
    await expect(me.adminAssignDay(duty.id, D(-1), ME)).rejects.toMatchObject({ code: "past_day" });
  });
});

describe("mock duty: swaps", () => {
  it("happy path writes both overrides; busy, stale, expired and non-assignee are refused", async () => {
    const env = setup();
    const { me, duty } = await withDuty(env); // D(0) me, D(1) aidos, D(2) danya, D(4) me
    const aidos = await env.as(AIDOS);
    const danya = await env.as(DANYA);
    await expect(aidos.requestSwap(duty.id, D(4), D(1))).rejects.toMatchObject({ code: "not_assignee" });
    await expect(me.requestSwap(duty.id, D(-1), D(1))).rejects.toMatchObject({ code: "past_day" });
    const req = await me.requestSwap(duty.id, D(4), D(1), " пары ");
    expect(req).toMatchObject({ status: "pending", from_user: ME, to_user: AIDOS, reason: "пары" });
    expect(req.expires_at).toBe("2026-11-10T05:00:00.000Z"); // D(1) 10:00 Almaty
    await expect(danya.requestSwap(duty.id, D(2), D(4))).rejects.toMatchObject({ code: "busy" });
    expect((await me.dutySchedule(duty.id, D(1), D(1)))[0].request_id).toBe(req.id);
    await expect(danya.respondSwap(req.id, true)).rejects.toMatchObject({ code: "forbidden" });
    expect((await aidos.respondSwap(req.id, true)).status).toBe("accepted");
    expect((await aidos.respondSwap(req.id, true)).status).toBe("accepted");
    await expect(aidos.respondSwap(req.id, false)).rejects.toMatchObject({ code: "stale" });
    const plan = await me.dutySchedule(duty.id, D(0), D(4));
    expect(plan.map((p) => [p.user_id, p.source])).toEqual([[ME, "rotation"], [ME, "swap"], [DANYA, "rotation"], [NURIK, "rotation"], [AIDOS, "swap"]]);
  });

  it("an answer after the deadline marks it expired; an admin change makes accepting stale; decline and cancel free the days", async () => {
    const env = setup();
    const { me, duty } = await withDuty(env);
    const aidos = await env.as(AIDOS);
    const a = await me.requestSwap(duty.id, D(4), D(1));
    env.set("2026-11-10T06:00:00Z"); // D(1) 11:00 Almaty
    expect((await aidos.respondSwap(a.id, true)).status).toBe("expired");
    env.set("2026-11-09T12:00:00Z");
    const b = await me.requestSwap(duty.id, D(4), D(1));
    expect(b.status).toBe("pending");
    await me.adminAssignDay(duty.id, D(1), NURIK);
    expect((await aidos.getSwapRequest(b.id)).status).toBe("cancelled");
    const c = await me.requestSwap(duty.id, D(4), D(2));
    const danya = await env.as(DANYA);
    expect((await danya.respondSwap(c.id, false)).status).toBe("declined");
    const d = await me.requestSwap(duty.id, D(4), D(2));
    expect((await me.cancelSwap(d.id)).status).toBe("cancelled");
    expect((await me.cancelSwap(d.id)).status).toBe("cancelled");
    // a plain stale: change the order under a pending request
    const e = await me.requestSwap(duty.id, D(4), D(2));
    await me.setDutyOrder(duty.id, [ME, AIDOS, NURIK, DANYA]);
    await expect(danya.respondSwap(e.id, true)).rejects.toMatchObject({ code: "stale" });
    await expect(me.requestSwap(duty.id, D(4), D(5), "x".repeat(141))).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("mock duty: done", () => {
  it("today by the assignee; yesterday only before 09:00; not the future; not someone else's", async () => {
    const env = setup();
    const { me, duty } = await withDuty(env, -1); // D(-1) me, D(0) aidos
    const aidos = await env.as(AIDOS);
    await expect(me.markDutyDone(duty.id, D(0))).rejects.toMatchObject({ code: "not_assignee" });
    await expect(aidos.markDutyDone(duty.id, D(1))).rejects.toMatchObject({ code: "future_day" });
    await expect(me.markDutyDone(duty.id, D(-1))).rejects.toMatchObject({ code: "locked" }); // 17:00, after 09:00
    await aidos.markDutyDone(duty.id, D(0));
    await aidos.markDutyDone(duty.id, D(0));
    expect((await me.dutySchedule(duty.id, D(0), D(0)))[0]).toMatchObject({ user_id: AIDOS, done: true });
    await expect(me.adminAssignDay(duty.id, D(0), ME)).rejects.toMatchObject({ code: "locked" });
    env.set("2026-11-09T03:00:00Z"); // Mon 08:00 Almaty: yesterday (Sun) is still open
    const early = await withDuty(setup("2026-11-09T03:00:00Z"), -1);
    await early.me.markDutyDone(early.duty.id, D(-1));
  });
});

describe("mock duty: server runs", () => {
  it("the morning run is once per duty and day and needs the secret", async () => {
    const env = setup();
    const { me, duty } = await withDuty(env);
    const server = createMockRepo({ storage: undefined, session: memorySession(), serverSecret: SECRET });
    await expect(server.runDutyMorning("bad")).rejects.toMatchObject({ code: "unauthenticated" });
    const out = await me.runDutyMorning(SECRET);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ duty_id: duty.id, today_user: ME, today_name: "Ерасыл", tomorrow_user: AIDOS, tomorrow_name: "Айдос" });
    expect(await me.runDutyMorning(SECRET)).toEqual([]);
  });

  it("swapNotice goes to the other side only, tgRespondSwap checks the Telegram user", async () => {
    const env = setup();
    const { me, duty } = await withDuty(env);
    const aidos = await env.as(AIDOS);
    const req = await me.requestSwap(duty.id, D(4), D(1));
    expect(await me.swapNotice(SECRET, req.id, "requested")).toMatchObject({ target_user: AIDOS, from_name: "Ерасыл", from_label: "пт 13" });
    await expect(aidos.swapNotice(SECRET, req.id, "requested")).rejects.toMatchObject({ code: "invalid" });
    await expect(me.swapNotice("bad", req.id, "requested")).rejects.toMatchObject({ code: "unauthenticated" });
    await aidos.tgLinkAccount(SECRET, await aidos.createTelegramLinkCode(), 222);
    await me.tgLinkAccount(SECRET, await me.createTelegramLinkCode(), 111);
    await expect(me.tgRespondSwap(SECRET, 111, req.id, true)).rejects.toMatchObject({ code: "forbidden" });
    await expect(me.tgRespondSwap(SECRET, 999, req.id, true)).rejects.toMatchObject({ code: "forbidden" });
    const declined = await me.tgRespondSwap(SECRET, 222, req.id, false);
    expect(declined.result).toBe("declined");
    expect(declined.notice).toMatchObject({ target_user: ME });
    expect((await me.tgRespondSwap(SECRET, 222, req.id, true)).result).toBe("stale");
    expect(await me.listSwapRequests(duty.id)).toHaveLength(1);
  });
});
