import { describe, expect, it } from "vitest";
import { codeFromPath } from "./deepLink";

describe("codeFromPath", () => {
  it("decodes and caps the code", () => {
    expect(codeFromPath("KV42%20AB7K")).toBe("KV42 AB7K");
    expect(codeFromPath("A".repeat(100))).toHaveLength(64);
  });
  it("does not throw on a malformed escape", () => {
    expect(() => codeFromPath("%E0%A4%A")).not.toThrow();
    expect(codeFromPath("%E0%A4%A")).toBe("%E0%A4%A");
    expect(codeFromPath("%")).toBe("%");
  });
});
