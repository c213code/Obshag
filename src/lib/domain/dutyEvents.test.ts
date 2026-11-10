import { describe, expect, it } from "vitest";
import type { DutyEvent } from "@/lib/data/types";
import { cooldownLeft, currentOf, dative, instrumental, turnQueue, waterMonth, waterPlan, weekDoneCount, whenLabel } from "./dutyEvents";

const order = ["a", "b", "c"];
const roster = order.map((user_id) => ({ user_id, active: true, away_until: null as string | null }));
const ev = (kind: DutyEvent["kind"], user_id: string, at: string, over: Partial<DutyEvent> = {}): DutyEvent => ({
  id: at + user_id, duty_id: "d", kind, user_id, partner_id: null, liters: null, purchase_id: null, created_at: at, ...over,
});

describe("turn queue", () => {
  it("starts with the first, moves past the last carrier, skips away members", () => {
    expect(currentOf(order, roster, [], "2026-11-10")).toBe("a");
    expect(turnQueue(order, roster, [ev("done", "a", "2026-11-09T10:00:00Z")], "2026-11-10")).toEqual(["b", "c", "a"]);
    const away = roster.map((m) => (m.user_id === "b" ? { ...m, away_until: "2026-11-10" } : m));
    expect(currentOf(order, away, [ev("done", "a", "2026-11-09T10:00:00Z")], "2026-11-10")).toBe("c");
  });
  it("two carriers: walk from the actor, skip the whole trip; everybody away keeps the plain order", () => {
    expect(currentOf(order, roster, [ev("done", "a", "2026-11-09T10:00:00Z", { partner_id: "c" })], "2026-11-10")).toBe("b");
    const four = ["a", "p", "n", "e"];
    const r4 = four.map((user_id) => ({ user_id, active: true, away_until: null as string | null }));
    expect(currentOf(four, r4, [ev("done", "e", "2026-11-09T10:00:00Z", { partner_id: "a" })], "2026-11-10")).toBe("p");
    const four2 = ["e", "a", "p", "n"];
    const r42 = four2.map((user_id) => ({ user_id, active: true, away_until: null as string | null }));
    expect(currentOf(four2, r42, [ev("done", "e", "2026-11-09T10:00:00Z", { partner_id: "n" })], "2026-11-10")).toBe("a");
    const all = roster.map((m) => ({ ...m, away_until: "2026-12-01" }));
    expect(currentOf(order, all, [], "2026-11-10")).toBe("a");
  });
});

describe("water maths", () => {
  it("plans bottles, litres and tenge", () => {
    expect(waterPlan("alone", 5, 20)).toEqual({ bottles: 2, liters: 10, amount: 200 });
    expect(waterPlan("pair", 5, 20)).toEqual({ bottles: 4, liters: 20, amount: 400 });
  });
  it("sums the month, buckets weeks, counts carriers incl. partners", () => {
    const events = [
      ev("done", "a", "2026-11-02T10:00:00Z", { liters: 10 }),
      ev("done", "b", "2026-11-10T10:00:00Z", { liters: 20, partner_id: "a" }),
      ev("done", "c", "2026-10-30T10:00:00Z", { liters: 99 }),
    ];
    const m = waterMonth(events, "2026-11", 20, order);
    expect(m).toMatchObject({ liters: 30, amount: 600, carried: [{ user_id: "a", count: 2 }, { user_id: "b", count: 1 }] });
    expect(m.weeks).toEqual([0.5, 1, 0, 0]);
  });
});

describe("labels", () => {
  it("whenLabel, cooldowns, week count", () => {
    expect(whenLabel("2026-11-09T16:40:00Z", "2026-11-10")).toBe("вчера, 21:40");
    expect(whenLabel("2026-11-10T03:00:00Z", "2026-11-10")).toBe("сегодня, 08:00");
    expect(cooldownLeft([ev("ping", "a", "2026-11-10T10:00:00Z")], "ping", Date.parse("2026-11-10T11:00:00Z"))).toBe(3600);
    expect(cooldownLeft([], "empty", 0)).toBe(0);
    expect(weekDoneCount([ev("done", "a", "2026-11-09T10:00:00Z"), ev("done", "a", "2026-10-01T10:00:00Z")], "2026-11-10")).toBe(1);
  });
  it("names in dative / instrumental", () => {
    expect(dative("Айдос")).toBe("Айдосу");
    expect(dative("Дана")).toBe("Дане");
    expect(instrumental("Айдос")).toBe("Айдосом");
    expect(instrumental("Дана")).toBe("Даной");
  });
});
