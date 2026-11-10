"use client";

import Link from "next/link";
import { memo, useMemo, useState } from "react";
import { Bar } from "@/components/ui/Bar";
import { BasketIcon, ChevronRightIcon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/EmptyState";
import { Money } from "@/components/ui/Money";
import { Pill, PillLink } from "@/components/ui/Pill";
import { Segmented } from "@/components/ui/Segmented";
import { filterPurchases, groupByDay, type PurchaseFilter } from "@/lib/domain/purchaseList";
import { purchaseProgress } from "@/lib/domain/summary";
import { formatDayMonth, formatTime } from "@/lib/format/date";
import { formatTenge } from "@/lib/format/money";
import { ru } from "@/lib/i18n/ru";
import type { UiPurchase } from "@/lib/data/purchaseTracker";
import { useAppData } from "../AppDataProvider";
import { Screen } from "../Screen";
import { useSwipeDelete } from "../swipe/useSwipeDelete";

const EMPTY: Record<PurchaseFilter, { title: string; text: string }> = {
  all: { title: ru.purchases.emptyTitle, text: ru.purchases.emptyText },
  mine: { title: ru.purchases.emptyMineTitle, text: ru.purchases.emptyMineText },
  owe: { title: ru.purchases.emptyOweTitle, text: ru.purchases.emptyOweText },
};

const Row = memo(function Row({ purchase, payerName, meId }: { purchase: UiPurchase; payerName: string; meId: string }) {
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
      prefetch={false}
      aria-label={ru.purchases.open(purchase.description, formatTenge(purchase.amount))}
      draggable={false}
      className="block transition-transform duration-200 ease-smooth active:scale-[0.98]"
    >
      {inner}
    </Link>
  );
});

type Wrap = ReturnType<typeof useSwipeDelete>["wrap"];

/** One list row. Re-renders only when its own purchase (structurally shared, so the same object across refreshes) changes. */
const Item = memo(function Item({ purchase, payerName, meId, wrap }: { purchase: UiPurchase; payerName: string; meId: string; wrap: Wrap }) {
  return (
    <li data-testid="purchase-list-row" className="row-cv">
      {wrap(purchase, <Row purchase={purchase} payerName={payerName} meId={meId} />)}
    </li>
  );
});

/** Rows rendered before «Показать ещё». */
const PAGE = 40;

/** Покупки tab: every visible purchase, grouped by day, with the filters «Все / Мои / Должен я». */
export function PurchasesScreen() {
  const { me, members, purchases, activeId } = useAppData();
  const [filter, setFilterState] = useState<PurchaseFilter>("all");
  const [limit, setLimit] = useState(PAGE);
  // the fade plays after a filter change only, never on the first paint
  const [fade, setFade] = useState(false);
  const setFilter = (f: PurchaseFilter) => {
    setFilterState(f);
    setLimit(PAGE);
    setFade(true);
  };
  const { wrap, sheet } = useSwipeDelete();

  const list = useMemo(() => (activeId ? (purchases[activeId] ?? []) : []), [purchases, activeId]);
  const names = useMemo(() => new Map((activeId ? (members[activeId] ?? []) : []).map((m) => [m.user_id, m.profile.display_name])), [members, activeId]);
  const groups = useMemo(() => (me ? groupByDay(filterPurchases(list, filter, me.id)) : []), [list, filter, me]);
  const visible = useMemo(() => {
    let left = limit;
    const out: typeof groups = [];
    for (const g of groups) {
      if (left <= 0) break;
      out.push(left >= g.items.length ? g : { ...g, items: g.items.slice(0, left) });
      left -= g.items.length;
    }
    return out;
  }, [groups, limit]);
  const total = useMemo(() => groups.reduce((n, g) => n + g.items.length, 0), [groups]);
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
        <EmptyState
          testId="purchases-empty"
          title={empty.title}
          text={empty.text}
          action={
            filter === "all" ? (
              <PillLink href="/purchases/new" variant="lime">
                {ru.purchases.emptyAction}
              </PillLink>
            ) : undefined
          }
        />
      ) : (
        <div key={filter} className={fade ? "list-fade-in flex flex-col gap-4" : "flex flex-col gap-4"}>
          {visible.map((g) => (
            <section key={g.key} aria-label={g.kind === "today" ? ru.purchases.today : g.kind === "yesterday" ? ru.purchases.yesterday : formatDayMonth(g.iso)} className="flex flex-col gap-2">
              <h2 className="px-[6px] text-caption">
                {g.kind === "today" ? ru.purchases.today : g.kind === "yesterday" ? ru.purchases.yesterday : formatDayMonth(g.iso)}
              </h2>
              <ul className="flex flex-col gap-2">
                {g.items.map((p) => (
                  <Item key={p.clientKey} purchase={p} payerName={names.get(p.payer_id) ?? ru.main.formerMember} meId={me.id} wrap={wrap} />
                ))}
              </ul>
            </section>
          ))}
          {total > limit ? (
            <Pill variant="on" size="lg" onClick={() => setLimit((n) => n + PAGE)} data-testid="purchases-more" className="self-center">
              {ru.purchases.showMore}
            </Pill>
          ) : null}
        </div>
      )}
      {sheet}
    </Screen>
  );
}
