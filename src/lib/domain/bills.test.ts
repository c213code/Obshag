import { describe, expect, it } from "vitest";
import type { Bill, Purchase, Share } from "@/lib/data/types";
import { billState, isDue, monthTotals } from "./bills";

const ME = "me";
const mk = (over: Partial<Bill>): Bill => ({
  id: "b1", household_id: "h", title: "Аренда", icon: "home", amount: 9000, variable: false, day_of_month: 5,
  payer_id: ME, last_generated_month: null, participants: [ME, "a", "b"], ...over,
});
const purchase = (bill: string, month: string, amount: number, settledCount: number): Purchase & { shares: Share[] } => ({
  id: `p-${bill}-${month}`, household_id: "h", payer_id: ME, amount, description: "x", merchant: null, source: "monthly", status: "shared",
  created_at: "2026-11-05T10:00:00Z", bill_id: bill, bill_month: month,
  shares: [ME, "a", "b"].map((d, i) => ({ purchase_id: "p", debtor_id: d, amount: amount / 3, settled_at: i < settledCount ? "t" : null, settlement_id: null })),
});
const today = { month: "2026-11", day: 10 };

describe("isDue", () => {
  it("is due from its day in the current month, always in the past, never in the future", () => {
    expect(isDue(mk({}), "2026-11", { month: "2026-11", day: 4 })).toBe(false);
    expect(isDue(mk({}), "2026-11", { month: "2026-11", day: 5 })).toBe(true);
    expect(isDue(mk({}), "2026-10", { month: "2026-11", day: 1 })).toBe(true);
    expect(isDue(mk({}), "2026-12", { month: "2026-11", day: 28 })).toBe(false);
  });
});

describe("billState", () => {
  it("reports the generated purchase with its progress", () => {
    expect(billState(mk({}), "2026-11", [purchase("b1", "2026-11", 9000, 2)], today)).toMatchObject({ kind: "generated", amount: 9000, settled: 2, total: 3 });
  });
  it("a due variable bill without an amount needs one, only in the current month", () => {
    const v = mk({ variable: true, amount: null });
    expect(billState(v, "2026-11", [], today)).toEqual({ kind: "needs_amount" });
    expect(billState(v, "2026-10", [], today)).toEqual({ kind: "idle", amount: null });
    expect(billState(v, "2026-11", [], { month: "2026-11", day: 2 })).toEqual({ kind: "idle", amount: null });
  });
  it("a fixed bill that is not generated yet shows its amount", () => {
    expect(billState(mk({ day_of_month: 20 }), "2026-11", [], today)).toEqual({ kind: "idle", amount: 9000 });
  });
});

describe("monthTotals", () => {
  it("adds known amounts and my part, skipping a variable bill with no amount", () => {
    const bills = [mk({ id: "b1", amount: 9000 }), mk({ id: "b2", variable: true, amount: null }), mk({ id: "b3", amount: 6000, participants: ["a", "b"] })];
    expect(monthTotals(bills, "2026-11", [], ME, today)).toEqual({ total: 15000, mine: 3000 });
  });
  it("uses the generated split of the month", () => {
    expect(monthTotals([mk({})], "2026-11", [purchase("b1", "2026-11", 9100, 1)], ME, today)).toEqual({ total: 9100, mine: 9100 / 3 });
  });
});
