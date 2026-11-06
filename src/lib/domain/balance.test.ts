import { describe, expect, it } from "vitest";
import { balanceFor, netPair, type BalancePurchase, type BalanceShare } from "./balance";

const purchases: BalancePurchase[] = [
  { id: "p1", payer_id: "me", status: "shared" },
  { id: "p2", payer_id: "aidos", status: "shared" },
  { id: "p3", payer_id: "danya", status: "personal" },
  { id: "p4", payer_id: "me", status: "pending" },
];
const open = (purchase_id: string, debtor_id: string, amount: number): BalanceShare => ({
  purchase_id,
  debtor_id,
  amount,
  settled_at: null,
});

describe("balanceFor", () => {
  it("is zero with nothing", () => {
    expect(balanceFor("me", [], [])).toEqual({ owe: 0, owed: 0, net: 0 });
  });

  it("6000 split among 4 paid by me: owed 4500; a debtor owes 1500", () => {
    const shares = [
      { ...open("p1", "me", 1500), settled_at: "2026-11-03T12:00:00Z" },
      open("p1", "aidos", 1500),
      open("p1", "danya", 1500),
      open("p1", "nurik", 1500),
    ];
    expect(balanceFor("me", shares, purchases)).toEqual({ owe: 0, owed: 4500, net: 4500 });
    expect(balanceFor("aidos", shares, purchases)).toEqual({ owe: 1500, owed: 0, net: -1500 });
  });

  it("counts open shares only and ignores personal/pending purchases", () => {
    const shares = [
      open("p1", "aidos", 1500),
      { ...open("p1", "danya", 1500), settled_at: "2026-11-04T00:00:00Z" },
      open("p2", "me", 500),
      open("p3", "me", 900),
      open("p4", "aidos", 700),
      open("unknown", "me", 50),
    ];
    expect(balanceFor("me", shares, purchases)).toEqual({ owe: 500, owed: 1500, net: 1000 });
  });

  it("never counts the payer's own share as a debt", () => {
    expect(balanceFor("me", [open("p1", "me", 1500)], purchases)).toEqual({ owe: 0, owed: 0, net: 0 });
  });
});

describe("netPair", () => {
  it("nets A owes B 2000 and B owes A 1800 to A pays B 200", () => {
    const ps: BalancePurchase[] = [
      { id: "x", payer_id: "B", status: "shared" },
      { id: "y", payer_id: "A", status: "shared" },
    ];
    const shares = [open("x", "A", 2000), open("y", "B", 1800)];
    expect(netPair("A", "B", shares, ps)).toBe(200);
    expect(netPair("B", "A", shares, ps)).toBe(-200);
  });

  it("is 0 when even", () => {
    expect(netPair("me", "aidos", [], purchases)).toBe(0);
  });
});
