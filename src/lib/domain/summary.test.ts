import { describe, expect, it } from "vitest";
import { householdSummary, purchaseProgress } from "./summary";

const purchases = [{ id: "p1", payer_id: "me", status: "shared" as const }];
const share = (debtor_id: string, amount: number, settled = false) => ({
  purchase_id: "p1",
  debtor_id,
  amount,
  settled_at: settled ? "2026-11-03T00:00:00Z" : null,
});

describe("householdSummary", () => {
  it("counts housemates who are even with me", () => {
    const shares = [share("me", 1500, true), share("a", 1500), share("b", 1500, true), share("c", 1500)];
    const s = householdSummary("me", [{ user_id: "me" }, { user_id: "a" }, { user_id: "b" }, { user_id: "c" }], shares, purchases);
    expect(s).toEqual({ balance: { owe: 0, owed: 3000, net: 3000 }, evenWith: 1, others: 3 });
  });
  it("is all even when alone", () => {
    expect(householdSummary("me", [{ user_id: "me" }], [], [])).toEqual({
      balance: { owe: 0, owed: 0, net: 0 },
      evenWith: 0,
      others: 0,
    });
  });
});

describe("purchaseProgress", () => {
  it("ignores the payer's own share", () => {
    const shares = [share("me", 1500, true), share("a", 1500, true), share("b", 1500), share("c", 1500)];
    expect(purchaseProgress("me", shares)).toEqual({ paid: 1, total: 3 });
  });
  it("is 0 of 0 when the payer paid for nobody else", () => {
    expect(purchaseProgress("me", [share("me", 100, true)])).toEqual({ paid: 0, total: 0 });
  });
});
