import { describe, expect, it } from "vitest";
import { PurchaseTracker, type UiPurchase } from "./purchaseTracker";
import type { PurchaseWithShares } from "./repo";

const row = (id: string, created_at: string, household_id = "h1"): PurchaseWithShares => ({
  id,
  household_id,
  payer_id: "me",
  amount: 100,
  description: id,
  merchant: null,
  source: "manual",
  status: "shared",
  created_at,
  shares: [],
});
const opt = (id: string, at: string): UiPurchase => ({ ...row(id, at), clientKey: id });

describe("PurchaseTracker", () => {
  it("a load that finishes after the insert cannot wipe the optimistic row", () => {
    const t = new PurchaseTracker();
    const old = row("a", "2026-11-01T10:00:00Z");
    t.begin(opt("optimistic-1", "2026-11-06T10:00:00Z"));
    // the load started before the insert, so its list has no new row
    const ids = t.view("h1", [old]).map((p) => p.id);
    expect(ids).toEqual(["optimistic-1", "a"]);
  });

  it("other households are not polluted", () => {
    const t = new PurchaseTracker();
    t.begin(opt("optimistic-1", "2026-11-06T10:00:00Z"));
    expect(t.view("h2", [])).toEqual([]);
  });

  it("the real row takes over the optimistic row's key, so there is never a second row", () => {
    const t = new PurchaseTracker();
    t.begin(opt("optimistic-1", "2026-11-06T10:00:00Z"));
    const real = t.resolve("optimistic-1", row("real-1", "2026-11-06T10:00:01Z"));
    expect(real.clientKey).toBe("optimistic-1");
    const list = t.view("h1", [opt("optimistic-1", "2026-11-06T10:00:00Z"), row("a", "2026-11-01T10:00:00Z")]);
    expect(list.map((p) => p.id)).toEqual(["real-1", "a"]);
    expect(list[0].clientKey).toBe("optimistic-1");
    // a later server list that contains the real row keeps the same key
    const later = t.view("h1", [row("real-1", "2026-11-06T10:00:01Z"), row("a", "2026-11-01T10:00:00Z")]);
    expect(later.map((p) => [p.id, p.clientKey])).toEqual([["real-1", "optimistic-1"], ["a", "a"]]);
  });

  it("a stale load that finishes after the real row arrived still shows it, once", () => {
    const t = new PurchaseTracker();
    t.begin(opt("optimistic-1", "2026-11-06T10:00:00Z"));
    t.resolve("optimistic-1", row("real-1", "2026-11-06T10:00:01Z"));
    const stale = t.view("h1", [row("a", "2026-11-01T10:00:00Z")]);
    expect(stale.map((p) => p.id)).toEqual(["real-1", "a"]);
    // a fresh server list containing it twice over time never duplicates
    const fresh = t.view("h1", [row("real-1", "2026-11-06T10:00:01Z"), row("a", "2026-11-01T10:00:00Z")]);
    expect(fresh.map((p) => p.id)).toEqual(["real-1", "a"]);
    expect(t.view("h1", [row("a", "2026-11-01T10:00:00Z")]).map((p) => p.id)).toEqual(["a"]); // pruned once seen
  });

  it("when the optimistic row was already overwritten, resolving inserts the real row", () => {
    const t = new PurchaseTracker();
    t.begin(opt("optimistic-1", "2026-11-06T10:00:00Z"));
    t.resolve("optimistic-1", row("real-1", "2026-11-06T10:00:01Z"));
    // the visible list had lost the optimistic row (it only has 'a'): view() puts the real one back
    expect(t.view("h1", [row("a", "2026-11-01T10:00:00Z")]).map((p) => p.id)).toEqual(["real-1", "a"]);
  });

  it("a failed row is not merged back into any list", () => {
    const t = new PurchaseTracker();
    t.begin(opt("optimistic-1", "2026-11-06T10:00:00Z"));
    expect(t.view("h1", []).map((p) => p.id)).toEqual(["optimistic-1"]);
    t.fail("optimistic-1");
    expect(t.view("h1", [row("a", "2026-11-01T10:00:00Z")]).map((p) => p.id)).toEqual(["a"]);
    // even a list that still holds the optimistic row (the visible one) drops it
    expect(t.view("h1", [opt("optimistic-1", "2026-11-06T10:00:00Z"), row("a", "2026-11-01T10:00:00Z")]).map((p) => p.id)).toEqual(["a"]);
  });
});

