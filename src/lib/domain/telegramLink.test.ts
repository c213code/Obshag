import { describe, expect, it } from "vitest";
import { telegramLink } from "./telegramLink";

describe("telegramLink", () => {
  it("builds the start deep link and encodes the code", () => {
    expect(telegramLink("abc_DEF-123456789012")).toBe("https://t.me/obshagk_bot?start=abc_DEF-123456789012");
    expect(telegramLink("a b/c", "my_bot")).toBe("https://t.me/my_bot?start=a%20b%2Fc");
  });
  it("falls back to the default bot for an invalid or missing name", () => {
    expect(telegramLink("x", "bad name")).toContain("/obshagk_bot?");
    expect(telegramLink("x", undefined)).toContain("/obshagk_bot?");
    expect(telegramLink("x", "")).toContain("/obshagk_bot?");
  });
});
