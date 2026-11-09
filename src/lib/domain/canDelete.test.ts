import { describe, expect, it } from "vitest";
import { canDelete } from "./canDelete";

const P = { payer_id: "a", status: "shared", household_id: "h" };
const roster = [
  { user_id: "a", role: "member", active: true },
  { user_id: "b", role: "admin", active: true },
  { user_id: "c", role: "member", active: true },
  { user_id: "d", role: "admin", active: false },
];

describe("canDelete", () => {
  it("lets the payer delete any of their purchases", () => {
    expect(canDelete(P, "a", roster)).toBe(true);
    expect(canDelete({ ...P, status: "personal" }, "a", roster)).toBe(true);
  });
  it("lets an active admin delete someone else's shared purchase only", () => {
    expect(canDelete(P, "b", roster)).toBe(true);
    expect(canDelete({ ...P, status: "pending" }, "b", roster)).toBe(false);
    expect(canDelete({ ...P, status: "personal" }, "b", roster)).toBe(false);
  });
  it("refuses plain members, inactive admins and unknown rosters", () => {
    expect(canDelete(P, "c", roster)).toBe(false);
    expect(canDelete(P, "d", roster)).toBe(false);
    expect(canDelete(P, "b", undefined)).toBe(false);
  });
});
