import { describe, expect, it } from "vitest";
import { balanceFor } from "@/lib/domain/balance";
import { netForUser } from "@/lib/domain/netting";
import { boundedPurchases, historyCutoff, HISTORY_DAYS } from "./history";

const NOW = new Date("2026-11-10T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

type Row = { id: string; payer_id: string; status: "pending" | "shared" | "personal"; description: string; created_at: string; shares: Array<{ purchase_id: string; debtor_id: string; amount: number; settled_at: string | null }> };

const purchase = (id: string, age: number, payer: string, debtor: string, amount: number, settled: boolean, status: Row["status"] = "shared"): Row => ({
  id,
  payer_id: payer,
  status,
  description: id,
  created_at: daysAgo(age),
  shares: [
    { purchase_id: id, debtor_id: payer, amount, settled_at: daysAgo(age) },
    { purchase_id: id, debtor_id: debtor, amount, settled_at: settled ? daysAgo(age - 1) : null },
  ],
});

const history: Row[] = [
  purchase("old-settled", 400, "a", "b", 1000, true),
  purchase("old-settled-2", 120, "b", "a", 700, true),
  purchase("old-open", 200, "a", "b", 500, false), // still owed: must stay
  purchase("old-open-back", 150, "b", "a", 300, false),
  purchase("recent-settled", 10, "a", "b", 900, true),
  purchase("recent-open", 5, "b", "a", 400, false),
  { ...purchase("old-pending", 300, "a", "b", 800, false, "pending"), shares: [] },
];

describe("bounded history", () => {
  it("cutoff is 90 days back", () => {
    expect(HISTORY_DAYS).toBe(90);
    expect(historyCutoff(NOW)).toBe(daysAgo(90));
  });

  it("drops only old, fully settled, non-pending purchases", () => {
    const kept = boundedPurchases(history, NOW).map((p) => p.id);
    expect(kept).toEqual(["old-open", "old-open-back", "recent-settled", "recent-open", "old-pending"]);
  });

  it("balances and netting are identical to the full history", () => {
    const bounded = boundedPurchases(history, NOW);
    for (const me of ["a", "b"]) {
      const full = balanceFor(me, history.flatMap((p) => p.shares), history);
      const cut = balanceFor(me, bounded.flatMap((p) => p.shares), bounded);
      expect(cut).toEqual(full);
      const nFull = netForUser(me, history.flatMap((p) => p.shares), history);
      const nCut = netForUser(me, bounded.flatMap((p) => p.shares), bounded);
      expect(nCut).toEqual(nFull);
    }
  });
});
