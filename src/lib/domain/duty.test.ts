import { describe, expect, it } from "vitest";
import type { DutyDay } from "@/lib/data/types";
import {
  addDays, buildMonth, buildWeek, dayDiff, daysInMonth, effectiveStatus, isoDow, longDay, monthStats, monthTitle, neighbours,
  nextDayOf, nextLabel, resolveDay, swapExpiresAt, timeLeft, toneMap, weekStart, type DutyState,
} from "./duty";

const A = "a", B = "b", C = "c";
const state = (over: Partial<DutyState> = {}): DutyState => ({
  duty: { start_date: "2026-11-02", order: [A, B, C] },
  roster: [A, B, C].map((user_id) => ({ user_id, active: true, away_until: null })),
  overrides: new Map(),
  done: new Map(),
  today: "2026-11-10",
  ...over,
});
const plan = (days: Array<[string, string, Partial<DutyDay>?]>): DutyDay[] =>
  days.map(([day, user_id, o]) => ({ day, user_id, source: "rotation", done: false, request_id: null, skipped_user: null, ...o }));

describe("dates", () => {
  it("does day maths on strings", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(dayDiff("2026-11-18", "2026-11-09")).toBe(9);
    expect(isoDow("2026-11-09")).toBe(0); // Monday
    expect(isoDow("2026-11-15")).toBe(6);
    expect(weekStart("2026-11-12")).toBe("2026-11-09");
    expect(daysInMonth("2026-02")).toBe(28);
    expect(longDay("2026-11-18")).toBe("ср, 18 ноября");
    expect(monthTitle("2026-11")).toBe("Ноябрь 2026");
  });
});

