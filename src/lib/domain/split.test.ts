import { describe, expect, it } from "vitest";
import { splitEqual } from "./split";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `u${i + 1}`);
const sum = (xs: ReadonlyArray<{ amount: number }>) => xs.reduce((s, x) => s + x.amount, 0);

describe("splitEqual", () => {
  it("splits 6000 among 4 into 1500 each, payer's own share settled", () => {
    const shares = splitEqual(6000, ids(4), "u1");
    expect(shares.map((s) => s.amount)).toEqual([1500, 1500, 1500, 1500]);
    expect(shares.map((s) => s.settled)).toEqual([true, false, false, false]);
  });

  it("gives the remainder 1 tenge at a time to non-payers in member order", () => {
    // 1000 / 3 -> base 333, remainder 1 -> first non-payer
    const shares = splitEqual(1000, ["a", "b", "c"], "a");
    expect(shares).toEqual([
      { debtor_id: "a", amount: 333, settled: true },
      { debtor_id: "b", amount: 334, settled: false },
      { debtor_id: "c", amount: 333, settled: false },
    ]);
  });

  it("skips the payer when handing out the remainder wherever the payer sits", () => {
    const shares = splitEqual(1001, ["a", "b", "c", "d"], "b"); // base 250, remainder 1
    expect(shares.map((s) => [s.debtor_id, s.amount])).toEqual([
      ["a", 251],
      ["b", 250],
      ["c", 250],
      ["d", 250],
    ]);
    const two = splitEqual(1002, ["a", "b", "c", "d"], "a"); // remainder 2 -> b, c
    expect(two.map((s) => s.amount)).toEqual([250, 251, 251, 250]);
  });

  it("works when the payer is not a participant: everyone listed owes", () => {
    const shares = splitEqual(100, ["a", "b", "c"], "z");
    expect(shares.map((s) => s.amount)).toEqual([34, 33, 33]);
    expect(shares.every((s) => !s.settled)).toBe(true);
    expect(sum(shares)).toBe(100);
  });

  it("handles a payer who is the only participant", () => {
    expect(splitEqual(500, ["a"], "a")).toEqual([{ debtor_id: "a", amount: 500, settled: true }]);
  });

  it("rejects invalid input", () => {
    expect(() => splitEqual(0, ["a"], "a")).toThrow(RangeError);
    expect(() => splitEqual(-5, ["a"], "a")).toThrow(RangeError);
    expect(() => splitEqual(10.5, ["a"], "a")).toThrow(RangeError);
    expect(() => splitEqual(100, [], "a")).toThrow(RangeError);
    expect(() => splitEqual(100, ["a", "a"], "a")).toThrow(RangeError);
  });

  it("property: sums to amount, spread <= 1, deterministic, payer settled (all amounts and sizes)", () => {
    for (let n = 1; n <= 9; n++) {
      for (const amount of [1, 2, 3, 7, 99, 100, 101, 1000, 1001, 6000, 9_999_999, 10_000_000]) {
        for (const payerIndex of [0, n - 1, -1]) {
          const members = ids(n);
          const payer = payerIndex === -1 ? "outsider" : members[payerIndex];
          const a = splitEqual(amount, members, payer);
          expect(sum(a)).toBe(amount);
          const amounts = a.map((s) => s.amount);
          expect(Math.max(...amounts) - Math.min(...amounts)).toBeLessThanOrEqual(1);
          expect(splitEqual(amount, members, payer)).toEqual(a);
          expect(a.filter((s) => s.settled).map((s) => s.debtor_id)).toEqual(members.filter((m) => m === payer));
          expect(a.map((s) => s.debtor_id)).toEqual(members);
        }
      }
    }
  });
});
