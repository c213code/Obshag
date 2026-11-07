import { dayKind, type DayKind } from "@/lib/format/date";
import type { PurchaseWithShares } from "@/lib/data/repo";

export type PurchaseFilter = "all" | "mine" | "owe";

type Row = Pick<PurchaseWithShares, "payer_id" | "status" | "created_at" | "shares" | "id">;

/**
 * Покупки tab filters. Pending Apple Pay purchases are not here (they wait in «Ждут решения»).
 *  - all: every visible purchase
 *  - mine: the ones I paid for
 *  - owe: someone else paid and my share is still open
 */
export function filterPurchases<T extends Row>(list: ReadonlyArray<T>, filter: PurchaseFilter, meId: string): T[] {
  return list.filter((p) => {
    if (p.status === "pending") return false;
    if (filter === "mine") return p.payer_id === meId;
    if (filter === "owe") {
      return p.status === "shared" && p.payer_id !== meId && p.shares.some((s) => s.debtor_id === meId && s.settled_at === null);
    }
    return true;
  });
}

export type DayGroup<T> = { key: string; kind: DayKind; iso: string; items: T[] };

/** Newest first, grouped by local calendar day. Keeps the order of `list` (already newest first). */
export function groupByDay<T extends { created_at: string }>(list: ReadonlyArray<T>, now: Date = new Date()): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const item of list) {
    const d = new Date(item.created_at);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, kind: dayKind(item.created_at, now), iso: item.created_at, items: [item] });
  }
  return groups;
}
