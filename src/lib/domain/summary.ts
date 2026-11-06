import type { Balance, BalancePurchase, BalanceShare } from "./balance";
import { netForUser, type NetPurchase } from "./netting";

export type MemberRef = { user_id: string };

/**
 * Per-household numbers for the home card: the user's balance (pairwise netting, slice 3) and how many
 * housemates are even with them. `balance.net` equals the slice 1 gross figure owed - owe.
 */
export function householdSummary(
  meId: string,
  members: ReadonlyArray<MemberRef>,
  shares: ReadonlyArray<BalanceShare>,
  purchases: ReadonlyArray<BalancePurchase & Pick<NetPurchase, "description" | "created_at">>,
): { balance: Balance; evenWith: number; others: number } {
  const others = members.filter((m) => m.user_id !== meId);
  const n = netForUser(meId, shares, purchases);
  const open = new Set(n.counterparties.map((c) => c.userId));
  const evenWith = others.filter((o) => !open.has(o.user_id)).length;
  return { balance: { owe: n.owe, owed: n.owed, net: n.total }, evenWith, others: others.length };
}

/** "N из M скинули": non-payer shares settled so far vs all non-payer shares of a purchase. */
export function purchaseProgress(
  payerId: string,
  shares: ReadonlyArray<{ debtor_id: string; settled_at: string | null }>,
): { paid: number; total: number } {
  const owed = shares.filter((s) => s.debtor_id !== payerId);
  return { paid: owed.filter((s) => s.settled_at !== null).length, total: owed.length };
}
