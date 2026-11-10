"use client";

import { useCallback, useMemo } from "react";
import { CardStack } from "@/components/ui/CardStack";
import { ru } from "@/lib/i18n/ru";
import { useAppActions, useAppData, useAppDerived } from "../AppDataProvider";
import { Screen } from "../Screen";
import { DebtsCard } from "./DebtsCard";
import { GreetingHeader } from "./GreetingHeader";
import { IncomingSection } from "./IncomingSection";
import { PendingSection } from "./PendingSection";
import { QuickActions } from "./QuickActions";
import { RecentPurchases } from "./RecentPurchases";
import { WaitingSection } from "./WaitingSection";

/** Главная, per Main.dc.html: greeting, card stack, quick actions, Долги, Последние покупки. */
export function HomeScreen() {
  const { me, members, purchases, activeId } = useAppData();
  const { switchHousehold } = useAppActions();
  const { cards, active } = useAppDerived();

  const onFrontChange = useCallback((id: string) => id !== activeId && void switchHousehold(id), [activeId, switchHousehold]);

  const data = useMemo(() => {
    if (!me) return null;
    const ps = (activeId && purchases[activeId]) || [];
    const activeMembers = (activeId && members[activeId]) || [];
    const names = new Map(activeMembers.map((m) => [m.user_id, m.user_id === me.id ? ru.main.you : m.profile.display_name]));
    return { ps, names };
  }, [me, members, purchases, activeId]);

  const recent = useMemo(() => (data ? data.ps.filter((p) => p.status !== "pending") : []), [data]);

  if (!me || !data || !active) return null;

  return (
    <Screen>
      {/* the bell dot means unread notifications: there is no inbox before slice 5, so it stays hidden (the slot is kept) */}
      <GreetingHeader name={me.display_name} initial={me.display_name} unread={0} />
      <PendingSection purchases={data.ps} />
      <div className="-mt-2">
        <CardStack cards={cards} frontId={activeId ?? undefined} onFrontChange={onFrontChange} />
      </div>
      <QuickActions />
      <DebtsCard owe={active.balance.owe} owed={active.balance.owed} />
      <IncomingSection />
      <WaitingSection />
      <RecentPurchases purchases={recent} payerNames={data.names} />
    </Screen>
  );
}
