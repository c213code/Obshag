import { describe, expect, it } from "vitest";
import { inviteCodeSchema } from "./schemas";
import { formatInviteCode } from "./inviteCode";

describe("formatInviteCode", () => {
  it("groups by four with dashes", () => {
    expect(formatInviteCode("7kq29pxa4m1c")).toBe("7KQ2-9PXA-4M1C");
    expect(formatInviteCode("ABCDEFGHJK")).toBe("ABCD-EFGH-JK");
    expect(formatInviteCode("")).toBe("");
  });
  it("round-trips through the join schema (dashes are ignored when typed back)", () => {
    expect(inviteCodeSchema.parse(formatInviteCode("7KQ29PXA4M1C"))).toBe("7KQ29PXA4M1C");
  });
});
