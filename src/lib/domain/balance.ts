import type { Purchase, Share } from "@/lib/data/types";

export type BalanceShare = Pick<Share, "purchase_id" | "debtor_id" | "amount" | "settled_at">;
export type BalancePurchase = Pick<Purchase, "id" | "payer_id" | "status">;

export type Balance = {
  /** What the user still owes others (open shares where they are the debtor). */
  owe: number;
  /** What others still owe the user (open shares of purchases the user paid). */
  owed: number;
  /** owed - owe. Positive = the user is ahead. */
  net: number;
};

/** Only open shares of shared purchases count; the payer's own share is never a debt. */
function openDebts(shares: ReadonlyArray<BalanceShare>, purchases: ReadonlyArray<BalancePurchase>) {
  const byId = new Map(purchases.map((p) => [p.id, p]));
  return shares.flatMap((s) => {
    const p = byId.get(s.purchase_id);
    if (!p || p.status !== "shared" || s.settled_at !== null || s.debtor_id === p.payer_id) return [];
    return [{ debtor: s.debtor_id, creditor: p.payer_id, amount: s.amount }];
  });
}

export function balanceFor(
  userId: string,
  shares: ReadonlyArray<BalanceShare>,
  purchases: ReadonlyArray<BalancePurchase>,
): Balance {
  let owe = 0;
  let owed = 0;
  for (const d of openDebts(shares, purchases)) {
    if (d.debtor === userId) owe += d.amount;
    else if (d.creditor === userId) owed += d.amount;
  }
  return { owe, owed, net: owed - owe };
}

/**
 * Pairwise netting (SDD §7): positive = `a` pays `b` that much, negative = `b` pays `a`, 0 = even.
 * owes(a->b) - owes(b->a).
 */
export function netPair(
  a: string,
  b: string,
  shares: ReadonlyArray<BalanceShare>,
  purchases: ReadonlyArray<BalancePurchase>,
): number {
  let net = 0;
  for (const d of openDebts(shares, purchases)) {
    if (d.debtor === a && d.creditor === b) net += d.amount;
    else if (d.debtor === b && d.creditor === a) net -= d.amount;
  }
  return net;
}
