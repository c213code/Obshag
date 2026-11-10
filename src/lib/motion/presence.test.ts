import { describe, expect, it } from "vitest";
import { mergeEntries, type PresenceEntry } from "./presence";

const entry = (key: string, extra: Partial<PresenceEntry<string>> = {}): PresenceEntry<string> => ({
  key,
  item: key,
  version: key,
  exiting: false,
  fresh: false,
  ...extra,
});
const id = (s: string) => s;

describe("mergeEntries", () => {
  it("marks a removed row as exiting and keeps it in place", () => {
    const out = mergeEntries([entry("a"), entry("b"), entry("c")], ["a", "c"], id);
    expect(out.map((e) => [e.key, e.exiting])).toEqual([
      ["a", false],
      ["b", true],
      ["c", false],
    ]);
  });

  it("marks a new row as fresh and leaves known rows as they were", () => {
    const out = mergeEntries([entry("a")], ["n", "a"], id);
    expect(out.map((e) => [e.key, e.fresh])).toEqual([
      ["n", true],
      ["a", false],
    ]);
  });

  it("keeps a trailing removed row", () => {
    const out = mergeEntries([entry("a"), entry("b")], ["a"], id);
    expect(out.map((e) => [e.key, e.exiting])).toEqual([
      ["a", false],
      ["b", true],
    ]);
  });
});
