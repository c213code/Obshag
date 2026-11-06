import { describe, expect, it } from "vitest";
import { formatLocalPhone, maskKaspiPhone } from "./phoneFormat";
import { normalizePhone } from "./schemas";

describe("formatLocalPhone", () => {
  it("groups as 3-3-2-2 while typing", () => {
    expect(formatLocalPhone("7")).toBe("7");
    expect(formatLocalPhone("70012")).toBe("700 12");
    expect(formatLocalPhone("7001234567")).toBe("700 123 45 67");
  });
  it("drops a pasted country code and extra digits", () => {
    expect(formatLocalPhone("+7 700 123 45 67")).toBe("700 123 45 67");
    expect(formatLocalPhone("87001234567")).toBe("700 123 45 67");
  });
  it("round-trips through normalizePhone", () => {
    expect(normalizePhone(`+7${formatLocalPhone("7001234567")}`)).toBe("+77001234567");
  });
});

describe("maskKaspiPhone", () => {
  it("masks like the Pay mockup", () => {
    expect(maskKaspiPhone("+77001234567")).toBe("+7 7•• ••• 45 67");
  });
  it("is null without a usable number", () => {
    expect(maskKaspiPhone(null)).toBeNull();
    expect(maskKaspiPhone("123")).toBeNull();
  });
});
