import { describe, expect, it } from "vitest";
import { cleanOrders, deriveEqual, draftsToOrders, orderSplit, ordersToDrafts } from "./orders";

const [A, B, V, G] = ["a", "b", "v", "g"];

describe("orderSplit (mirror of 0016)", () => {
  it("3000, four people, Г orders 500: 625 / 625 / 625 / 1125", () => {
    const r = orderSplit(3000, [A, B, V, G], [{ user_id: G, amount: 500 }], A);
    expect(r.issue).toBeNull();
    expect(r.rest).toBe(2500);
    expect(r.shares).toEqual([
      { debtor_id: A, amount: 625, settled: true },
      { debtor_id: B, amount: 625, settled: false },
      { debtor_id: V, amount: 625, settled: false },
      { debtor_id: G, amount: 1125, settled: false },
    ]);
    expect(r.each).toEqual({ min: 625, max: 625 });
  });
  it("the remainder goes to non-payers in order, like splitEqual", () => {
    const r = orderSplit(1000, [A, B, V, G], [{ user_id: G, amount: 1 }], A);
    expect(r.shares.map((s) => s.amount)).toEqual([249, 250, 250, 251]);
    expect(r.each).toEqual({ min: 249, max: 250 });
  });
  it("a person outside the participants owes only the order; orders of one person add up", () => {
    const r = orderSplit(2000, [A, B], [{ user_id: G, amount: 300 }, { user_id: G, amount: 200 }], A);
    expect(r.shares).toEqual([
      { debtor_id: A, amount: 750, settled: true },
      { debtor_id: B, amount: 750, settled: false },
      { debtor_id: G, amount: 500, settled: false },
    ]);
  });
  it("shares always add up to the total", () => {
    const r = orderSplit(7777, [A, B, V], [{ user_id: G, amount: 333 }, { user_id: B, amount: 12 }], A);
    expect(r.shares.reduce((s, x) => s + x.amount, 0)).toBe(7777);
  });
  it("issues", () => {
    expect(orderSplit(3000, [A, B], [{ user_id: A, amount: 5 }], A).issue).toBe("payer");
    expect(orderSplit(1000, [A, B, V, G], [{ user_id: G, amount: 998 }], A).issue).toBe("rest_small");
    expect(orderSplit(1000, [A, B], [{ user_id: G, amount: 1000 }], A).issue).toBe("too_big");
    expect(orderSplit(1000, [], [{ user_id: G, amount: 1 }], A).issue).toBe("no_participants");
    expect(orderSplit(1000, [A, B], Array.from({ length: 21 }, () => ({ user_id: G, amount: 1 })), A).issue).toBe("too_many");
  });
});

describe("cleanOrders", () => {
  it("drops unfinished rows and trims notes", () => {
    expect(cleanOrders([{ user_id: G, amount: 500, note: "  чипсы " }, { user_id: G, amount: 0 }, { user_id: "", amount: 4 }, { user_id: B, amount: 3, note: " " }])).toEqual([
      { user_id: G, amount: 500, note: "чипсы" },
      { user_id: B, amount: 3, note: null },
    ]);
  });
});

describe("order drafts", () => {
  it("parses amounts, trims notes and flags unfinished rows", () => {
    const r = draftsToOrders([
      { key: "1", user_id: G, amount: "1 500", note: " чипсы " },
      { key: "2", user_id: null, amount: "300", note: "" },
      { key: "3", user_id: B, amount: "", note: "" },
    ]);
    expect(r.orders).toEqual([{ user_id: G, amount: 1500, note: "чипсы" }]);
    expect(r.incomplete).toBe(true);
    expect(draftsToOrders([]).incomplete).toBe(false);
  });
  it("round-trips an existing purchase", () => {
    const drafts = ordersToDrafts([{ user_id: G, amount: 500, note: "сок" }]);
    expect(draftsToOrders(drafts).orders).toEqual([{ user_id: G, amount: 500, note: "сок" }]);
  });
});

describe("deriveEqual", () => {
  const split = (total: number, who: string[], orders: Array<{ user_id: string; amount: number }>) =>
    orderSplit(total, who, orders, A).shares.map((s) => ({ debtor_id: s.debtor_id, amount: s.amount }));
  it("recognises an equal split with orders and returns participants (payer first) and orders", () => {
    const orders = [{ user_id: G, amount: 500, note: "сок" }];
    const r = deriveEqual({ payer_id: A, amount: 3000, shares: split(3000, [A, B, V, G], orders), orders });
    expect(r?.participants).toEqual([A, B, V, G]);
    expect(r?.orders).toEqual([{ user_id: G, amount: 500, note: "сок" }]);
  });
  it("an order-only person is not a participant", () => {
    const orders = [{ user_id: G, amount: 500 }];
    expect(deriveEqual({ payer_id: A, amount: 2000, shares: split(2000, [A, B], orders), orders })?.participants).toEqual([A, B]);
  });
  it("a remainder split is recognised, свои суммы are not", () => {
    expect(deriveEqual({ payer_id: A, amount: 1000, shares: split(1000, [A, B, V, G], []), orders: [] })).not.toBeNull();
    expect(deriveEqual({ payer_id: A, amount: 6000, shares: [{ debtor_id: A, amount: 1000 }, { debtor_id: B, amount: 2000 }, { debtor_id: V, amount: 3000 }] })).toBeNull();
  });
});
