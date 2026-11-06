import type { PurchaseWithShares } from "./repo";

/** A purchase as the screens render it. `clientKey` is the React key: it never changes for the life of a row. */
export type UiPurchase = PurchaseWithShares & { clientKey: string };

const newestFirst = (a: PurchaseWithShares, b: PurchaseWithShares) =>
  b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);

/**
 * Keeps this device's own purchases consistent with whatever list a load brings back.
 *
 *  - in flight: optimistic rows (not saved yet). Every list is re-merged with them, so a load that finished after the
 *    insert cannot wipe the row.
 *  - created: rows the server confirmed but that a load which started earlier may not contain yet. They are merged
 *    into lists (de-duplicated by id) until a list contains them.
 *  - keys: real id -> clientKey, so the row that was optimistic keeps its React key after the real row replaces it
 *    (a key change would render the old and the new row side by side while they animate).
 */
export class PurchaseTracker {
  private readonly keys = new Map<string, string>();
  private readonly inflight = new Map<string, UiPurchase>();
  private readonly created = new Map<string, UiPurchase>();
  /** Optimistic ids that are over (confirmed or failed): never rendered again. */
  private readonly retired = new Set<string>();

  /** Sign-out: forget everything this device knew. */
  clear(): void {
    this.keys.clear();
    this.inflight.clear();
    this.created.clear();
    this.retired.clear();
  }

  begin(row: UiPurchase): void {
    this.inflight.set(row.id, row);
  }

  /** The server accepted the optimistic row: returns the real row wearing the optimistic row's key. */
  resolve(optimisticId: string, real: PurchaseWithShares): UiPurchase {
    const clientKey = this.inflight.get(optimisticId)?.clientKey ?? this.keys.get(real.id) ?? real.id;
    this.inflight.delete(optimisticId);
    this.retired.add(optimisticId);
    this.keys.set(real.id, clientKey);
    const row: UiPurchase = { ...real, clientKey };
    this.created.set(real.id, row);
    return row;
  }

  /** The server refused it (or the request failed): the optimistic row disappears from every list. */
  fail(optimisticId: string): void {
    this.inflight.delete(optimisticId);
    this.retired.add(optimisticId);
  }

  /** `list` may be a fresh server list or an already merged one; the result is newest first with no duplicate ids. */
  view(householdId: string, list: ReadonlyArray<PurchaseWithShares>): UiPurchase[] {
    const present = new Set(list.map((p) => p.id));
    for (const id of [...this.created.keys()]) if (present.has(id)) this.created.delete(id); // the list knows it now

    const rows = new Map<string, UiPurchase>();
    for (const p of list) {
      if (this.inflight.has(p.id) || this.retired.has(p.id)) continue; // re-added below, from the single source of truth
      rows.set(p.id, { ...p, clientKey: this.keys.get(p.id) ?? p.id });
    }
    for (const r of this.created.values()) if (r.household_id === householdId && !rows.has(r.id)) rows.set(r.id, r);
    for (const r of this.inflight.values()) if (r.household_id === householdId) rows.set(r.id, r);
    return [...rows.values()].sort(newestFirst);
  }
}
