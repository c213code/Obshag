import { formatTenge } from "@/lib/format/money";
import type { PendingDigestUser } from "@/lib/data/types";
import type { InlineKeyboard } from "./api";

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "нояб", "дек"];

/** «8 нояб, 14:32» in Asia/Almaty. */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Almaty", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${Number(get("day"))} ${MONTHS[Number(get("month")) - 1] ?? ""}, ${get("hour")}:${get("minute")}`;
}

/** The DM for one waiting purchase: «🛒 Small · 3 780 ₸ · 8 нояб, 14:32 / Чья покупка?». Plain text, no markup to escape. */
export function digestText(p: PendingDigestUser["purchases"][number]): string {
  const name = p.merchant?.trim() || "Покупка";
  return `🛒 ${name} · ${formatTenge(p.amount)} · ${formatWhen(p.created_at)}\nЧья покупка?`;
}

export const digestKeyboard = (id: string): InlineKeyboard => [
  [
    { text: "Общее", callback_data: `s:${id}` },
    { text: "Моё", callback_data: `p:${id}` },
  ],
];

/** One DM per purchase, at most 10 per user (the database already caps it). Failures are swallowed. */
export const MAX_DM = 10;
