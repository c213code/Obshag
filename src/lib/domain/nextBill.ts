import type { Bill } from "@/lib/data/types";
import { shiftMonth } from "./almaty";
import { splitEqual } from "./split";

export type NextBill = { bill: Bill; month: string; day: number; /** my part, null when the amount is not known yet */ mine: number | null };

/** The monthly bill that falls due next (today counts): this month if its day has not passed, else next month. */
export function nextBill(bills: ReadonlyArray<Bill>, today: { month: string; day: number }, meId: string): NextBill | null {
  let best: { bill: Bill; month: string } | null = null;
  for (const bill of bills) {
    const month = bill.day_of_month >= today.day ? today.month : shiftMonth(today.month, 1);
    if (!best || month < best.month || (month === best.month && bill.day_of_month < best.bill.day_of_month)) best = { bill, month };
  }
  if (!best) return null;
  const { bill, month } = best;
  let mine: number | null = null;
  if (bill.amount !== null && bill.participants.includes(meId) && bill.amount >= bill.participants.length) {
    mine = splitEqual(bill.amount, bill.participants, bill.payer_id).find((s) => s.debtor_id === meId)?.amount ?? null;
  }
  return { bill, month, day: bill.day_of_month, mine };
}