describe("PurchaseTracker overrides (optimistic resolve of a pending purchase)", () => {
  const pending = { ...row("p1"), status: "pending" as const, shares: [] };
  function row(id: string) {
    return {
      id,
      household_id: "h1",
      payer_id: "me",
      amount: 1000,
      description: "Magnum",
      merchant: "Magnum",
      source: "apple_pay" as const,
      status: "shared" as const,
      created_at: "2026-11-07T10:00:00.000Z",
      shares: [],
    };
  }

  it("shows the resolved row while the server still says pending, then yields to the server", () => {
    const t = new PurchaseTracker();
    const resolved = { ...pending, status: "shared" as const, description: "Хлеб" };
    t.override(resolved);
    expect(t.view("h1", [pending])[0]).toMatchObject({ status: "shared", description: "Хлеб" });
    // the server caught up: its row wins and the override is gone
    const serverRow = { ...resolved, description: "Хлеб (сервер)" };
    expect(t.view("h1", [serverRow])[0].description).toBe("Хлеб (сервер)");
    expect(t.view("h1", [pending])[0].status).toBe("pending");
  });

  it("dropOverride (failed resolve) brings the pending row back", () => {
    const t = new PurchaseTracker();
    t.override({ ...pending, status: "personal" });
    t.dropOverride("p1");
    expect(t.view("h1", [pending])[0].status).toBe("pending");
  });

  it("expires after the TTL and is cleared on sign-out", () => {
    const t = new PurchaseTracker();
    t.override({ ...pending, status: "personal" }, Date.now() - 31_000);
    expect(t.view("h1", [pending])[0].status).toBe("pending");
    t.override({ ...pending, status: "personal" });
    t.clear();
    expect(t.view("h1", [pending])[0].status).toBe("pending");
  });

  const mk = (id: string, created_at: string): PurchaseWithShares => ({ ...pending, id, status: "shared", created_at, description: id });

  it("a removed row stays hidden until the server list stops carrying it, and comes back on restore", () => {
    const t = new PurchaseTracker();
    const a = mk("a", "2026-11-01T10:00:00Z");
    const b = mk("b", "2026-11-02T10:00:00Z");
    t.remove("a");
    expect(t.view("h1", [a, b]).map((p) => p.id)).toEqual(["b"]);
    expect(t.view("h1", [a, b]).map((p) => p.id)).toEqual(["b"]);
    expect(t.view("h1", [b]).map((p) => p.id)).toEqual(["b"]); // the server caught up: tombstone dropped
    expect(t.view("h1", [a, b]).map((p) => p.id)).toEqual(["b", "a"]);
    t.remove("a");
    t.restore("a");
    expect(t.view("h1", [a, b]).map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("a removed row does not stay hidden forever when the server never confirms", () => {
    const t = new PurchaseTracker();
    const a = mk("a", "2026-11-01T10:00:00Z");
    t.remove("a", Date.now() - 60_000);
    expect(t.view("h1", [a]).map((p) => p.id)).toEqual(["a"]);
  });

  it("a renamed row shows the new text until the server carries it", () => {
    const t = new PurchaseTracker();
    const a = mk("a", "2026-11-01T10:00:00Z");
    t.rename("a", "Хлеб");
    expect(t.view("h1", [a])[0].description).toBe("Хлеб");
    expect(t.view("h1", [{ ...a, description: "Хлеб" }])[0].description).toBe("Хлеб"); // caught up, override dropped
    expect(t.view("h1", [a])[0].description).toBe("a");
    t.rename("a", "Вода");
    t.unrename("a");
    expect(t.view("h1", [a])[0].description).toBe("a");
    t.rename("a", "Старое", Date.now() - 60_000);
    expect(t.view("h1", [a])[0].description).toBe("a"); // expired
  });
});
