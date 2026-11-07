"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Bar } from "@/components/ui/Bar";
import { BasketIcon, ChevronRightIcon } from "@/components/ui/icons";
import { Money } from "@/components/ui/Money";
import { PillLink } from "@/components/ui/Pill";
import { Segmented } from "@/components/ui/Segmented";
import { filterPurchases, groupByDay, type PurchaseFilter } from "@/lib/domain/purchaseList";
import { purchaseProgress } from "@/lib/domain/summary";
import { formatDayMonth, formatTime } from "@/lib/format/date";
import { formatTenge } from "@/lib/format/money";
import { ease, useReducedMotionSafe } from "@/lib/motion";
import { ru } from "@/lib/i18n/ru";
import type { UiPurchase } from "@/lib/data/purchaseTracker";
import { useAppData } from "../AppDataProvider";
import { Screen } from "../Screen";

const EMPTY: Record<PurchaseFilter, { title: string; text: string }> = {
  all: { title: ru.purchases.emptyTitle, text: ru.purchases.emptyText },
  mine: { title: ru.purchases.emptyMineTitle, text: ru.purchases.emptyMineText },
  owe: { title: ru.purchases.emptyOweTitle, text: ru.purchases.emptyOweText },
};

function Row({ purchase, payerName, meId }: { purchase: UiPurchase; payerName: string; meId: string }) {
  const { paid, total } = purchaseProgress(purchase.payer_id, purchase.shares);
  const mine = purchase.payer_id === meId;
  const caption = purchase.status === "personal" ? ru.main.personal : total === 0 ? ru.main.everyonePaid : ru.main.progress(paid, total);
  const who = mine ? ru.main.you : payerName;
  const source = [purchase.merchant, who, formatTime(purchase.created_at)].filter(Boolean).join(" · ");
  const inner = (
    <div className="flex items-center gap-3 rounded-pill border border-hairline bg-card p-[6px]">
      <span aria-hidden="true" className="grid size-[44px] shrink-0 place-items-center rounded-full bg-lime-soft text-lime">
        <BasketIcon size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-body">{purchase.description}</p>
        <p className="truncate text-caption">{source}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end">
        <Money value={purchase.amount} className="text-amount" />
        <span className="text-label !text-lime">
          {caption}
          {purchase.status === "shared" && total > 0 ? <span className="sr-only"> {ru.main.progressSuffix}</span> : null}
        </span>
      </div>
      <ChevronRightIcon size={18} className="mr-2 shrink-0 text-muted" />
    </div>
  );
  // an optimistic row has no page yet
  if (purchase.id.startsWith("optimistic-")) return inner;
  return (
    <Link
      href={`/purchases/${purchase.id}`}
      aria-label={ru.purchases.open(purchase.description, formatTenge(purchase.amount))}
      className="block transition-transform duration-200 ease-smooth active:scale-[0.98]"
    >
      {inner}
    </Link>
  );
}

/** Покупки tab: every visible purchase, grouped by day, with the filters «Все / Мои / Должен я». */
export function PurchasesScreen() {
  const { me, members, purchases, activeId } = useAppData();
  const { reduced } = useReducedMotionSafe();
  const [filter, setFilter] = useState<PurchaseFilter>("all");

  const list = useMemo(() => (activeId ? (purchases[activeId] ?? []) : []), [purchases, activeId]);
  const names = useMemo(() => new Map((activeId ? (members[activeId] ?? []) : []).map((m) => [m.user_id, m.profile.display_name])), [members, activeId]);
  const groups = useMemo(() => (me ? groupByDay(filterPurchases(list, filter, me.id)) : []), [list, filter, me]);
  if (!me || !activeId) return null;

  const empty = EMPTY[filter];
  return (
    <Screen topOffset={54} className="!gap-4">
      <Bar className="self-start px-5 py-3">
        <h1 className="text-headline">{ru.purchases.title}</h1>
      </Bar>
      <Segmented
        label={ru.purchases.filters}
        value={filter}
        onChange={setFilter}
        options={[
          { value: "all", label: ru.purchases.all },
          { value: "mine", label: ru.purchases.mine },
          { value: "owe", label: ru.purchases.owe },
        ]}
      />

      {groups.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-md bg-card p-4" data-testid="purchases-empty">
          <p className="text-headline">{empty.title}</p>
          <p className="text-caption">{empty.text}</p>
          {filter === "all" ? (
            <PillLink href="/purchases/new" variant="lime">
              {ru.purchases.emptyAction}
            </PillLink>
          ) : null}
        </div>
      ) : (
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={filter}
            className="flex flex-col gap-4"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: ease.smooth }}
          >
            {groups.map((g) => (
              <section key={g.key} aria-label={g.kind === "today" ? ru.purchases.today : g.kind === "yesterday" ? ru.purchases.yesterday : formatDayMonth(g.iso)} className="flex flex-col gap-2">
                <h2 className="px-[6px] text-caption">
                  {g.kind === "today" ? ru.purchases.today : g.kind === "yesterday" ? ru.purchases.yesterday : formatDayMonth(g.iso)}
                </h2>
                <ul className="flex flex-col gap-2">
                  {g.items.map((p) => (
                    <li key={p.clientKey} data-testid="purchase-list-row">
                      <Row purchase={p} payerName={names.get(p.payer_id) ?? ru.main.formerMember} meId={me.id} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </motion.div>
        </AnimatePresence>
      )}
    </Screen>
  );
}
