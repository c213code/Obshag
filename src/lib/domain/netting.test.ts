import { describe, expect, it } from "vitest";
import type { Share as NetShare } from "@/lib/data/types";
import { coveredShares, isInFlight, isStale, markCovered, netForUser, netPair, pairShares, withoutInFlight, type NetPurchase } from "./netting";

const T0 = "2026-11-03T10:00:00.000Z";
const T1 = "2026-11-03T11:00:00.000Z";
const T2 = "2026-11-03T12:00:00.000Z";

const purchase = (id: string, payer_id: string, created_at = T0, status: NetPurchase["status"] = "shared", description = id): NetPurchase => ({
  id,
  payer_id,
  status,
  description,
  created_at,
});
const share = (purchase_id: string, debtor_id: string, amount: number, settled = false): NetShare => ({
  purchase_id,
  debtor_id,
  amount,
  settled_at: settled ? T0 : null,
  settlement_id: null,
});

describe("netPair", () => {
  it("2000 vs 1800: I pay 200 and both sides list their items", () => {
    const purchases = [purchase("a", "aidos", T0, "shared", "Хлеб"), purchase("b", "me", T0, "shared", "Картошка"), purchase("c", "aidos", T0, "shared", "Интернет")];
    const shares = [share("a", "me", 600), share("c", "me", 1400), share("b", "aidos", 1800)];
    const n = netPair("me", "aidos", shares, purchases);
    expect(n).toMatchObject({ iOwe: 2000, theyOwe: 1800, net: 200, direction: "i_pay" });
    expect(n.myItems.map((i) => [i.description, i.amount])).toEqual([
      ["Интернет", 1400],
      ["Хлеб", 600],
    ]);
    expect(n.theirItems.map((i) => [i.description, i.amount])).toEqual([["Картошка", 1800]]);
  });

  it("zero net is even", () => {
    const purchases = [purchase("a", "aidos"), purchase("b", "me")];
    const n = netPair("me", "aidos", [share("a", "me", 500), share("b", "aidos", 500)], purchases);
    expect(n).toMatchObject({ iOwe: 500, theyOwe: 500, net: 0, direction: "even" });
  });

  it("nothing at all is even with empty lists", () => {
    expect(netPair("me", "aidos", [], [])).toEqual({ iOwe: 0, theyOwe: 0, net: 0, direction: "even", myItems: [], theirItems: [] });
  });

  it("the reverse direction: they pay me", () => {
    const purchases = [purchase("a", "me"), purchase("b", "aidos")];
    const n = netPair("me", "aidos", [share("a", "aidos", 2000), share("b", "me", 1800)], purchases);
    expect(n).toMatchObject({ iOwe: 1800, theyOwe: 2000, net: 200, direction: "they_pay" });
  });

  it("mixes several purchases and ignores settled shares, the payer's own share, other people and personal purchases", () => {
    const purchases = [
      purchase("a", "aidos"),
      purchase("b", "aidos"),
      purchase("c", "me"),
      purchase("p", "aidos", T0, "personal"),
      purchase("pending", "aidos", T0, "pending"),
      purchase("d", "danya"),
    ];
    const shares = [
      share("a", "me", 700),
      share("b", "me", 900, true), // settled
      share("a", "aidos", 700), // the payer's own share
      share("c", "aidos", 300),
      share("p", "me", 5000), // personal
      share("pending", "me", 5000), // not shared yet
      share("d", "me", 800), // somebody else
      share("zzz", "me", 123), // unknown purchase
    ];
    const n = netPair("me", "aidos", shares, purchases);
    expect(n).toMatchObject({ iOwe: 700, theyOwe: 300, net: 400, direction: "i_pay" });
  });
});

