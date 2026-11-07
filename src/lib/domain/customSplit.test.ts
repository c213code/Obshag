import { describe, expect, it } from "vitest";
import { customSplit, parseAmountText, sanitizeAmountText } from "./customSplit";

describe("amount text", () => {
  it("keeps digits only, caps the length, drops leading zeros", () => {
    expect(sanitizeAmountText("2 000 ₸")).toBe("2000");
    expect(sanitizeAmountText("abc")).toBe("");
    expect(sanitizeAmountText("007")).toBe("7");
    expect(sanitizeAmountText("0")).toBe("0");
    expect(sanitizeAmountText("123456789")).toBe("12345678");
    expect(sanitizeAmountText("-5.5")).toBe("55");
  });
  it("parses an empty field as zero", () => {
    expect(parseAmountText("")).toBe(0);
    expect(parseAmountText("1 500")).toBe(1500);
  });
});

describe("customSplit", () => {
  const ids = ["me", "a", "b"];
  it("6000 = 3000/2000/1000 is ready with nothing left", () => {
    const s = customSplit(6000, ids, { me: "3000", a: "2000", b: "1000" }, "me");
    expect(s).toMatchObject({ sum: 6000, remaining: 0, hasOther: true, ready: true });
    expect(s.entries).toEqual([{ user_id: "me", amount: 3000 }, { user_id: "a", amount: 2000 }, { user_id: "b", amount: 1000 }]);
  });
  it("reports what is left and what is too much", () => {
    expect(customSplit(6000, ids, { me: "3000", a: "2000" }, "me")).toMatchObject({ remaining: 1000, ready: false });
    expect(customSplit(6000, ids, { me: "3000", a: "2000", b: "1500" }, "me")).toMatchObject({ remaining: -500, ready: false });
  });
  it("needs a total and someone besides the payer", () => {
    expect(customSplit(null, ids, {}, "me").ready).toBe(false);
    expect(customSplit(0, [], {}, "me").ready).toBe(false);
    expect(customSplit(1000, ["me"], { me: "1000" }, "me")).toMatchObject({ remaining: 0, hasOther: false, ready: false });
  });
  it("allows a zero amount for a picked person", () => {
    expect(customSplit(1000, ["me", "a", "b"], { a: "1000" }, "me").ready).toBe(true);
  });
});
