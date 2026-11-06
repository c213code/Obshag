import type { Purchase, Settlement, SettlementShare, Share } from "@/lib/data/types";

/** Pairwise netting (SDD §7). Pure: everything here is computed from the open shares of shared purchases. */

export type NetShare = Pick<Share, "purchase_id" | "debtor_id" | "amount" | "settled_at">;
export type NetPurchase = Pick<Purchase, "id" | "payer_id" | "status" | "description" | "created_at">;

export type NetDirection = "i_pay" | "they_pay" | "even";

/** One open share behind a side of the equation. */
export type NetItem = { purchase_id: string; description: string; amount: number };

export type PairNet = {
  /** owes(me -> other): open shares where I am the debtor and the other is the payer. */
  iOwe: number;
  /** owes(other -> me). */
  theyOwe: number;
  /** The transfer that settles the pair: |iOwe - theyOwe|, never negative. */
  net: number;
  direction: NetDirection;
  /** What I owe them, biggest first. */
  myItems: NetItem[];
  /** What they owe me, biggest first. */
  theirItems: NetItem[];
};

type Debt = { debtor: string; creditor: string; amount: number; purchase_id: string; description: string };

/** Only open shares of shared purchases count; the payer's own share is never a debt. */
function openDebts(shares: ReadonlyArray<NetShare>, purchases: ReadonlyArray<NetPurchase>): Debt[] {
  const byId = new Map(purchases.map((p) => [p.id, p]));
  return shares.flatMap((s) => {
    const p = byId.get(s.purchase_id);
    if (!p || p.status !== "shared" || s.settled_at !== null || s.debtor_id === p.payer_id) return [];
    return [{ debtor: s.debtor_id, creditor: p.payer_id, amount: s.amount, purchase_id: p.id, description: p.description }];
  });
}

const biggestFirst = (a: NetItem, b: NetItem) => b.amount - a.amount || a.description.localeCompare(b.description);
const toItem = (d: Debt): NetItem => ({ purchase_id: d.purchase_id, description: d.description, amount: d.amount });

function pairFromDebts(me: string, other: string, debts: ReadonlyArray<Debt>): PairNet {
  const mine = debts.filter((d) => d.debtor === me && d.creditor === other);
  const theirs = debts.filter((d) => d.debtor === other && d.creditor === me);
  const iOwe = mine.reduce((sum, d) => sum + d.amount, 0);
  const theyOwe = theirs.reduce((sum, d) => sum + d.amount, 0);
  const diff = iOwe - theyOwe;
  return {
    iOwe,
    theyOwe,
    net: Math.abs(diff),
    direction: diff > 0 ? "i_pay" : diff < 0 ? "they_pay" : "even",
    myItems: mine.map(toItem).sort(biggestFirst),
    theirItems: theirs.map(toItem).sort(biggestFirst),
  };
}

/** Net between me and one other person. `direction` says who pays whom. */
export function netPair(
  me: string,
  other: string,
  shares: ReadonlyArray<NetShare>,
  purchases: ReadonlyArray<NetPurchase>,
): PairNet {
  return pairFromDebts(me, other, openDebts(shares, purchases));
}

export type Counterparty = {
  userId: string;
  iOwe: number;
  theyOwe: number;
  net: number;
  direction: Exclude<NetDirection, "even">;
  /** false when the person left the household: the debt still counts, but there is nobody to settle with. */
  active: boolean;
};

export type UserNet = {
  /** People I have a non-zero net with, biggest transfer first. */
  counterparties: Counterparty[];
  /** Sum of the transfers I make. */
  owe: number;
  /** Sum of the transfers made to me. */
  owed: number;
  /** owed - owe: the signed home balance. */
  total: number;
};

/**
 * Every counterparty with a non-zero net plus the totals (the home "Долги" card and balance). `isActive` only flags
 * departed neighbours (`active: false`): they stay in the list and in the totals, so nothing is silently dropped.
 */
