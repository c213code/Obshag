import type { Balance, BalancePurchase, BalanceShare } from "./balance";
import { heroState, payTarget, type HeroState } from "./hero";
import { netForUser, type NetPurchase } from "./netting";

export type MemberRef = { user_id: string };

/**
 * Per-household numbers for the home card: the user's balance (pairwise netting, slice 3), how many housemates are even
 * with them, and (slice 27) the one number the hero shows plus where its «Оплатить» goes. `balance.net` equals the
 * slice 1 gross figure owed - owe. `members` are the active ones: a debt with someone who left is never payable.
 */
export function householdSummary(
  meId: string,
  members: ReadonlyArray<MemberRef>,
  shares: ReadonlyArray<BalanceShare>,
  purchases: ReadonlyArray<BalancePurchase & Pick<NetPurchase, "description" | "created_at">>,
): { balance: Balance; evenWith: number; others: number; hero: HeroState; payTo: string | null } {
  const others = members.filter((m) => m.user_id !== meId);
  const here = new Set(others.map((o) => o.user_id));
  const n = netForUser(meId, shares, purchases, (id) => here.has(id));
  const open = new Set(n.counterparties.map((c) => c.userId));
  const evenWith = others.filter((o) => !open.has(o.user_id)).length;
  return {
    balance: { owe: n.owe, owed: n.owed, net: n.total },
    evenWith,
    others: others.length,
    hero: heroState(n.counterparties),
    payTo: payTarget(n.counterparties),
  };
}

/** "N из M скинули": non-payer shares settled so far vs all non-payer shares of a purchase. */
export function purchaseProgress(
  payerId: string,
  shares: ReadonlyArray<{ debtor_id: string; settled_at: string | null; amount?: number }>,
): { paid: number; total: number } {
  // a «Свои суммы» entry of 0 ₸ owes nothing, so it is neither waited for nor counted
  const owed = shares.filter((s) => s.debtor_id !== payerId && (s.amount ?? 1) > 0);
  return { paid: owed.filter((s) => s.settled_at !== null).length, total: owed.length };
}
