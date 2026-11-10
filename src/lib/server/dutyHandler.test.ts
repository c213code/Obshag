import { describe, expect, it } from "vitest";
import { RepoError } from "@/lib/data/repo";
import type { DutyEventNotice, DutyMorningItem, DutyNotice } from "@/lib/data/types";
import { handleDutyEventNotify, handleDutyNotify, handleMorning, morningGroupText, swapDmKeyboard, swapDmText, type DutyDeps } from "./dutyHandler";
import { createRecordingSender } from "./push";
import { createRecordingTelegram } from "./telegram/api";
import { parseSwapCallback } from "./telegram/parse";

const SECRET = "cron-secret-0123456789abcdef";
const ID = "123e4567-e89b-42d3-a456-426614174000";
const sub = { endpoint: "https://fcm.googleapis.com/a", p256dh: "k", auth: "a" };
const item: DutyMorningItem = {
  duty_id: "d1", household_id: "h1", kind: "cooking", title: "Готовка", telegram_chat_id: -100,
  today_user: "u1", today_name: "@erasyl", tomorrow_user: "u2", tomorrow_name: "@aidos", subscriptions: [sub],
};
const notice: DutyNotice = {
  request_id: ID, target_user: "u2", subscriptions: [sub], telegram_user_id: 222, from_name: "Ерасыл", to_name: "Айдос",
  from_day: "2026-11-17", to_day: "2026-11-18", from_label: "пн 17", to_label: "вт 18", reason: "пары",
};
const evNotice: DutyEventNotice = { event_id: ID, kind: "ping", title: "Мусор", target_user: "u2", self: false, actor_name: "Ерасыл", subscriptions: [sub] };
const make = (over: Partial<DutyDeps["repo"]> = {}) => {
  const push = createRecordingSender();
  const telegram = createRecordingTelegram();
  const deps: DutyDeps = { repo: { runDutyMorning: async () => [item], swapNotice: async () => notice, dutyEventNotice: async () => evNotice, ...over }, push, telegram, secret: SECRET };
  return { deps, push, telegram };
};

describe("callback parsing", () => {
  it("parses sw:a:<uuid> and sw:d:<uuid> only", () => {
    expect(parseSwapCallback(`sw:a:${ID}`)).toEqual({ accept: true, requestId: ID });
    expect(parseSwapCallback(`sw:d:${ID}`)).toEqual({ accept: false, requestId: ID });
    for (const bad of [`sw:x:${ID}`, `sw:a:${ID}0`, "sw:a:nope", `s:${ID}`, `sw:a:${ID.slice(0, -1)}g`, "", undefined]) expect(parseSwapCallback(bad), String(bad)).toBeNull();
  });
});

describe("morning run", () => {
  it("is closed without the exact bearer", async () => {
    const { deps } = make();
    for (const h of [null, "", `Bearer ${SECRET}x`, SECRET]) expect((await handleMorning(h, deps)).status).toBe(401);
    expect((await handleMorning(`Bearer ${SECRET}`, null)).status).toBe(401);
  });
  it("pushes the cook and posts to the group", async () => {
    const { deps, push, telegram } = make();
    const out = await handleMorning(`Bearer ${SECRET}`, deps);
    expect(out).toMatchObject({ status: 200, body: { ok: true, duties: 1 } });
    await out.afterResponse?.();
    expect(push.calls).toEqual([{ endpoint: sub.endpoint, payload: { type: "duty-today", kind: "cooking", title: "Готовка" } }]);
    expect(telegram.calls).toEqual([{ method: "sendMessage", args: [-100, "🍳 Сегодня готовит @erasyl · завтра @aidos"] }]);
  });
  it("texts for other duties and for no tomorrow; a failing repo is a 500; no chat = no post", async () => {
    expect(morningGroupText({ ...item, kind: "trash", title: "Мусор", tomorrow_name: null })).toBe("🗓 Мусор: сегодня @erasyl");
    expect((await handleMorning(`Bearer ${SECRET}`, make({ runDutyMorning: async () => Promise.reject(new Error("x")) }).deps)).status).toBe(500);
    const quiet = make({ runDutyMorning: async () => [{ ...item, telegram_chat_id: null }] });
    await (await handleMorning(`Bearer ${SECRET}`, quiet.deps)).afterResponse?.();
    expect(quiet.telegram.calls).toEqual([]);
  });
});

