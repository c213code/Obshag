import type { Duty, DutyDay, DutySource, SwapRequest } from "@/lib/data/types";

/** Dates are 'YYYY-MM-DD' strings of the Asia/Almaty calendar; all maths below is done in UTC on those strings. */
const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");

export const SWAP_REASON_MAX = 140;
/** A swap request lives until the earlier of the two days at this hour (Almaty). */
export const SWAP_DEADLINE_HOUR = 10;
/** Yesterday can still be marked done before this hour of the next morning (the 09:00 cron locks it). */
export const DONE_LOCK_HOUR = 9;

export const toUtc = (date: string): number => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
export const fromUtc = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
export const addDays = (date: string, n: number): string => fromUtc(toUtc(date) + n * DAY_MS);
export const dayDiff = (a: string, b: string): number => Math.round((toUtc(a) - toUtc(b)) / DAY_MS);
/** 0 = Monday .. 6 = Sunday. */
export const isoDow = (date: string): number => (new Date(toUtc(date)).getUTCDay() + 6) % 7;
export const dayOfMonth = (date: string): number => Number(date.slice(8, 10));
export const monthOf = (date: string): string => date.slice(0, 7);
export const daysInMonth = (month: string): number => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

export const DOW_SHORT = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"] as const;
export const DOW_CAP = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;
export const DOW_FULL = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"] as const;
export const MONTHS_GEN = [
  "января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря",
] as const;
export const MONTHS_NOM = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
] as const;

