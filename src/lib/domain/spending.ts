import { almatyDay } from "./almaty";

export type SpendPurchase = {
  payer_id: string;
  status: string;
  amount: number;
  created_at: string;
  shares: ReadonlyArray<{ debtor_id: string; amount: number }>;
};

const DAY_MS = 86_400_000;

/** Days since the epoch of an Almaty calendar date 'YYYY-MM-DD'. */
function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

/** Monday-based week start (as a day number). 1970-01-01 was a Thursday. */
const weekStart = (day: number) => day - ((day + 3) % 7);

/** What a purchase costs me: my share, or the whole amount of my own personal purchase. Pending ones cost nothing yet. */
export function myShare(p: SpendPurchase, meId: string): number {
  if (p.status === "pending") return 0;
  if (p.status === "personal") return p.payer_id === meId ? p.amount : 0;
  return p.shares.find((s) => s.debtor_id === meId)?.amount ?? 0;
}

/** My spending this month and per calendar week (Mon-Sun, Asia/Almaty) for the last `weeks` weeks; the last bucket is the current week. */
export function spendingSummary(
  purchases: ReadonlyArray<SpendPurchase>,
  meId: string,
  now: Date,
  weeks = 6,
): { month: number; weeks: number[] } {
  const today = almatyDay(now);
  const thisWeek = weekStart(dayNumber(today.date));
  const buckets = Array.from({ length: weeks }, () => 0);
  let month = 0;
  for (const p of purchases) {
    const mine = myShare(p, meId);
    if (mine === 0) continue;
    const day = almatyDay(new Date(p.created_at));
    if (day.month === today.month) month += mine;
    const ago = (thisWeek - weekStart(dayNumber(day.date))) / 7;
    if (ago >= 0 && ago < weeks) buckets[weeks - 1 - ago] += mine;
  }
  return { month, weeks: buckets };
}
