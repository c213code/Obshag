import { describe, expect, it } from "vitest";
import { MIN_TRANSFER, isAccumulating, isTransferable } from "./minTransfer";

describe("MIN_TRANSFER thresholds", () => {
  it("is 100", () => expect(MIN_TRANSFER).toBe(100));
  it.each([
    [0, false, false],
    [-5, false, false],
    [1, true, false],
    [75, true, false],
    [99, true, false],
    [100, false, true],
    [101, false, true],
    [Number.NaN, false, false],
  ])("net %s: accumulating=%s transferable=%s", (net, acc, tr) => {
    expect(isAccumulating(net)).toBe(acc);
    expect(isTransferable(net)).toBe(tr);
  });
});
