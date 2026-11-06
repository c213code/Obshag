import { describe, expect, it } from "vitest";
import { SettlementTracker } from "./settlementTracker";
import type { Settlement } from "./types";

const row = (id: string, status: Settlement["status"] = "marked", marked_at = "2026-11-03T10:00:00Z"): Settlement => ({
  id,
  household_id: "h",
  from_id: "me",
  to_id: "aidos",
  amount: 200,
  status,
  marked_at,
  confirmed_at: status === "confirmed" ? marked_at : null,
  covered: [{ purchase_id: "p1", debtor_id: "me", amount: 200 }],
});

describe("SettlementTracker", () => {
  it("shows an optimistic marked row until the real one replaces it, even if a stale load arrives in between", () => {
    const t = new SettlementTracker();
    t.begin(row("optimistic-1"));
    expect(t.view("h", []).map((s) => s.id)).toEqual(["optimistic-1"]);
    t.resolve("optimistic-1", row("s1"));
    expect(t.view("h", []).map((s) => s.id)).toEqual(["s1"]); // stale list without it
    expect(t.view("h", [row("s1")]).map((s) => s.id)).toEqual(["s1"]); // list caught up: no duplicate
    expect(t.view("h", []).map((s) => s.id)).toEqual([]); // and the override is gone
  });

  it("a failed mark disappears", () => {
    const t = new SettlementTracker();
    t.begin(row("optimistic-1"));
    t.release("optimistic-1");
    expect(t.view("h", [])).toEqual([]);
  });

  it("an optimistic confirm overrides a stale list and is reported as locally confirmed", () => {
    const t = new SettlementTracker();
    t.patch(row("s1", "confirmed"));
    expect(t.view("h", [row("s1")])[0].status).toBe("confirmed");
    expect(t.locallyConfirmed().map((s) => s.id)).toEqual(["s1"]);
    expect(t.view("h", [row("s1", "confirmed")])[0].status).toBe("confirmed");
    expect(t.locallyConfirmed()).toEqual([]);
  });

  it("a rolled-back cancel shows the server's row again", () => {
    const t = new SettlementTracker();
    t.patch(row("s1", "cancelled"));
    t.release("s1");
    expect(t.view("h", [row("s1")])[0].status).toBe("marked");
  });

  it("only touches its own household and sorts newest first", () => {
    const t = new SettlementTracker();
    t.patch({ ...row("other", "confirmed"), household_id: "x" });
    const list = [row("old", "marked", "2026-11-01T00:00:00Z"), row("new", "marked", "2026-11-05T00:00:00Z")];
    expect(t.view("h", list).map((s) => s.id)).toEqual(["new", "old"]);
    t.clear();
    expect(t.locallyConfirmed()).toEqual([]);
  });

  it("a chained view after a failed mark drops the optimistic row (rollback never depends on a refresh)", () => {
    const t = new SettlementTracker();
    t.begin(row("optimistic-1"));
    const shown = t.view("h", []);
    expect(shown.map((x) => x.id)).toEqual(["optimistic-1"]);
    t.release("optimistic-1");
    // the next view is built from the PREVIOUS view (which still contains the optimistic row): it must not come back
    expect(t.view("h", shown)).toEqual([]);
    expect(t.view("h", t.view("h", shown))).toEqual([]);
  });

  it("a failed confirm and a failed cancel revert to the server's marked row, also through a chained view", () => {
    const t = new SettlementTracker();
    const server = [row("s1")];
    for (const status of ["confirmed", "cancelled"] as const) {
      t.patch(row("s1", status));
      const shown = t.view("h", server);
      expect(shown[0].status).toBe(status);
      t.release("s1");
      expect(t.view("h", server)[0].status).toBe("marked");
      expect(t.locallyConfirmed()).toEqual([]);
    }
  });

  it("a resolved temp row is gone from later views even when an old list still carries it", () => {
    const t = new SettlementTracker();
    t.begin(row("optimistic-1"));
    const shown = t.view("h", []);
    t.resolve("optimistic-1", row("s1"));
    expect(t.view("h", shown).map((x) => x.id)).toEqual(["s1"]);
  });

  it("overrides expire after the TTL: a forgotten optimistic change cannot stay on screen forever", () => {
    let now = 1_000;
    const t = new SettlementTracker(() => now, 30_000);
    t.begin(row("optimistic-1"));
    t.patch(row("s1", "confirmed"));
    now += 29_000;
    expect(t.view("h", [row("s1")]).map((x) => [x.id, x.status])).toEqual([
      ["optimistic-1", "marked"],
      ["s1", "confirmed"],
    ]);
    now += 2_000;
    expect(t.view("h", [row("s1")]).map((x) => [x.id, x.status])).toEqual([["s1", "marked"]]);
    expect(t.locallyConfirmed()).toEqual([]);
  });
});
