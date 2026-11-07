import { describe, expect, it } from "vitest";
import { RepoError, type Repo } from "@/lib/data/repo";
import type { ReminderTarget } from "@/lib/data/types";
import { bearerMatches, readCronSecret } from "./cronAuth";
import { createRecordingSender } from "./push";
import { handleCron, handleRemind, reminderPayload } from "./reminderHandler";

const SECRET = "cron-secret-0123456789abcdef";
const target: ReminderTarget = {
  to_user: "u2",
  from_user: "u1",
  from_name_dative: "Айдос",
  amount: 200,
  subscriptions: [
    { endpoint: "https://fcm.googleapis.com/a", p256dh: "k", auth: "a" },
    { endpoint: "https://fcm.googleapis.com/b", p256dh: "k", auth: "a" },
  ],
};
const repo = (over: Partial<Pick<Repo, "remind" | "runDailyReminders" | "runMonthlyBills">> = {}) => ({
  remind: async () => target,
  runDailyReminders: async () => [target],
  runMonthlyBills: async () => ({ created: 0, notices: [] }),
  ...over,
});

describe("cron auth", () => {
  it("accepts only the exact bearer", () => {
    expect(bearerMatches(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(bearerMatches(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(bearerMatches(`Bearer ${SECRET.slice(0, -1)}`, SECRET)).toBe(false);
    expect(bearerMatches(`bearer ${SECRET}`, SECRET)).toBe(false);
    expect(bearerMatches(SECRET, SECRET)).toBe(false);
    expect(bearerMatches("Bearer ", SECRET)).toBe(false);
    expect(bearerMatches(null, SECRET)).toBe(false);
    expect(bearerMatches(`Bearer ${SECRET}`, null)).toBe(false);
    expect(bearerMatches("Bearer undefined", null)).toBe(false);
  });
  it("reads CRON_SECRET only when it is long enough", () => {
    expect(readCronSecret({ CRON_SECRET: SECRET })).toBe(SECRET);
    expect(readCronSecret({ CRON_SECRET: " short " })).toBeNull();
    expect(readCronSecret({})).toBeNull();
  });
});

describe("handleCron", () => {
  it("answers 401 without the bearer, with a wrong one, or when the server is not configured", async () => {
    const deps = { repo: repo(), push: null, secret: SECRET };
    expect((await handleCron(null, deps)).status).toBe(401);
    expect((await handleCron("Bearer nope", deps)).status).toBe(401);
    expect((await handleCron(`Bearer ${SECRET}`, null)).status).toBe(401);
  });
  it("never reaches the database on a bad bearer", async () => {
    let called = false;
    const deps = { repo: repo({ runDailyReminders: async () => ((called = true), []) }), push: null, secret: SECRET };
    await handleCron("Bearer nope", deps);
    expect(called).toBe(false);
  });
  it("runs the reminders and pushes «Ты должен Айдосу 200 ₸» to every device", async () => {
    const push = createRecordingSender({ gone: ["https://fcm.googleapis.com/a"] });
    const out = await handleCron(`Bearer ${SECRET}`, { repo: repo(), push, secret: SECRET });
    expect(out).toMatchObject({ status: 200, body: { ok: true, reminders: 1 } });
    await out.afterResponse?.();
    expect(push.calls.map((c) => c.endpoint)).toEqual(["https://fcm.googleapis.com/a", "https://fcm.googleapis.com/b"]);
    expect(push.calls[0].payload).toEqual({ type: "reminder", fromUserId: "u1", fromName: "Айдосу", amount: 200 });
  });
  it("runs the monthly bills after the reminders and pushes «Коммуналка: введи сумму за ноябрь»", async () => {
    const push = createRecordingSender();
    const order: string[] = [];
    const out = await handleCron(`Bearer ${SECRET}`, {
      repo: repo({
        runDailyReminders: async () => (order.push("reminders"), []),
        runMonthlyBills: async () => (
          order.push("bills"),
          { created: 2, notices: [{ to_user: "u2", bill_id: "b1", title: "Коммуналка", month: "2026-11", subscriptions: [{ endpoint: "https://fcm.googleapis.com/c", p256dh: "k", auth: "a" }] }] }
        ),
      }),
      push,
      secret: SECRET,
    });
    expect(order).toEqual(["reminders", "bills"]);
    expect(out).toMatchObject({ status: 200, body: { ok: true, reminders: 0, bills: 2 } });
    await out.afterResponse?.();
    expect(push.calls).toEqual([{ endpoint: "https://fcm.googleapis.com/c", payload: { type: "bill", billId: "b1", title: "Коммуналка", month: "ноябрь" } }]);
  });
  it("still sends the reminders when the bill run fails, and says so", async () => {
    const push = createRecordingSender();
    const out = await handleCron(`Bearer ${SECRET}`, { repo: repo({ runMonthlyBills: async () => Promise.reject(new Error("x")) }), push, secret: SECRET });
    expect(out).toMatchObject({ status: 500, body: { ok: false, reminders: 1 } });
    await out.afterResponse?.();
    expect(push.calls).toHaveLength(2);
  });
  it("answers 500 when the database fails and survives a throwing sender", async () => {
    const failing = await handleCron(`Bearer ${SECRET}`, { repo: repo({ runDailyReminders: async () => Promise.reject(new Error("x")) }), push: null, secret: SECRET });
    expect(failing.status).toBe(500);
    const boom = { send: async () => Promise.reject(new Error("push down")) };
    const out = await handleCron(`Bearer ${SECRET}`, { repo: repo(), push: boom, secret: SECRET });
    await expect(out.afterResponse?.()).resolves.toBeUndefined();
  });
});

describe("handleRemind", () => {
  const body = { household_id: "h1", debtor_id: "u2" };
  const deps = (over: Partial<Pick<Repo, "remind">> = {}, push = createRecordingSender()) => ({ repo: repo(over), push, secret: SECRET });

  it("maps repo errors to 401 / 403 / 400 / 429 (with retry_after) / 500", async () => {
    const fail = (code: ConstructorParameters<typeof RepoError>[0], retry?: number) =>
      handleRemind(body, deps({ remind: async () => Promise.reject(new RepoError(code, "x", retry)) }));
    expect((await fail("unauthenticated")).status).toBe(401);
    expect((await fail("forbidden")).status).toBe(403);
    expect((await fail("not_found")).status).toBe(403);
    expect((await fail("invalid")).status).toBe(400);
    expect(await fail("rate_limited", 3600)).toMatchObject({ status: 429, body: { ok: false, retry_after: 3600 } });
    expect((await fail("unknown")).status).toBe(500);
    expect((await handleRemind(body, deps({ remind: async () => Promise.reject(new Error("raw")) }))).status).toBe(500);
    expect((await handleRemind(body, null)).status).toBe(500);
  });
  it("rejects a malformed body with 400 before touching the database", async () => {
    let called = false;
    const d = deps({ remind: async () => ((called = true), target) });
    for (const bad of [null, {}, { household_id: "h" }, { household_id: 1, debtor_id: "u" }, { ...body, extra: 1 }, "x"]) {
      expect((await handleRemind(bad, d)).status).toBe(400);
    }
    expect(called).toBe(false);
  });
  it("answers 200 and pushes after the response", async () => {
    const push = createRecordingSender();
    const out = await handleRemind(body, deps({}, push));
    expect(out).toMatchObject({ status: 200, body: { ok: true } });
    expect(push.calls).toHaveLength(0);
    await out.afterResponse?.();
    expect(push.calls).toHaveLength(2);
  });
  it("builds the reminder payload with the dative name", () => {
    expect(reminderPayload({ ...target, from_name_dative: "Даня" })).toEqual({ type: "reminder", fromUserId: "u1", fromName: "Дане", amount: 200 });
  });
});
