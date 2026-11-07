import { describe, expect, it } from "vitest";
import { almatyDay, isMonthKey, shiftMonth } from "./almaty";

describe("almatyDay", () => {
  it("is UTC+5", () => {
    expect(almatyDay(new Date("2026-11-04T18:59:59Z"))).toEqual({ month: "2026-11", day: 4, date: "2026-11-04" });
    expect(almatyDay(new Date("2026-11-04T19:00:00Z"))).toEqual({ month: "2026-11", day: 5, date: "2026-11-05" });
  });
  it("rolls the month at local midnight", () => {
    expect(almatyDay(new Date("2026-11-30T18:59:59Z")).month).toBe("2026-11");
    expect(almatyDay(new Date("2026-11-30T19:00:00Z"))).toEqual({ month: "2026-12", day: 1, date: "2026-12-01" });
    expect(almatyDay(new Date("2026-12-31T19:00:00Z")).month).toBe("2027-01");
  });
});

describe("shiftMonth", () => {
  it("crosses year boundaries both ways", () => {
    expect(shiftMonth("2026-11", 1)).toBe("2026-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-03", -14)).toBe("2025-01");
    expect(shiftMonth("2026-05", 0)).toBe("2026-05");
  });
  it("validates keys", () => {
    expect(isMonthKey("2026-11")).toBe(true);
    expect(isMonthKey("2026-13")).toBe(false);
    expect(isMonthKey("26-11")).toBe(false);
  });
});
