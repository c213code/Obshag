import { describe, expect, it } from "vitest";
import { RepoError, type Repo } from "@/lib/data/repo";
import type { PendingDigestUser, ReminderTarget } from "@/lib/data/types";
import { bearerMatches, readCronSecret } from "./cronAuth";
import { createRecordingSender } from "./push";
import { createRecordingTelegram } from "./telegram/api";
import { digestText, formatWhen } from "./telegram/digest";
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
const repo = (over: Partial<Pick<Repo, "remind" | "runDailyReminders" | "runMonthlyBills" | "runPendingDigest">> = {}) => ({
  remind: async () => target,
  runDailyReminders: async () => [target],
  runMonthlyBills: async () => ({ created: 0, notices: [] }),
  runPendingDigest: async () => [],
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

describe("pending digest in the daily cron", () => {
  const sub = { endpoint: "https://fcm.googleapis.com/d", p256dh: "k", auth: "a" };
  const purchase = (n: number) => ({ id: `00000000-0000-4000-8000-00000000000${n}`, merchant: "Small", amount: 3780, created_at: "2026-11-08T09:32:00.000Z" });
  const user = (over: Partial<PendingDigestUser> = {}): PendingDigestUser => ({
    user_id: "u2",
    telegram_user_id: 4242,
    subscriptions: [sub],
    purchases: [purchase(1), purchase(2)],
    ...over,
  });
  const run = (users: PendingDigestUser[], telegram = createRecordingTelegram(), push = createRecordingSender()) =>
    handleCron(`Bearer ${SECRET}`, { repo: repo({ runDailyReminders: async () => [], runPendingDigest: async () => users }), push, secret: SECRET, telegram }).then(async (out) => {
      await out.afterResponse?.();
      return { out, telegram, push };
    });

  it("sends ONE push per user (not per purchase) and one DM per purchase with the two buttons", async () => {
    const { out, telegram, push } = await run([user()]);
    expect(out).toMatchObject({ status: 200, body: { ok: true, digests: 1 } });
    expect(push.calls).toEqual([{ endpoint: sub.endpoint, payload: { type: "digest", count: 2 } }]);
    expect(telegram.calls.map((c) => c.method)).toEqual(["sendMessage", "sendMessage"]);
    const [chat, body, keyboard] = telegram.calls[0].args as [number, string, Array<Array<{ text: string; callback_data: string }>>];
    expect(chat).toBe(4242);
    expect(body).toContain("🛒 Small · 3\u00a0780\u00a0₸ · 8 нояб, 14:32");
    expect(body.endsWith("Чья покупка?")).toBe(true);
    expect(keyboard).toEqual([
      [
        { text: "Общее", callback_data: "s:00000000-0000-4000-8000-000000000001" },
        { text: "Моё", callback_data: "p:00000000-0000-4000-8000-000000000001" },
      ],
    ]);
  });
  it("no telegram id: push only; no push subscription: DM only", async () => {
    const a = await run([user({ telegram_user_id: null })]);
    expect(a.telegram.calls).toEqual([]);
    expect(a.push.calls).toHaveLength(1);
    const b = await run([user({ subscriptions: [] })]);
    expect(b.push.calls).toEqual([]);
    expect(b.telegram.calls).toHaveLength(2);
  });
  it("caps the DMs at 10 per user", async () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ ...purchase(1), id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}` }));
    const { telegram, push } = await run([user({ purchases: many })]);
    expect(telegram.calls).toHaveLength(10);
    expect(push.calls[0].payload).toEqual({ type: "digest", count: 14 });
  });
  it("a failing digest still sends the reminders and reports the failure", async () => {
    const push = createRecordingSender();
    const out = await handleCron(`Bearer ${SECRET}`, { repo: repo({ runPendingDigest: async () => Promise.reject(new Error("x")) }), push, secret: SECRET });
    expect(out).toMatchObject({ status: 500, body: { ok: false, reminders: 1 } });
    await out.afterResponse?.();
    expect(push.calls).toHaveLength(2);
  });
  it("a Telegram or push failure never throws", async () => {
    const boom = { send: async () => Promise.reject(new Error("push down")) };
    const tg = { ...createRecordingTelegram(), sendMessage: async () => Promise.reject(new Error("tg down")) };
    const out = await handleCron(`Bearer ${SECRET}`, { repo: repo({ runPendingDigest: async () => [user()] }), push: boom, secret: SECRET, telegram: tg });
    await expect(out.afterResponse?.()).resolves.toBeUndefined();
  });
  it("formats the message in Almaty time and falls back to «Покупка»", () => {
    expect(formatWhen("2026-11-08T09:32:00.000Z")).toBe("8 нояб, 14:32");
    expect(formatWhen("garbage")).toBe("");
    expect(digestText({ ...purchase(1), merchant: null })).toContain("🛒 Покупка ·");
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
