import type { BalanceCardData, CardTone } from "@/components/ui/BalanceCard";
import { householdSummary } from "@/lib/domain/summary";
import { ru } from "@/lib/i18n/ru";
import { avatarColorFor } from "../avatars";
import type { Snapshot } from "../snapshot";

const TONES: ReadonlyArray<CardTone> = ["lime", "orange", "periwinkle"];
const monthFormat = new Intl.DateTimeFormat("ru-RU", { month: "long" });

export type Summary = ReturnType<typeof householdSummary>;

/** One summary per household, computed once; the cards and Главная's Долги read the same numbers. */
export function buildSummaries(snap: Snapshot): Record<string, Summary> {
  const { me, households, members, purchases } = snap;
  if (!me) return {};
  const out: Record<string, Summary> = {};
  for (const h of households) {
    const ps = purchases[h.id] ?? [];
    out[h.id] = householdSummary(me.id, members[h.id] ?? [], ps.flatMap((p) => p.shares), ps);
  }
  return out;
}

/** One BalanceCard per household (Главная and the Квартира switcher). */
export function buildCards(snap: Snapshot, summaries: Record<string, Summary>): BalanceCardData[] {
  const { me, households, members } = snap;
  if (!me) return [];
  const month = monthFormat.format(new Date());
  return households.map((h, i) => {
    const s = summaries[h.id];
    const ms = members[h.id] ?? [];
    return {
      id: h.id,
      name: h.name,
      paid: s.evenWith,
      total: s.others,
      chipLabel: ru.main.inSettleLabel(s.evenWith, s.others),
      balance: s.balance.net,
      tone: TONES[i % TONES.length],
      people: ms.map((m) => ({ name: m.profile.display_name, color: avatarColorFor(m.profile, me.id) })),
      caption: month,
    };
  });
}
