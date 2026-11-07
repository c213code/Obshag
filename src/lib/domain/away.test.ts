import { describe, expect, it } from "vitest";
import { defaultParticipants, isAway } from "./away";

describe("isAway", () => {
  it("is inclusive of the last day", () => {
    expect(isAway("2026-11-14", "2026-11-14")).toBe(true);
    expect(isAway("2026-11-14", "2026-11-15")).toBe(false);
    expect(isAway(null, "2026-11-14")).toBe(false);
    expect(isAway(undefined, "2026-11-14")).toBe(false);
  });
});

describe("defaultParticipants", () => {
  const roster = [
    { user_id: "a", away_until: null },
    { user_id: "b", away_until: "2026-11-20" },
    { user_id: "c", away_until: "2026-11-01" },
  ];
  it("leaves away members out", () => {
    expect(defaultParticipants(roster, "2026-11-10")).toEqual(["a", "c"]);
  });
  it("falls back to everyone when nobody is home", () => {
    expect(defaultParticipants([{ user_id: "b", away_until: "2026-11-20" }], "2026-11-10")).toEqual(["b"]);
    expect(defaultParticipants([], "2026-11-10")).toEqual([]);
  });
});