describe("netForUser", () => {
  it("lists counterparties with a non-zero net, sorted by size, with totals", () => {
    const purchases = [purchase("a", "aidos"), purchase("b", "me"), purchase("c", "danya"), purchase("d", "me"), purchase("e", "nurik")];
    const shares = [
      share("a", "me", 2000),
      share("b", "aidos", 1800), // aidos: I pay 200
      share("c", "me", 1000), // danya: I pay 1000
      share("d", "nurik", 500),
      share("e", "me", 500), // nurik: even
    ];
    const r = netForUser("me", shares, purchases);
    expect(r.counterparties.map((c) => [c.userId, c.net, c.direction])).toEqual([
      ["danya", 1000, "i_pay"],
      ["aidos", 200, "i_pay"],
    ]);
    expect(r).toMatchObject({ owe: 1200, owed: 0, total: -1200 });
  });

  it("splits owed and owe and signs the total from my point of view", () => {
    const purchases = [purchase("a", "me"), purchase("b", "aidos")];
    const shares = [share("a", "danya", 1500), share("a", "nurik", 1500), share("b", "me", 500)];
    const r = netForUser("me", shares, purchases);
    expect(r.owed).toBe(3000);
    expect(r.owe).toBe(500);
    expect(r.total).toBe(2500);
  });

  it("stays consistent with the slice 1 balance: total equals owed - owe of the gross debts", () => {
    const purchases = [purchase("a", "me"), purchase("b", "aidos")];
    const shares = [share("a", "aidos", 2000), share("b", "me", 1800), share("a", "danya", 100)];
    const r = netForUser("me", shares, purchases);
    expect(r.total).toBe(2000 + 100 - 1800);
  });

  it("is empty with nothing open", () => {
    expect(netForUser("me", [], [])).toEqual({ counterparties: [], owe: 0, owed: 0, total: 0 });
  });
});

describe("netForUser with departed neighbours", () => {
  it("keeps counting them in the totals but flags them inactive", () => {
    const purchases = [purchase("a", "aidos"), purchase("b", "gone")];
    const shares = [share("a", "me", 500), share("b", "me", 700)];
    const r = netForUser("me", shares, purchases, (id) => id !== "gone");
    expect(r.counterparties.map((c) => [c.userId, c.active])).toEqual([
      ["gone", false],
      ["aidos", true],
    ]);
    expect(r.owe).toBe(1200);
  });

  it("everyone is active when no filter is given", () => {
    const r = netForUser("me", [share("a", "me", 5)], [purchase("a", "aidos")]);
    expect(r.counterparties[0].active).toBe(true);
  });
});

describe("pairShares", () => {
  it("is the exact set a mark records: open shares of shared purchases between the pair, both directions", () => {
    const purchases = [purchase("a", "aidos"), purchase("b", "me"), purchase("c", "danya"), purchase("p", "aidos", T0, "pending")];
    const shares = [share("a", "me", 100), share("b", "aidos", 200), share("c", "me", 300), share("p", "me", 400), share("a", "danya", 50, true)];
    expect(pairShares("me", "aidos", shares, purchases)).toEqual([
      { purchase_id: "a", debtor_id: "me", amount: 100 },
      { purchase_id: "b", debtor_id: "aidos", amount: 200 },
    ]);
  });
});

describe("coveredShares (the recorded set)", () => {
  const settlement = { id: "s1", covered: [{ purchase_id: "a", debtor_id: "me", amount: 100 }, { purchase_id: "b", debtor_id: "aidos", amount: 200 }] };

  it("returns exactly the recorded shares, nothing else between the pair", () => {
    const purchases = [purchase("a", "aidos", T0), purchase("b", "me", T1), purchase("c", "aidos", T2)];
    const shares = [share("a", "me", 100), share("b", "aidos", 200), share("c", "me", 300), share("a", "danya", 50)];
    expect(coveredShares(settlement, shares, purchases).map((s) => [s.purchase_id, s.debtor_id])).toEqual([
      ["a", "me"],
      ["b", "aidos"],
    ]);
  });

  it("a purchase committed late is not covered even when its created_at looks older", () => {
    const purchases = [purchase("a", "aidos", T2), purchase("b", "me", T0), purchase("late", "aidos", T0)];
    const shares = [share("a", "me", 100), share("b", "aidos", 200), share("late", "me", 300)];
    expect(coveredShares(settlement, shares, purchases).map((s) => s.purchase_id)).toEqual(["a", "b"]);
  });

  it("skips shares that are settled or whose purchase is no longer shared", () => {
    const purchases = [purchase("a", "aidos", T0, "personal"), purchase("b", "me")];
    expect(coveredShares(settlement, [share("a", "me", 100), share("b", "aidos", 200, true)], purchases)).toEqual([]);
  });
});

