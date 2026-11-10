import { describe, expect, it } from "vitest";
import type { Bill } from "@/lib/data/types";
import { nextBill } from "./nextBill";

const bill = (over: Partial<Bill>): Bill => ({
  id: "b",
  household_id: "h",
  title: "Аренда",
  icon: "home",
  amount: 300000,
  variable: false,
  day_of_month: 5,
  payer_id: "p",
  last_generated_month: null,
  participants: ["me", "a", "b"],
  ...over,
});

describe("nextBill", () => {
  it("none without bills", () => expect(nextBill([], { month: "2026-11", day: 10 }, "me")).toBeNull());
  it("rolls to next month once the day has passed, and splits my part", () => {
    const r = nextBill([bill({})], { month: "2026-11", day: 10 }, "me");
    expect(r).toMatchObject({ month: "2026-12", day: 5, mine: 100000 });
  });
  it("picks the nearest; today counts", () => {
    const r = nextBill([bill({ id: "x", day_of_month: 3 }), bill({ id: "y", day_of_month: 12 }), bill({ id: "z", day_of_month: 10 })], { month: "2026-11", day: 10 }, "me");
    expect(r?.bill.id).toBe("z");
    expect(r?.month).toBe("2026-11");
  });
  it("unknown amount has no share", () => {
    expect(nextBill([bill({ amount: null, variable: true })], { month: "2026-11", day: 1 }, "me")?.mine).toBeNull();
  });
});