describe("notify", () => {
  it("a request pushes the counterparty and DMs them the two buttons", async () => {
    const { deps, push, telegram } = make();
    const out = await handleDutyNotify({ request_id: ID, event: "requested" }, deps);
    expect(out.status).toBe(200);
    await out.afterResponse?.();
    expect(push.calls[0].payload).toMatchObject({ type: "swap-request", requestId: ID, name: "Ерасыл", fromLabel: "пн 17", toLabel: "вт 18" });
    expect(telegram.calls).toHaveLength(1);
    expect(telegram.calls[0].args).toEqual([222, swapDmText(notice), swapDmKeyboard(ID)]);
    expect(swapDmKeyboard(ID)[0].map((b) => b.callback_data)).toEqual([`sw:a:${ID}`, `sw:d:${ID}`]);
  });
  it("a decline only pushes (no DM), a missing Telegram link means no DM", async () => {
    const { deps, push, telegram } = make();
    await (await handleDutyNotify({ request_id: ID, event: "declined" }, deps)).afterResponse?.();
    expect(push.calls[0].payload).toMatchObject({ type: "swap-declined", name: "Айдос" });
    expect(telegram.calls).toEqual([]);
    const unlinked = make({ swapNotice: async () => ({ ...notice, telegram_user_id: null }) });
    await (await handleDutyNotify({ request_id: ID, event: "requested" }, unlinked.deps)).afterResponse?.();
    expect(unlinked.telegram.calls).toEqual([]);
  });
  it("maps refusals: bad body 400, no deps 500, unauthenticated 401, forbidden 403, wrong state 409", async () => {
    expect((await handleDutyNotify({ request_id: ID, event: "nope" }, make().deps)).status).toBe(400);
    expect((await handleDutyNotify({ request_id: ID, event: "requested", extra: 1 }, make().deps)).status).toBe(400);
    expect((await handleDutyNotify({ request_id: ID, event: "requested" }, null)).status).toBe(500);
    for (const [code, status] of [["unauthenticated", 401], ["forbidden", 403], ["not_found", 403], ["invalid", 409]] as const) {
      const { deps } = make({ swapNotice: async () => Promise.reject(new RepoError(code, code)) });
      expect((await handleDutyNotify({ request_id: ID, event: "requested" }, deps)).status, code).toBe(status);
    }
    expect((await handleDutyNotify({ request_id: ID, event: "requested" }, make({ swapNotice: async () => Promise.reject(new Error("x")) }).deps)).status).toBe(500);
  });
});

describe("event notify (Мусор / Вода)", () => {
  it("pushes the current person; the caller's own turn pushes nobody", async () => {
    const { deps, push } = make();
    const out = await handleDutyEventNotify({ event_id: ID }, deps);
    expect(out.status).toBe(200);
    await out.afterResponse?.();
    expect(push.calls).toEqual([{ endpoint: sub.endpoint, payload: { type: "duty-event", kind: "ping", name: "Ерасыл", title: "Мусор" } }]);
    const own = make({ dutyEventNotice: async () => ({ ...evNotice, self: true, subscriptions: [] }) });
    await (await handleDutyEventNotify({ event_id: ID }, own.deps)).afterResponse?.();
    expect(own.push.calls).toEqual([]);
  });
  it("maps refusals", async () => {
    expect((await handleDutyEventNotify({ event_id: ID, extra: 1 }, make().deps)).status).toBe(400);
    expect((await handleDutyEventNotify({ event_id: ID }, null)).status).toBe(500);
    const refuse = (code: "unauthenticated" | "forbidden") => make({ dutyEventNotice: async () => { throw new RepoError(code, "x"); } }).deps;
    expect((await handleDutyEventNotify({ event_id: ID }, refuse("unauthenticated"))).status).toBe(401);
    expect((await handleDutyEventNotify({ event_id: ID }, refuse("forbidden"))).status).toBe(403);
  });
});
