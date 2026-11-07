import { describe, expect, it, vi } from "vitest";
import { applyBadge, badgeCount } from "./badge";

describe("badgeCount", () => {
  it("sums pending captures, incoming settlements and people I owe", () => {
    expect(badgeCount({ pending: 2, incoming: 1, owe: 3 })).toBe(6);
    expect(badgeCount({ pending: 0, incoming: 0, owe: 0 })).toBe(0);
  });
  it("ignores negative and non-finite values", () => {
    expect(badgeCount({ pending: -1, incoming: Number.NaN, owe: 2.9 })).toBe(2);
  });
});

describe("applyBadge", () => {
  it("sets the badge, clears at zero, and is a no-op without support", () => {
    const set = vi.fn(async () => undefined);
    const clear = vi.fn(async () => undefined);
    applyBadge(3, { setAppBadge: set, clearAppBadge: clear });
    applyBadge(0, { setAppBadge: set, clearAppBadge: clear });
    expect(set).toHaveBeenCalledWith(3);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(() => applyBadge(2, {})).not.toThrow();
    expect(() => applyBadge(2, undefined)).not.toThrow();
  });
  it("swallows a rejected promise", async () => {
    expect(() => applyBadge(1, { setAppBadge: () => Promise.reject(new Error("no")) })).not.toThrow();
    await Promise.resolve();
  });
});
