"use client";

import { useCallback, useMemo } from "react";
import { CardStack } from "@/components/ui/CardStack";
import type { Bill } from "@/lib/data/types";
import { ru } from "@/lib/i18n/ru";
import { useAppActions, useAppData, useAppDerived } from "../AppDataProvider";
import { Screen } from "../Screen";
import { Bento } from "./Bento";
import { DutyTile } from "./DutyTile";
import { HomeHeader } from "./HomeHeader";
import { IncomingSection } from "./IncomingSection";
import { PendingSection } from "./PendingSection";
import { RecentPurchases } from "./RecentPurchases";
import { ToPaySection } from "./ToPaySection";
import { WaitingSection } from "./WaitingSection";

const NONE_BILLS: Bill[] = [];

/** Главная, per bento mockup: header (flat pill, bell, avatar), card stack, bento grid, Последние покупки. */
export function HomeScreen() {
  const { me, members, purchases, bills, activeId } = useAppData();
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

  const flats = useMemo(() => cards.map((c) => ({ id: c.id, name: c.name })), [cards]);
  const activeBills = (activeId && bills[activeId]) || NONE_BILLS;

  const recent = useMemo(() => (data ? data.ps.filter((p) => p.status !== "pending") : []), [data]);

  if (!me || !data || !active) return null;

  return (
    <Screen>
      {/* the bell dot means unread notifications: there is no inbox before slice 5, so it stays hidden (the slot is kept) */}
      <HomeHeader name={me.display_name} flats={flats} activeId={activeId} onSwitch={switchHousehold} unread={0} />
      <PendingSection purchases={data.ps} />
      <div className="-mt-2">
        <CardStack cards={cards} frontId={activeId ?? undefined} onFrontChange={onFrontChange} />
      </div>
      <Bento owed={active.balance.owed} owe={active.balance.owe} bills={activeBills} purchases={data.ps} meId={me.id} />
      <ToPaySection />
      <DutyTile />
      <IncomingSection />
      <WaitingSection />
      <RecentPurchases purchases={recent} payerNames={data.names} />
    </Screen>
  );
}
