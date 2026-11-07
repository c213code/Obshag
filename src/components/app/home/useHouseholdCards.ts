import { useMemo } from "react";
import type { BalanceCardData, CardTone } from "@/components/ui/BalanceCard";
import type { Household, Profile } from "@/lib/data/types";
import type { MemberWithProfile } from "@/lib/data/repo";
import type { UiPurchase } from "@/lib/data/purchaseTracker";
import { householdSummary } from "@/lib/domain/summary";
import { ru } from "@/lib/i18n/ru";
import { avatarColorFor } from "../avatars";

const TONES: ReadonlyArray<CardTone> = ["lime", "orange", "periwinkle"];
const monthName = () => new Intl.DateTimeFormat("ru-RU", { month: "long" }).format(new Date());

/** One BalanceCard per household (Главная and the Квартира switcher). */
export function useHouseholdCards(
  me: Profile | null,
  households: ReadonlyArray<Household>,
  members: Record<string, MemberWithProfile[]>,
  purchases: Record<string, UiPurchase[]>,
): BalanceCardData[] {
  return useMemo(() => {
    if (!me) return [];
    const month = monthName();
    return households.map((h, i) => {
      const ps = purchases[h.id] ?? [];
      const ms = members[h.id] ?? [];
      const s = householdSummary(me.id, ms, ps.flatMap((p) => p.shares), ps);
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
  }, [me, households, members, purchases]);
}