export function netForUser(
  me: string,
  shares: ReadonlyArray<NetShare>,
  purchases: ReadonlyArray<NetPurchase>,
  isActive: (userId: string) => boolean = () => true,
): UserNet {
  const debts = openDebts(shares, purchases);
  const others = new Set<string>();
  for (const d of debts) {
    if (d.debtor === me) others.add(d.creditor);
    else if (d.creditor === me) others.add(d.debtor);
  }
  const counterparties: Counterparty[] = [];
  for (const userId of others) {
    const p = pairFromDebts(me, userId, debts);
    if (p.direction === "even") continue;
    counterparties.push({ userId, iOwe: p.iOwe, theyOwe: p.theyOwe, net: p.net, direction: p.direction, active: isActive(userId) });
  }
  counterparties.sort((a, b) => b.net - a.net || a.userId.localeCompare(b.userId));
  const owe = counterparties.filter((c) => c.direction === "i_pay").reduce((s, c) => s + c.net, 0);
  const owed = counterparties.filter((c) => c.direction === "they_pay").reduce((s, c) => s + c.net, 0);
  return { counterparties, owe, owed, total: owed - owe };
}

/** The open shares between two people, both directions: exactly what `mark_settlement` records. */
export function pairShares(
  me: string,
  other: string,
  shares: ReadonlyArray<NetShare>,
  purchases: ReadonlyArray<NetPurchase>,
): SettlementShare[] {
  return openDebts(shares, purchases)
    .filter((d) => (d.debtor === me && d.creditor === other) || (d.debtor === other && d.creditor === me))
    .map((d) => ({ purchase_id: d.purchase_id, debtor_id: d.debtor, amount: d.amount }));
}

export type CoverSettlement = Pick<Settlement, "covered">;

const key = (purchaseId: string, debtorId: string) => `${purchaseId}\u0000${debtorId}`;

/**
 * The shares a confirmation closes: exactly the ones recorded at the mark, if they are still open and their purchase is
 * still shared. Anything bought (or turned shared) since stays open.
 */
export function coveredShares<S extends NetShare>(
  settlement: CoverSettlement,
  shares: ReadonlyArray<S>,
  purchases: ReadonlyArray<NetPurchase>,
): S[] {
  const recorded = new Set(settlement.covered.map((c) => key(c.purchase_id, c.debtor_id)));
  const byId = new Map(purchases.map((p) => [p.id, p]));
  return shares.filter((s) => {
    if (!recorded.has(key(s.purchase_id, s.debtor_id))) return false;
    const p = byId.get(s.purchase_id);
    return !!p && p.status === "shared" && s.settled_at === null && s.debtor_id !== p.payer_id;
  });
}

/**
 * True when the books no longer match what the debtor paid: the record is empty, or a recorded share is gone, already
 * settled, has another amount, or its purchase is no longer shared. Confirming such a settlement must be refused.
 */
export function isStale(settlement: CoverSettlement, shares: ReadonlyArray<NetShare>, purchases: ReadonlyArray<NetPurchase>): boolean {
  if (settlement.covered.length === 0) return true;
  const byShare = new Map(shares.map((s) => [key(s.purchase_id, s.debtor_id), s]));
  const byId = new Map(purchases.map((p) => [p.id, p]));
  return settlement.covered.some((c) => {
    const s = byShare.get(key(c.purchase_id, c.debtor_id));
    const p = byId.get(c.purchase_id);
    return !s || !p || s.settled_at !== null || s.amount !== c.amount || p.status !== "shared";
  });
}

/** A copy of `shares` with the recorded ones settled (what a confirmation does). The input is not mutated. */
export function markCovered<S extends NetShare & { settlement_id: string | null }>(
  settlement: CoverSettlement & { id: string },
  shares: ReadonlyArray<S>,
  purchases: ReadonlyArray<NetPurchase>,
  settledAt: string,
): S[] {
  const covered = new Set(coveredShares(settlement, shares, purchases));
  return shares.map((s) => (covered.has(s) ? { ...s, settled_at: settledAt, settlement_id: settlement.id } : s));
}
