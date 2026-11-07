"use client";

import { useMemo } from "react";
import { CardStack } from "@/components/ui/CardStack";
import type { BalanceCardData, CardTone } from "@/components/ui/BalanceCard";
import { householdSummary } from "@/lib/domain/summary";
import { ru } from "@/lib/i18n/ru";
import { useAppActions, useAppData } from "../AppDataProvider";
import { Screen } from "../Screen";
import { avatarColorFor } from "../avatars";
import { DebtsCard } from "./DebtsCard";
import { GreetingHeader } from "./GreetingHeader";
import { IncomingSection } from "./IncomingSection";
import { PendingSection } from "./PendingSection";
import { QuickActions } from "./QuickActions";
import { RecentPurchases } from "./RecentPurchases";
import { WaitingSection } from "./WaitingSection";

const TONES: ReadonlyArray<CardTone> = ["lime", "orange", "periwinkle"];
const monthName = () => new Intl.DateTimeFormat("ru-RU", { month: "long" }).format(new Date());

/** Главная, per Main.dc.html: greeting, card stack, quick actions, Долги, Последние покупки. */
export function HomeScreen() {
  const { me, households, members, purchases, activeId } = useAppData();
  const { setActiveId } = useAppActions();

  const data = useMemo(() => {
    if (!me) return null;
    const month = monthName();
    const cards: BalanceCardData[] = households.map((h, i) => {
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
    const ps = (activeId && purchases[activeId]) || [];
    const activeMembers = (activeId && members[activeId]) || [];
    const active = householdSummary(me.id, activeMembers, ps.flatMap((p) => p.shares), ps);
    const names = new Map(activeMembers.map((m) => [m.user_id, m.user_id === me.id ? ru.main.you : m.profile.display_name]));
    return { cards, active, ps, names };
  }, [me, households, members, purchases, activeId]);

  const recent = useMemo(() => (data ? data.ps.filter((p) => p.status !== "pending") : []), [data]);

  if (!me || !data) return null;

  return (
    <Screen>
      {/* the bell dot means unread notifications: there is no inbox before slice 5, so it stays hidden (the slot is kept) */}
      <GreetingHeader name={me.display_name} initial={me.display_name} unread={0} />
      <PendingSection purchases={data.ps} />
      <div className="-mt-2">
        <CardStack cards={data.cards} frontId={activeId ?? undefined} onFrontChange={setActiveId} />
      </div>
      <QuickActions />
      <DebtsCard owe={data.active.balance.owe} owed={data.active.balance.owed} />
      <IncomingSection />
      <WaitingSection />
      <RecentPurchases purchases={recent} payerNames={data.names} />
    </Screen>
  );
}
