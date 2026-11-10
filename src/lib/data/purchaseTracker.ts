import type { PurchaseWithShares } from "./repo";

/** A purchase as the screens render it. `clientKey` is the React key: it never changes for the life of a row. */
export type UiPurchase = PurchaseWithShares & { clientKey: string };

/** An optimistic resolve is dropped after this long even if no list ever confirmed it. */
const OVERRIDE_TTL_MS = 30_000;

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
  /** A pending purchase this device resolved: shown in its new state until a server list agrees (or the TTL ends). */
  private readonly overrides = new Map<string, { row: PurchaseWithShares; at: number }>();

  /** Purchases this device is deleting (or deleted): hidden from every list until a server list no longer has them. */
  private readonly removed = new Map<string, number>();
  /** Descriptions this device is changing: shown until a server list carries the same text (or the TTL ends). */
  private readonly renamed = new Map<string, { text: string; at: number }>();

  /** Output objects by id: a row whose source object and decoration did not change keeps its identity between views. */
  private readonly derived = new Map<string, { src: object; tag: string; out: UiPurchase }>();

  private reuse(id: string, tag: string, src: object, make: () => UiPurchase): UiPurchase {
    const hit = this.derived.get(id);
    if (hit && hit.src === src && hit.tag === tag) return hit.out;
    const out = make();
    this.derived.set(id, { src, tag, out });
    return out;
  }

  /** Optimistic delete: the row disappears from every view at once. */
  remove(id: string, now = Date.now()): void {
    this.removed.set(id, now);
  }

  /** The delete failed: the row comes back. */
  restore(id: string): void {
    this.removed.delete(id);
  }

  /** Optimistic edit of the description. */
  rename(id: string, text: string, now = Date.now()): void {
    this.renamed.set(id, { text, at: now });
  }

  /** The edit failed: the server's text shows again. */
  unrename(id: string): void {
    this.renamed.delete(id);
  }

  /** Sign-out: forget everything this device knew. */
  clear(): void {
    this.removed.clear();
    this.renamed.clear();
    this.keys.clear();
    this.inflight.clear();
    this.created.clear();
    this.retired.clear();
    this.overrides.clear();
    this.derived.clear();
  }

  /** Shows `row` (the resolved version of a pending purchase) in every list until the server's own list has caught up. */
  override(row: PurchaseWithShares, now = Date.now()): void {
    this.overrides.set(row.id, { row, at: now });
  }

  /** The resolve failed: the server's version shows again. */
  dropOverride(id: string): void {
    this.overrides.delete(id);
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
      const clientKey = this.keys.get(p.id) ?? p.id;
      rows.set(p.id, this.reuse(p.id, `s:${clientKey}`, p, () => ({ ...p, clientKey })));
    }
    for (const [id, o] of [...this.overrides]) {
      const server = rows.get(id);
      // the server list shows it resolved already, or the override is stale: the server's version wins from here on
      if ((server && server.status !== "pending") || Date.now() - o.at > OVERRIDE_TTL_MS) {
        this.overrides.delete(id);
      } else if (server) {
        rows.set(id, this.reuse(id, `o:${server.clientKey}`, o.row, () => ({ ...o.row, clientKey: server.clientKey })));
      }
    }
    for (const r of this.created.values()) if (r.household_id === householdId && !rows.has(r.id)) rows.set(r.id, r);
    for (const r of this.inflight.values()) if (r.household_id === householdId) rows.set(r.id, r);

    const now = Date.now();
    for (const [id, at] of [...this.removed]) {
      // gone from the server's list (or the delete never got confirmed within the TTL): stop tracking it
      if (now - at > OVERRIDE_TTL_MS || (!present.has(id) && !this.created.has(id) && !this.inflight.has(id))) this.removed.delete(id);
      else rows.delete(id);
    }
    for (const [id, r] of [...this.renamed]) {
      const row = rows.get(id);
      if (now - r.at > OVERRIDE_TTL_MS || (row && row.description === r.text)) this.renamed.delete(id);
      else if (row) rows.set(id, this.reuse(id, `r:${r.text}:${row.clientKey}`, row, () => ({ ...row, description: r.text })));
    }
    for (const [id, d] of [...this.derived]) if (d.out.household_id === householdId && !rows.has(id)) this.derived.delete(id);
    return [...rows.values()].sort(newestFirst);
  }
}
