import { describe, expect, it } from "vitest";
import { filterPurchases, groupByDay } from "./purchaseList";

const sh = (debtor: string, settled = false) => ({ purchase_id: "x", debtor_id: debtor, amount: 100, settled_at: settled ? "t" : null, settlement_id: null });
const p = (id: string, payer: string, created_at: string, shares = [sh("me", true)], status: "shared" | "personal" | "pending" = "shared") => ({
  id,
  payer_id: payer,
  status,
  created_at,
  shares,
});

describe("filterPurchases", () => {
  const list = [
    p("a", "me", "2026-11-07T10:00:00", [sh("me", true), sh("b")]),
    p("b", "b", "2026-11-06T10:00:00", [sh("b", true), sh("me")]),
    p("c", "b", "2026-11-05T10:00:00", [sh("b", true), sh("me", true)]),
    p("d", "me", "2026-11-04T10:00:00", [], "personal"),
    p("e", "me", "2026-11-03T10:00:00", [], "pending"),
  ];
  it("all hides pending only", () => expect(filterPurchases(list, "all", "me").map((x) => x.id)).toEqual(["a", "b", "c", "d"]));
  it("mine = I paid", () => expect(filterPurchases(list, "mine", "me").map((x) => x.id)).toEqual(["a", "d"]));
  it("owe = someone else paid and my share is open", () => expect(filterPurchases(list, "owe", "me").map((x) => x.id)).toEqual(["b"]));
});

describe("groupByDay", () => {
  it("groups by local day keeping order", () => {
    const now = new Date(2026, 10, 7, 12);
    const items = [
      { created_at: new Date(2026, 10, 7, 18).toISOString(), id: 1 },
      { created_at: new Date(2026, 10, 7, 9).toISOString(), id: 2 },
      { created_at: new Date(2026, 10, 6, 20).toISOString(), id: 3 },
      { created_at: new Date(2026, 10, 1, 8).toISOString(), id: 4 },
    ];
    const g = groupByDay(items, now);
    expect(g.map((x) => [x.kind, x.items.map((i) => i.id)])).toEqual([
      ["today", [1, 2]],
      ["yesterday", [3]],
      ["other", [4]],
    ]);
  });
  it("empty in, empty out", () => expect(groupByDay([])).toEqual([]));
});
