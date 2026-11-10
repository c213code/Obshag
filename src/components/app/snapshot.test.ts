import { describe, expect, it } from "vitest";
import { PurchaseTracker } from "@/lib/data/purchaseTracker";
import type { PurchaseWithShares } from "@/lib/data/repo";
import { EMPTY, reconcileSnapshot, shareList, type Snapshot } from "./snapshot";

const row = (id: string, description = id): PurchaseWithShares => ({
  id,
  household_id: "h1",
  payer_id: "u1",
  amount: 100,
  description,
  merchant: null,
  source: "manual",
  status: "shared",
  created_at: `2026-11-0${id.length}T10:00:00.000Z`,
  shares: [{ purchase_id: id, debtor_id: "u2", amount: 100, settled_at: null, settlement_id: null }],
} as PurchaseWithShares);

const snapWith = (purchases: Snapshot["purchases"]): Snapshot => ({ ...EMPTY, purchases });

describe("structural sharing", () => {
  it("returns the previous list when nothing changed (clones included)", () => {
    const prev = [row("a"), row("bb")];
    const next = prev.map((r) => structuredClone(r));
    expect(shareList(prev, next, (r) => r.id)).toBe(prev);
  });

  it("keeps unchanged rows by identity when one row changed", () => {
    const prev = [row("a"), row("bb")];
    const next = [structuredClone(prev[0]), row("bb", "changed")];
    const out = shareList(prev, next, (r) => r.id);
    expect(out).not.toBe(prev);
    expect(out[0]).toBe(prev[0]);
    expect(out[1]).toBe(next[1]);
  });

  it("an identical reload reconciles to the very same snapshot (no commit)", () => {
    const tracker = new PurchaseTracker();
    const server = [row("a"), row("bb")];
    const first = snapWith({ h1: tracker.view("h1", server) });
    const second = snapWith({ h1: tracker.view("h1", server.map((r) => structuredClone(r))) });
    expect(reconcileSnapshot(first, second)).toBe(first);
  });

  it("a changed purchase makes a new snapshot but the others keep identity", () => {
    const tracker = new PurchaseTracker();
    const first = snapWith({ h1: tracker.view("h1", [row("a"), row("bb")]) });
    const second = snapWith({ h1: tracker.view("h1", [row("a"), row("bb", "renamed")]) });
    const out = reconcileSnapshot(first, second);
    expect(out).not.toBe(first);
    const a = out.purchases.h1.find((p) => p.id === "a");
    expect(a).toBe(first.purchases.h1.find((p) => p.id === "a"));
  });

  it("tracker.view keeps row identity between views of the same server rows", () => {
    const tracker = new PurchaseTracker();
    const server = [row("a"), row("bb")];
    const v1 = tracker.view("h1", server);
    const v2 = tracker.view("h1", server);
    expect(v2[0]).toBe(v1[0]);
    expect(v2[1]).toBe(v1[1]);
  });
});
