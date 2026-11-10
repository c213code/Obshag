import type { DutyEvent } from "@/lib/data/types";
import { isAway } from "./away";
import { dayDiff, dayOfMonth, DOW_SHORT, isoDow, monthOf } from "./duty";
import { almatyDay } from "./almaty";
import { perPersonRange } from "./split";

/** Event duties (Мусор / Вода): no dates, the turn moves on fact. Mirror of private.duty_current in 0013. */

export const PING_COOLDOWN_S = 2 * 3600;
export const EMPTY_COOLDOWN_S = 3600;

export type EventRoster = ReadonlyArray<{ user_id: string; active: boolean; away_until: string | null }>;

/** The rotation from the pointer on: the member after the last `done` carrier (after the later of two), first when none. */
export function turnQueue(order: ReadonlyArray<string>, roster: EventRoster, events: ReadonlyArray<DutyEvent>, today: string): string[] {
  const n = order.length;
  if (n === 0) return [];
  const last = events.filter((e) => e.kind === "done").reduce<DutyEvent | null>((a, e) => (!a || e.created_at >= a.created_at ? e : a), null);
  let base = -1;
  if (last) base = Math.max(order.indexOf(last.user_id), last.partner_id ? order.indexOf(last.partner_id) : -1);
  const start = (base + 1) % n;
  const rotated = Array.from({ length: n }, (_, i) => order[(start + i) % n]);
  const free = rotated.filter((id) => {
    const m = roster.find((r) => r.user_id === id);
    return !!m && m.active && !isAway(m.away_until, today);
  });
  return free.length > 0 ? free : rotated; // everybody away: the plain rotation stands
}

export const currentOf = (order: ReadonlyArray<string>, roster: EventRoster, events: ReadonlyArray<DutyEvent>, today: string): string | null =>
  turnQueue(order, roster, events, today)[0] ?? null;

export type WaterMode = "alone" | "pair";

export type WaterPlan = { bottles: number; liters: number; amount: number };

/** «Один»: 2 bottles, «Вдвоём»: 4. Amount = litres x price per liter. */
export function waterPlan(mode: WaterMode, bottleLiters: number, pricePerLiter: number): WaterPlan {
  const bottles = mode === "alone" ? 2 : 4;
  const liters = bottles * bottleLiters;
  return { bottles, liters, amount: liters * pricePerLiter };
}

/** «по 100 ₸ каждому» / «по 133–134 ₸»: what each participant owes (the payer's own share is settled at once). */
export function sharePerPerson(amount: number, people: number): { min: number; max: number } {
  return perPersonRange(amount, Math.max(people, 1));
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The Asia/Almaty wall time of an instant. */
function almatyParts(iso: string): { date: string; hhmm: string } {
  const t = new Date(Date.parse(iso) + 5 * 3600_000);
  return { date: almatyDay(new Date(iso)).date, hhmm: `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}` };
}

/** «сегодня, 21:40» / «вчера, 21:40» / «пн, 08:15» (within a week) / «03.11, 08:15». */
export function whenLabel(iso: string, today: string): string {
  const { date, hhmm } = almatyParts(iso);
  const diff = dayDiff(today, date);
  if (diff <= 0) return `сегодня, ${hhmm}`;
  if (diff === 1) return `вчера, ${hhmm}`;
  if (diff < 7) return `${DOW_SHORT[isoDow(date)]}, ${hhmm}`;
  return `${dayOfMonth(date)}.${date.slice(5, 7)}, ${hhmm}`;
}

/** Seconds left of a cooldown after the newest event of `kind`; 0 = free. */
export function cooldownLeft(events: ReadonlyArray<DutyEvent>, kind: "ping" | "empty", nowMs: number): number {
  const window = kind === "ping" ? PING_COOLDOWN_S : EMPTY_COOLDOWN_S;
  const last = events.filter((e) => e.kind === kind).reduce((m, e) => Math.max(m, Date.parse(e.created_at)), 0);
  return last ? Math.max(0, Math.ceil((last + window * 1000 - nowMs) / 1000)) : 0;
}

/** Done events in the last 7 days (today included). */
export function weekDoneCount(events: ReadonlyArray<DutyEvent>, today: string): number {
  return events.filter((e) => e.kind === "done" && dayDiff(today, almatyParts(e.created_at).date) < 7 && almatyParts(e.created_at).date <= today).length;
}

export type MonthStats = { liters: number; amount: number; weeks: number[]; carried: Array<{ user_id: string; count: number }> };

/**
 * Вода of a month: litres, tenge (litres x the price at hand), a bar per week of the month (1-7, 8-14, 15-21, 22+;
 * bar heights are 0..1 of the busiest week) and who carried how many times (a partner counts too), most first.
 */
export function waterMonth(events: ReadonlyArray<DutyEvent>, month: string, pricePerLiter: number, order: ReadonlyArray<string>): MonthStats {
  const weeks = [0, 0, 0, 0];
  const count = new Map<string, number>();
  let liters = 0;
  for (const e of events) {
    if (e.kind !== "done") continue;
    const { date } = almatyParts(e.created_at);
    if (monthOf(date) !== month) continue;
    const l = e.liters ?? 0;
    liters += l;
    weeks[Math.min(3, Math.floor((dayOfMonth(date) - 1) / 7))] += l;
    for (const u of [e.user_id, e.partner_id]) if (u) count.set(u, (count.get(u) ?? 0) + 1);
  }
  const max = Math.max(...weeks, 1);
  const carried = [...count.entries()]
    .map(([user_id, c]) => ({ user_id, count: c }))
    .sort((a, b) => b.count - a.count || order.indexOf(a.user_id) - order.indexOf(b.user_id));
  return { liters, amount: liters * pricePerLiter, weeks: weeks.map((w) => w / max), carried };
}

/** The week bar index of a day of the month (0..3), exported for the current-week highlight. */
export const weekOfMonth = (date: string): number => Math.min(3, Math.floor((dayOfMonth(date) - 1) / 7));

const VOWELS = "аеёиоуыэюя";

/** «Айдос» -> «Айдосу», «Дана» -> «Дане», «Дмитрий» -> «Дмитрию». A heuristic for first names; anything odd falls back to the plain name. */
export function dative(name: string): string {
  const n = name.trim();
  if (!n || !/[а-яё]$/i.test(n)) return n;
  const last = n.slice(-1).toLowerCase();
  const head = n.slice(0, -1);
  if (last === "а") return head + "е";
  if (last === "я") return head + "е";
  if (last === "й" || last === "ь") return head + "ю";
  if (VOWELS.includes(last)) return n;
  return n + "у";
}

/** «Айдос» -> «Айдосом», «Дана» -> «Даной», «Дмитрий» -> «Дмитрием». */
export function instrumental(name: string): string {
  const n = name.trim();
  if (!n || !/[а-яё]$/i.test(n)) return n;
  const last = n.slice(-1).toLowerCase();
  const head = n.slice(0, -1);
  if (last === "а") return head + "ой";
  if (last === "я") return head + "ей";
  if (last === "й" || last === "ь") return head + "ем";
  if (VOWELS.includes(last)) return n;
  return n + "ом";
}
