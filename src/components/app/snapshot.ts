import type { UiPurchase } from "@/lib/data/purchaseTracker";
import type { AuthSession, MemberWithProfile, PurchaseWithShares } from "@/lib/data/repo";
import type { Bill, Household, Profile, Settlement } from "@/lib/data/types";

export type Snapshot = {
  session: AuthSession | null;
  me: Profile | null;
  households: Household[];
  members: Record<string, MemberWithProfile[]>;
  purchases: Record<string, UiPurchase[]>;
  settlements: Record<string, Settlement[]>;
  bills: Record<string, Bill[]>;
};

export const EMPTY: Snapshot = { session: null, me: null, households: [], members: {}, purchases: {}, settlements: {}, bills: {} };

/** Same value, cheaply: identical reference first, then a JSON compare (rows are small plain objects). */
export function sameValue<T>(a: T, b: T): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Structural sharing for one list: every row that did not change keeps its previous object, and when nothing at all
 * changed the previous ARRAY comes back. Rows are matched by `keyOf`, so a reorder still reuses the objects.
 */
export function shareList<T>(prev: ReadonlyArray<T> | undefined, next: ReadonlyArray<T>, keyOf: (row: T) => string): T[] {
  if (!prev) return next as T[];
  const before = new Map(prev.map((r) => [keyOf(r), r]));
  let identical = prev.length === next.length;
  const out = next.map((row, i) => {
    const old = before.get(keyOf(row));
    const kept = old !== undefined && sameValue(old, row) ? old : row;
    if (identical && kept !== prev[i]) identical = false;
    return kept;
  });
  return identical ? (prev as T[]) : out;
}

export function shareRecord<T>(prev: Record<string, T[]>, next: Record<string, T[]>, keyOf: (row: T) => string): Record<string, T[]> {
  const keys = Object.keys(next);
  let identical = keys.length === Object.keys(prev).length;
  const out: Record<string, T[]> = {};
  for (const k of keys) {
    out[k] = shareList(prev[k], next[k], keyOf);
    if (identical && out[k] !== prev[k]) identical = false;
  }
  return identical ? prev : out;
}

/** `next` re-using every unchanged part of `prev`. Returns `prev` itself when nothing changed (so setState can be skipped). */
export function reconcileSnapshot<S extends Omit<Snapshot, "purchases"> & { purchases: Record<string, Array<{ id: string }>> }>(prev: S, next: S): S {
  const session = sameValue(prev.session, next.session) ? prev.session : next.session;
  const me = sameValue(prev.me, next.me) ? prev.me : next.me;
  const households = shareList(prev.households, next.households, (h) => h.id);
  const members = shareRecord(prev.members, next.members, (m) => m.user_id);
  const purchases = shareRecord<{ id: string }>(prev.purchases, next.purchases, (p) => p.id) as S["purchases"];
  const settlements = shareRecord(prev.settlements, next.settlements, (s) => s.id);
  const bills = shareRecord(prev.bills, next.bills, (b) => b.id);
  if (
    session === prev.session &&
    me === prev.me &&
    households === prev.households &&
    members === prev.members &&
    purchases === prev.purchases &&
    settlements === prev.settlements &&
    bills === prev.bills
  ) {
    return prev;
  }
  return { ...next, session, me, households, members, purchases, settlements, bills };
}

/** What a load brings back: the server's lists, before this device's own optimistic rows are merged in. */
export type Loaded = Omit<Snapshot, "purchases"> & { purchases: Record<string, PurchaseWithShares[]> };
