import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { newCaptureToken, sha256Hex } from "./hash";

describe("hash", () => {
  it("sha256Hex equals node's sha256 hex (also for non-ASCII)", async () => {
    for (const text of ["abc", "", "Покупка ₸"]) {
      expect(await sha256Hex(text)).toBe(createHash("sha256").update(text).digest("hex"));
    }
  });
  it("newCaptureToken is 43 base64url characters and unique", () => {
    const a = newCaptureToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newCaptureToken()).not.toBe(a);
  });
});