describe("isStale", () => {
  const settlement = { covered: [{ purchase_id: "a", debtor_id: "me", amount: 100 }] };
  const purchases = [purchase("a", "aidos")];

  it("is fresh while every recorded share is open, unchanged and shared", () => {
    expect(isStale(settlement, [share("a", "me", 100), share("z", "me", 5)], purchases)).toBe(false);
  });

  it.each([
    ["deleted", [], purchases],
    ["settled", [share("a", "me", 100, true)], purchases],
    ["amount changed", [share("a", "me", 90)], purchases],
    ["no longer shared", [share("a", "me", 100)], [purchase("a", "aidos", T0, "personal")]],
  ] as const)("is stale when a recorded share was %s", (_n, shares, ps) => {
    expect(isStale(settlement, shares, ps)).toBe(true);
  });

  it("an empty record is stale", () => {
    expect(isStale({ covered: [] }, [], [])).toBe(true);
  });
});

describe("markCovered", () => {
  it("settles only the recorded shares and leaves the rest untouched", () => {
    const purchases = [purchase("a", "aidos", T0), purchase("late", "aidos", T0)];
    const shares = [share("a", "me", 100), share("late", "me", 300)];
    const settlement = { id: "s1", covered: [{ purchase_id: "a", debtor_id: "me", amount: 100 }] };
    const next = markCovered(settlement, shares, purchases, T2);
    expect(next[0]).toMatchObject({ settled_at: T2, settlement_id: "s1" });
    expect(next[1]).toMatchObject({ settled_at: null, settlement_id: null });
    expect(shares[0].settled_at).toBeNull(); // input is not mutated
  });
});

describe("in-flight transfers (slice 19)", () => {
  // the live case: Нурбол (nb) paid Нурдаулет (nd) 150 and marked it; later nd owes nb 450
  const purchases = [purchase("nan", "nd", T0, "shared", "нан"), purchase("rolton", "nb", T1, "shared", "Ролтон")];
  const shares = [share("nan", "nb", 150), share("rolton", "nd", 450)];
  const marked = { id: "s1", status: "marked" as const, covered: [{ purchase_id: "nan", debtor_id: "nb", amount: 150 }] };

  it("the pair net ignores a marked transfer: 450, not 450 - 150", () => {
    expect(netPair("nd", "nb", shares, purchases)).toMatchObject({ net: 300, direction: "i_pay" });
    const n = netPair("nd", "nb", withoutInFlight(shares, [marked]), purchases);
    expect(n).toMatchObject({ iOwe: 450, theyOwe: 0, net: 450, direction: "i_pay" });
  });
  it("a cancelled or confirmed settlement no longer hides anything", () => {
    expect(withoutInFlight(shares, [{ ...marked, status: "cancelled" }])).toBe(shares);
    expect(withoutInFlight(shares, [{ ...marked, status: "confirmed" }])).toBe(shares);
  });
  it("shares that are not in flight keep their identity; the input is not mutated", () => {
    const out = withoutInFlight(shares, [marked]);
    expect(out[1]).toBe(shares[1]);
    expect(out[0]).not.toBe(shares[0]);
    expect(shares[0].settled_at).toBeNull();
  });
  it("my own pending settlement can be left out: its shares are recorded again by a re-mark", () => {
    const out = withoutInFlight(shares, [marked], "s1");
    expect(out).toBe(shares);
    expect(pairShares("nb", "nd", out, purchases)).toHaveLength(2);
  });
  it("a marked transfer takes the pair to even, and the person leaves the counterparties", () => {
    const sh = [share("nan", "nb", 150)];
    const n = netForUser("nb", withoutInFlight(sh, [marked]), [purchases[0]]);
    expect(n).toMatchObject({ owe: 0, owed: 0, total: 0 });
    expect(n.counterparties).toEqual([]);
  });
  it("isInFlight is true only for an open share inside a marked transfer", () => {
    expect(isInFlight(shares[0], [marked])).toBe(true);
    expect(isInFlight(shares[1], [marked])).toBe(false);
    expect(isInFlight({ ...shares[0], settled_at: T2 }, [marked])).toBe(false);
    expect(isInFlight(shares[0], [{ ...marked, status: "cancelled" }])).toBe(false);
  });
});
