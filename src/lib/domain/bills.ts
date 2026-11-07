import type { Bill, Purchase, Share, Uuid } from "@/lib/data/types";
import { splitEqual } from "./split";

type PurchaseLike = Purchase & { shares: ReadonlyArray<Share> };

export type BillState =
  /** Generated: the month's purchase exists. */
  | { kind: "generated"; amount: number; settled: number; total: number; purchaseId: Uuid }
  /** Variable bill that is due and has no amount yet. */
  | { kind: "needs_amount" }
  /** Nothing to show yet (not due, or a past month without a purchase). */
  | { kind: "idle"; amount: number | null };

/** A bill is due in `month` once that month has started and, in the current month, its day has come. */
export function isDue(bill: Pick<Bill, "day_of_month">, month: string, today: { month: string; day: number }): boolean {
  return month < today.month || (month === today.month && bill.day_of_month <= today.day);
}

export function monthPurchase<P extends PurchaseLike>(bill: Bill, month: string, purchases: ReadonlyArray<P>): P | undefined {
  return purchases.find((p) => p.bill_id === bill.id && p.bill_month === month);
}

export function billState(bill: Bill, month: string, purchases: ReadonlyArray<PurchaseLike>, today: { month: string; day: number }): BillState {
  const p = monthPurchase(bill, month, purchases);
  if (p) {
    return { kind: "generated", amount: p.amount, settled: p.shares.filter((s) => s.settled_at !== null).length, total: p.shares.length, purchaseId: p.id };
  }
  if (bill.variable) {
    // only the current month is actionable: a past month that was never entered stays idle
    return month === today.month && isDue(bill, month, today) ? { kind: "needs_amount" } : { kind: "idle", amount: null };
  }
  return { kind: "idle", amount: bill.amount };
}

/** «Всего» = every amount known for the month; «Твоя доля» = my part of those (the generated split when there is one). */
export function monthTotals(
  bills: ReadonlyArray<Bill>,
  month: string,
  purchases: ReadonlyArray<PurchaseLike>,
  meId: Uuid,
  today: { month: string; day: number },
): { total: number; mine: number } {
  let total = 0;
  let mine = 0;
  for (const bill of bills) {
    const state = billState(bill, month, purchases, today);
    if (state.kind === "generated") {
      const p = monthPurchase(bill, month, purchases);
      total += state.amount;
      mine += p?.shares.find((s) => s.debtor_id === meId)?.amount ?? 0;
    } else if (state.kind === "idle" && state.amount !== null && bill.participants.length > 0) {
      total += state.amount;
      if (bill.participants.includes(meId) && state.amount >= bill.participants.length) {
        mine += splitEqual(state.amount, bill.participants, bill.payer_id).find((s) => s.debtor_id === meId)?.amount ?? 0;
      }
    }
  }
  return { total, mine };
}
