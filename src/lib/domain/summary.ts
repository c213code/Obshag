import { balanceFor, netPair, type Balance, type BalancePurchase, type BalanceShare } from "./balance";

export type MemberRef = { user_id: string };

/** Per-household numbers for the home card: the user's balance and how many housemates are even with them. */
export function householdSummary(
  meId: string,
  members: ReadonlyArray<MemberRef>,
  shares: ReadonlyArray<BalanceShare>,
  purchases: ReadonlyArray<BalancePurchase>,
): { balance: Balance; evenWith: number; others: number } {
  const others = members.filter((m) => m.user_id !== meId);
  const evenWith = others.filter((o) => netPair(meId, o.user_id, shares, purchases) === 0).length;
  return { balance: balanceFor(meId, shares, purchases), evenWith, others: others.length };
}

/** "N из M скинули": non-payer shares settled so far vs all non-payer shares of a purchase. */
export function purchaseProgress(
  payerId: string,
  shares: ReadonlyArray<{ debtor_id: string; settled_at: string | null }>,
): { paid: number; total: number } {
  const owed = shares.filter((s) => s.debtor_id !== payerId);
  return { paid: owed.filter((s) => s.settled_at !== null).length, total: owed.length };
}
