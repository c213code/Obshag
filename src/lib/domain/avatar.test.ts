import { describe, expect, it } from "vitest";
import { AVATAR_COLORS, pickAvatarColor } from "./avatar";

describe("pickAvatarColor", () => {
  it("is deterministic and always a person color", () => {
    expect(pickAvatarColor("abc")).toBe(pickAvatarColor("abc"));
    for (const s of ["", "a", "00000000-0000-4000-8000-000000000009", "Ерасыл"]) {
      expect(AVATAR_COLORS).toContain(pickAvatarColor(s));
    }
  });
  it("uses more than one color across ids", () => {
    const set = new Set(Array.from({ length: 30 }, (_, i) => pickAvatarColor(`user-${i}`)));
    expect(set.size).toBeGreaterThan(1);
  });
});
