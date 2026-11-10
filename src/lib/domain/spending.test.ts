import { describe, expect, it } from "vitest";
import { myShare, spendingSummary, type SpendPurchase } from "./spending";

const me = "me";
const p = (over: Partial<SpendPurchase>): SpendPurchase => ({
  payer_id: "x",
  status: "shared",
  amount: 1000,
  created_at: "2026-11-10T08:00:00Z",
  shares: [{ debtor_id: me, amount: 400 }],
  ...over,
});
// Tuesday 10 Nov 2026 (Almaty); weeks start on Mondays: 9 Nov, 2 Nov, 26 Oct, ... 5 Oct
const now = new Date("2026-11-10T08:00:00Z");

describe("myShare", () => {
  it("uses my share, ignores pending and others' personal purchases", () => {
    expect(myShare(p({}), me)).toBe(400);
    expect(myShare(p({ status: "pending" }), me)).toBe(0);
    expect(myShare(p({ status: "personal", payer_id: me, shares: [] }), me)).toBe(1000);
    expect(myShare(p({ status: "personal", shares: [] }), me)).toBe(0);
    expect(myShare(p({ shares: [] }), me)).toBe(0);
  });
});

describe("spendingSummary", () => {
  it("puts the current week last and sums the month", () => {
    const r = spendingSummary(
      [p({}), p({ created_at: "2026-11-02T08:00:00Z" }), p({ created_at: "2026-11-01T08:00:00Z" }), p({ created_at: "2026-10-05T08:00:00Z" })],
      me,
      now,
    );
    // Oct 5 -> five weeks ago, Nov 1 (Sunday) -> two weeks ago, Nov 2 -> last week, Nov 10 -> this week
    expect(r.weeks).toEqual([400, 0, 0, 400, 400, 400]);
    expect(r.month).toBe(1200);
  });
  it("drops weeks older than the window", () => {
    const r = spendingSummary([p({ created_at: "2026-08-01T08:00:00Z" })], me, now);
    expect(r.weeks.every((w) => w === 0)).toBe(true);
    expect(r.month).toBe(0);
  });
  it("uses the Almaty day at the month edge", () => {
    // 2026-10-31 20:00Z is 01:00 on Nov 1 in Almaty
    expect(spendingSummary([p({ created_at: "2026-10-31T20:00:00Z" })], me, now).month).toBe(400);
  });
});