describe("resolveDay", () => {
  it("rotates by (day - start) mod n", () => {
    const s = state();
    expect(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"].map((d) => resolveDay(s, d)?.user_id)).toEqual([A, B, C, A]);
    expect(resolveDay(s, "2026-11-01")).toBeNull(); // before the start
  });
  it("skips an away or inactive member from today on, the plain rotation stands for the past and when all are away", () => {
    const away = state({ roster: [{ user_id: A, active: true, away_until: null }, { user_id: B, active: true, away_until: "2026-11-12" }, { user_id: C, active: true, away_until: null }] });
    expect(resolveDay(away, "2026-11-12")).toMatchObject({ user_id: C, source: "skip", plain: B }); // B's day, B is away until the 12th
    expect(resolveDay(away, "2026-11-13")?.source).toBe("rotation");
    expect(resolveDay(away, "2026-11-09")).toMatchObject({ user_id: B, source: "rotation" }); // past: no skipping
    const inactive = state({ roster: [{ user_id: A, active: false, away_until: null }, { user_id: B, active: true, away_until: null }, { user_id: C, active: true, away_until: null }] });
    expect(resolveDay(inactive, "2026-11-11")).toMatchObject({ user_id: B, source: "skip", plain: A });
    const all = state({ roster: [A, B, C].map((user_id) => ({ user_id, active: true, away_until: "2026-12-31" })) });
    expect(resolveDay(all, "2026-11-11")).toMatchObject({ source: "rotation" });
  });
  it("an override wins, then a recorded done", () => {
    const s = state({ overrides: new Map([["2026-11-11", { user_id: C, source: "admin" as const }]]), done: new Map([["2026-11-10", C], ["2026-11-11", A]]) });
    expect(resolveDay(s, "2026-11-11")).toMatchObject({ user_id: C, source: "admin" });
    expect(resolveDay(s, "2026-11-10")).toMatchObject({ user_id: C, source: "rotation" });
  });
});

describe("swap deadline", () => {
  it("is the earlier day at 10:00 Almaty", () => {
    expect(swapExpiresAt("2026-11-18", "2026-11-17")).toBe("2026-11-17T05:00:00.000Z");
    expect(swapExpiresAt("2026-11-17", "2026-11-18")).toBe("2026-11-17T05:00:00.000Z");
  });
  it("a pending request past its deadline is effectively expired; the countdown picks the unit", () => {
    const now = Date.parse("2026-11-17T00:00:00Z");
    expect(effectiveStatus({ status: "pending", expires_at: "2026-11-17T05:00:00.000Z" }, now)).toBe("pending");
    expect(effectiveStatus({ status: "pending", expires_at: "2026-11-16T05:00:00.000Z" }, now)).toBe("expired");
    expect(effectiveStatus({ status: "accepted", expires_at: "2026-11-16T05:00:00.000Z" }, now)).toBe("accepted");
    expect(timeLeft("2026-11-17T05:00:00.000Z", now)).toEqual({ unit: "h", n: 5 });
    expect(timeLeft("2026-11-17T00:20:00.000Z", now)).toEqual({ unit: "m", n: 20 });
    expect(timeLeft("2026-11-19T05:00:00.000Z", now)).toEqual({ unit: "d", n: 3 });
    expect(timeLeft("2026-11-16T05:00:00.000Z", now)).toBeNull();
  });
});

describe("view models", () => {
  const p = plan([
    ["2026-11-09", B, { done: true, source: "swap" }],
    ["2026-11-10", A, { source: "swap" }],
    ["2026-11-11", C],
    ["2026-11-12", B, { source: "skip", skipped_user: A, request_id: "r" }],
    ["2026-11-13", A],
  ]);
  it("the week is Mon..Sun around today with the kinds, ticks and swap flags", () => {
    const w = buildWeek(p, "2026-11-10");
    expect(w.map((c) => c.date)).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
    expect(w.map((c) => c.kind)).toEqual(["past", "today", "future", "future", "future", "future", "future"]);
    expect(w[0]).toMatchObject({ done: true, swapped: true, user_id: B });
    expect(w[1]).toMatchObject({ swapped: true, user_id: A });
    expect(w[3]).toMatchObject({ skipped_user: A, pending: true });
    expect(w[6].user_id).toBeNull();
  });
  it("the month grid leads with empty cells for the weekday of the 1st", () => {
    const m = buildMonth(p, "2026-11", "2026-11-10");
    expect(m.lead).toBe(6); // 1 Nov 2026 is a Sunday
    expect(m.cells).toHaveLength(30);
    expect(m.cells[9]).toMatchObject({ date: "2026-11-10", kind: "today", user_id: A });
  });
  it("stats count done / total days per person within the month, in order", () => {
    expect(monthStats(p, "2026-11", [A, B, C])).toEqual([
      { user_id: A, done: 0, total: 2 },
      { user_id: B, done: 1, total: 2 },
      { user_id: C, done: 0, total: 1 },
    ]);
    expect(monthStats(p, "2026-12", [A])).toEqual([{ user_id: A, done: 0, total: 0 }]);
  });
  it("next days, labels and neighbours", () => {
    expect(nextDayOf(p, A, "2026-11-10")).toBe("2026-11-10");
    expect(nextDayOf(p, B, "2026-11-10")).toBe("2026-11-12");
    expect(nextDayOf(p, C, "2026-11-12")).toBeNull();
    expect(nextLabel("2026-11-10", "2026-11-10")).toBe("сегодня");
    expect(nextLabel("2026-11-11", "2026-11-10")).toBe("завтра");
    expect(nextLabel("2026-11-13", "2026-11-10")).toBe("пт, 13");
    expect(nextLabel(null, "2026-11-10")).toBe("—");
    // before: nothing ahead of day 10 that is not mine; after: day 11 is free
    expect(neighbours(p, "2026-11-10", A, "2026-11-10")).toEqual({ before: null, after: expect.objectContaining({ day: "2026-11-11" }) });
    // day 12 has a pending request and is left out
    expect(neighbours(p, "2026-11-13", A, "2026-11-10").before?.day).toBe("2026-11-11");
  });
  it("tones: me is lime, the others take the rest in order and wrap", () => {
    const t = toneMap(["me", "x", "y", "z", "w", "v", "u"], "me");
    expect(t.get("me")).toBe("lime");
    expect([...t.values()].slice(1, 6)).toEqual(["orange", "violet", "blue", "rose", "teal"]);
    expect(t.get("u")).toBe("orange");
  });
});
