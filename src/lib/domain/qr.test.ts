import { describe, expect, it } from "vitest";
import { qrPath } from "./qr";

describe("qrPath", () => {
  it("encodes a join link into a square symbol with finder patterns", async () => {
    const { size, d } = await qrPath("https://obshak.test/join/KV42AB7K9M3X");
    expect(size).toBeGreaterThanOrEqual(21);
    expect((size - 17) % 4).toBe(0); // QR sizes are 21, 25, 29, ...
    expect(d.startsWith("M0 0h7")).toBe(true); // the top-left finder pattern starts with a 7-module bar
    expect(d).toMatch(/^[Mhvz0-9 -]+$/);
  });
  it("is deterministic and depends on the text", async () => {
    expect((await qrPath("a")).d).toBe((await qrPath("a")).d);
    expect((await qrPath("a")).d).not.toBe((await qrPath("b")).d);
  });
});