/** «пн, 17 ноября» */
export const longDay = (date: string): string => `${DOW_SHORT[isoDow(date)]}, ${dayOfMonth(date)} ${MONTHS_GEN[Number(date.slice(5, 7)) - 1]}`;
/** «пн, 17» */
export const shortDay = (date: string): string => `${DOW_SHORT[isoDow(date)]}, ${dayOfMonth(date)}`;
/** «понедельник, 17 ноября» */
export const fullDay = (date: string): string => `${DOW_FULL[isoDow(date)]}, ${dayOfMonth(date)} ${MONTHS_GEN[Number(date.slice(5, 7)) - 1]}`;
/** «Ноябрь 2026» */
export const monthTitle = (month: string): string => `${MONTHS_NOM[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

// ---------------------------------------------------------------- who has the day (mirror of private.duty_resolve)

export type RosterEntry = { user_id: string; active: boolean; away_until: string | null };

export type DutyState = {
  duty: Pick<Duty, "start_date" | "order">;
  roster: ReadonlyArray<RosterEntry>;
  overrides: ReadonlyMap<string, { user_id: string; source: "swap" | "admin" }>;
  done: ReadonlyMap<string, string>;
  today: string;
};

export type Resolved = { user_id: string; source: DutySource; plain: string };

/**
 * An override wins; then a recorded «приготовил»; else rotation[(day - start) mod n]. From today on a member who is away
 * (away_until >= day) or inactive is skipped: the next available one in rotation order takes the day. Past days use the
 * plain rotation. Everybody away: the plain rotation stands. Before the start date nobody has the day (null).
 */
export function resolveDay(state: DutyState, day: string): Resolved | null {
  const o = state.overrides.get(day);
  if (o) return { user_id: o.user_id, source: o.source, plain: o.user_id };
  const d = state.done.get(day);
  if (d) return { user_id: d, source: "rotation", plain: d };
  const order = state.duty.order;
  const n = order.length;
  if (n === 0 || day < state.duty.start_date) return null;
  const idx = dayDiff(day, state.duty.start_date) % n;
  const plain = order[idx];
  if (day < state.today) return { user_id: plain, source: "rotation", plain };
  for (let i = 0; i < n; i++) {
    const cand = order[(idx + i) % n];
    const m = state.roster.find((r) => r.user_id === cand);
    if (m && m.active && (m.away_until === null || m.away_until < day)) {
      return { user_id: cand, source: i === 0 ? "rotation" : "skip", plain };
    }
  }
  return { user_id: plain, source: "rotation", plain };
}

/** The earlier of the two days at 10:00 Asia/Almaty (UTC+5), as an ISO instant. */
export function swapExpiresAt(fromDay: string, toDay: string): string {
  const first = fromDay < toDay ? fromDay : toDay;
  return new Date(toUtc(first) + (SWAP_DEADLINE_HOUR - 5) * 3_600_000).toISOString();
}

/** What a stored request effectively is: a pending one past its deadline already counts as expired. */
export const effectiveStatus = (r: Pick<SwapRequest, "status" | "expires_at">, nowMs: number): SwapRequest["status"] =>
  r.status === "pending" && Date.parse(r.expires_at) <= nowMs ? "expired" : r.status;

/** «ещё 5 ч» / «ещё 40 мин» / «ещё 2 д»; null once it is over. */
export function timeLeft(expiresAt: string, nowMs: number): { unit: "d" | "h" | "m"; n: number } | null {
  const ms = Date.parse(expiresAt) - nowMs;
  if (!(ms > 0)) return null;
  const min = Math.ceil(ms / 60_000);
  if (min < 60) return { unit: "m", n: Math.max(1, min) };
  const h = Math.ceil(min / 60);
  if (h < 24) return { unit: "h", n: h };
  return { unit: "d", n: Math.ceil(h / 24) };
}

// ---------------------------------------------------------------- colours of people

export const TONES = ["lime", "orange", "violet", "blue", "rose", "teal"] as const;
export type Tone = (typeof TONES)[number];

/** Static class names (Tailwind must see them whole). */
export const TONE_BG: Record<Tone, string> = {
  lime: "bg-duty-lime text-on-duty-lime",
  orange: "bg-duty-orange text-on-duty-orange",
  violet: "bg-duty-violet text-on-duty-violet",
  blue: "bg-duty-blue text-on-duty-blue",
  rose: "bg-duty-rose text-on-duty-rose",
  teal: "bg-duty-teal text-on-duty-teal",
};
export const TONE_DOT: Record<Tone, string> = {
  lime: "bg-duty-lime",
  orange: "bg-duty-orange",
  violet: "bg-duty-violet",
  blue: "bg-duty-blue",
  rose: "bg-duty-rose",
  teal: "bg-duty-teal",
};

/** Me is lime; everybody else gets the next free tone in rotation order (stable while the order stays). */
export function toneMap(order: ReadonlyArray<string>, meId: string | null): Map<string, Tone> {
  const others = TONES.filter((t) => t !== "lime");
  const out = new Map<string, Tone>();
  let i = 0;
  for (const id of order) out.set(id, id === meId ? "lime" : others[i++ % others.length]);
  return out;
}

/** The one-letter label inside a circle: first letter of the name, upper case. */
export const letterOf = (name: string): string => Array.from(name.trim())[0]?.toUpperCase() ?? "?";

// ---------------------------------------------------------------- week / month view models

export type DayKind = "past" | "today" | "future";

export type DayCell = {
  date: string;
  dow: number;
  dom: number;
  kind: DayKind;
  user_id: string | null;
  source: DutySource | null;
  done: boolean;
  swapped: boolean;
  /** Plane: the person this day would have gone to is away. */
  skipped_user: string | null;
  pending: boolean;
};

const cellOf = (date: string, today: string, plan: ReadonlyMap<string, DutyDay>): DayCell => {
  const p = plan.get(date);
  return {
    date,
    dow: isoDow(date),
    dom: dayOfMonth(date),
    kind: date < today ? "past" : date === today ? "today" : "future",
    user_id: p?.user_id ?? null,
    source: p?.source ?? null,
    done: p?.done ?? false,
    swapped: p?.source === "swap",
    skipped_user: p?.skipped_user ?? null,
    pending: !!p?.request_id,
  };
};

const byDay = (plan: ReadonlyArray<DutyDay>) => new Map(plan.map((d) => [d.day, d]));

/** Monday of the week that contains `date`. */
export const weekStart = (date: string): string => addDays(date, -isoDow(date));

/** The 7 days Mon..Sun of the week of `today`. */
export function buildWeek(plan: ReadonlyArray<DutyDay>, today: string): DayCell[] {
  const map = byDay(plan);
  const start = weekStart(today);
  return Array.from({ length: 7 }, (_, i) => cellOf(addDays(start, i), today, map));
}

/** Month grid, Monday first: `lead` empty cells, then every day of the month. */
export function buildMonth(plan: ReadonlyArray<DutyDay>, month: string, today: string): { lead: number; cells: DayCell[] } {
  const map = byDay(plan);
  const first = `${month}-01`;
  return {
    lead: isoDow(first),
    cells: Array.from({ length: daysInMonth(month) }, (_, i) => cellOf(addDays(first, i), today, map)),
  };
}

export type StatRow = { user_id: string; done: number; total: number };

/** «приготовил / дни» per person for a month: days of the month assigned to them, and how many were cooked. */
export function monthStats(plan: ReadonlyArray<DutyDay>, month: string, order: ReadonlyArray<string>): StatRow[] {
  const rows = new Map<string, StatRow>(order.map((id) => [id, { user_id: id, done: 0, total: 0 }]));
  for (const d of plan) {
    if (monthOf(d.day) !== month) continue;
    const row = rows.get(d.user_id) ?? { user_id: d.user_id, done: 0, total: 0 };
    row.total += 1;
    if (d.done) row.done += 1;
    rows.set(d.user_id, row);
  }
  return [...rows.values()];
}

/** «сегодня» / «завтра» / «чт, 20»: the next day on or after `today` that belongs to each person. */
export function nextDayOf(plan: ReadonlyArray<DutyDay>, userId: string, today: string): string | null {
  const hit = plan.find((d) => d.day >= today && d.user_id === userId);
  return hit ? hit.day : null;
}

/** Order screen labels. */
export function nextLabel(day: string | null, today: string): string {
  if (!day) return "—";
  const diff = dayDiff(day, today);
  return diff === 0 ? "сегодня" : diff === 1 ? "завтра" : shortDay(day);
}

/** Upcoming days of the plan owned by `userId` (today or later). */
export const upcomingOf = (plan: ReadonlyArray<DutyDay>, userId: string, today: string): DutyDay[] =>
  plan.filter((d) => d.day >= today && d.user_id === userId);

/**
 * The swap sheet's quick picks for «my day»: the closest upcoming day of somebody else before it (if it is still ahead)
 * and after it. Days already inside a pending request are left out.
 */
export function neighbours(plan: ReadonlyArray<DutyDay>, myDay: string, meId: string, today: string): { before: DutyDay | null; after: DutyDay | null } {
  const open = plan.filter((d) => d.user_id !== meId && !d.request_id && d.day >= today);
  const before = [...open].reverse().find((d) => d.day < myDay) ?? null;
  const after = open.find((d) => d.day > myDay) ?? null;
  return { before, after };
}
