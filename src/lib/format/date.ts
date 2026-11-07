const time = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });
const dayMonth = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });
const dayMonthShort = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });

export type DayKind = "today" | "yesterday" | "other";

/** Local calendar-day number: equal for two instants on the same local date. */
const dayNumber = (d: Date) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);

export function dayKind(iso: string, now: Date = new Date()): DayKind {
  const diff = dayNumber(now) - dayNumber(new Date(iso));
  return diff === 0 ? "today" : diff === 1 ? "yesterday" : "other";
}

/** "18:40" */
export const formatTime = (iso: string): string => time.format(new Date(iso));

/** "5 ноября" (group headers) */
export const formatDayMonth = (iso: string): string => dayMonth.format(new Date(iso));

/** "сегодня 18:40" / "вчера 18:40" / "5 нояб. 18:40" (detail card). */
export function formatWhen(iso: string, labels: { today: (t: string) => string; yesterday: (t: string) => string }, now: Date = new Date()): string {
  const kind = dayKind(iso, now);
  const t = formatTime(iso);
  if (kind === "today") return labels.today(t);
  if (kind === "yesterday") return labels.yesterday(t);
  return `${dayMonthShort.format(new Date(iso))} ${t}`;
}
