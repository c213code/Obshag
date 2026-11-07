import { describe, expect, it } from "vitest";
import { MAX_AMOUNT, parseAmount } from "./parseAmount";

describe("parseAmount", () => {
  const ok: Array<[string | number, number]> = [
    ["6 000,00 ₸", 6000],
    ["6 000 ₸", 6000],
    ["6 000 ₸", 6000],
    ["6 000 ₸", 6000],
    ["6 000 ₸", 6000],
    ["₸6,000.00", 6000],
    ["KZT 6,000.00", 6000],
    ["kzt 6000", 6000],
    ["6000", 6000],
    [6000, 6000],
    ["6000.5", 6001],
    ["6000.49", 6000],
    ["6000,5", 6001],
    ["1 234 567,89", 1234568],
    ["1,234,567.89", 1234568],
    ["1.234.567,89", 1234568],
    ["1,234", 1234],
    ["1.234", 1234],
    ["  250  ", 250],
    ["0,5", 1],
    [10_000_000, 10_000_000],
    ["10 000 000,00 ₸", 10_000_000],
    [1499.5, 1500],
  ];
  it.each(ok)("accepts %j -> %d", (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });

  const bad: Array<unknown> = ["", "   ", "abc", "₸", "0", 0, "0,00", "-5", -5, "-6 000 ₸", "10 000 001", 10_000_001, NaN, Infinity, "1e9", "12abc", "1,2,3x", null, undefined, {}, "0,4", "6 000 000 000 000 000"];
  it.each(bad.map((b) => [b]))("rejects %j", (input) => {
    expect(parseAmount(input)).toBeNull();
  });

  it("caps at MAX_AMOUNT", () => {
    expect(MAX_AMOUNT).toBe(10_000_000);
  });
});
