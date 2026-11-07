/** Kazakhstan is UTC+5 all year (no DST): the app's "today" is the Asia/Almaty calendar day, like the SQL. */
const OFFSET_MS = 5 * 60 * 60 * 1000;

export type AlmatyDay = { month: string; day: number; date: string };

const pad = (n: number) => String(n).padStart(2, "0");

/** The Asia/Almaty calendar day of an instant: month 'YYYY-MM', day 1..31, date 'YYYY-MM-DD'. */
export function almatyDay(now: Date): AlmatyDay {
  const d = new Date(now.getTime() + OFFSET_MS);
  const month = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
  return { month, day: d.getUTCDate(), date: `${month}-${pad(d.getUTCDate())}` };
}

/** 'YYYY-MM' moved by whole months (negative = earlier). */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

export const isMonthKey = (s: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
