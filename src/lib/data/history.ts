/** How far back the app loads purchases and settlements; older rows are loaded only while they still matter. */
export const HISTORY_DAYS = 90;

/** ISO timestamp of the start of the window. */
export function historyCutoff(now: Date = new Date()): string {
  return new Date(now.getTime() - HISTORY_DAYS * 86_400_000).toISOString();
}

type P = { id: string; created_at: string; status: string; shares: ReadonlyArray<{ settled_at: string | null }> };

/**
 * The bounded set a household load keeps: the last 90 days, plus any older purchase that is pending or still has an
 * unsettled share. Netting only ever reads open shares, so balances are the same as with the full history.
 * (supabaseRepo does this with queries; this is the same rule as a pure function, used by the tests.)
 */
export function boundedPurchases<T extends P>(all: ReadonlyArray<T>, now: Date = new Date()): T[] {
  const cutoff = historyCutoff(now);
  return all.filter((p) => p.created_at >= cutoff || p.status === "pending" || p.shares.some((s) => s.settled_at === null));
}
