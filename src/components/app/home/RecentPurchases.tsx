"use client";

import Link from "next/link";
import { useMemo } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { PillLink } from "@/components/ui/Pill";
import { usePresenceList } from "@/lib/motion/presence";
import { cx } from "@/components/ui/cx";
import type { UiPurchase } from "@/lib/data/purchaseTracker";
import { ru } from "@/lib/i18n/ru";
import { useSwipeDelete } from "../swipe/useSwipeDelete";
import { PurchaseCard } from "./PurchaseCard";

const MAX_ROWS = 5;

/** "Последние покупки". A purchase added now slides in at the top at once (optimistic), the rest shift down. */
export function RecentPurchases({
  purchases,
  payerNames,
}: {
  purchases: ReadonlyArray<UiPurchase>;
  /** user id -> display name for the people in this household. */
  payerNames: ReadonlyMap<string, string>;
}) {
  const { wrap, sheet } = useSwipeDelete();
  const shown = useMemo(() => purchases.slice(0, MAX_ROWS), [purchases]);
  const entries = usePresenceList(shown, (p) => p.clientKey, 400);
  return (
    <section aria-labelledby="recent-title" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 id="recent-title" className="text-headline">
          {ru.main.recent}
        </h2>
        <Link href="/purchases" className="text-caption !text-lime">
          {ru.main.all}
        </Link>
      </div>
      {purchases.length === 0 ? (
        <EmptyState
          testId="home-empty"
          title={ru.main.emptyTitle}
          text={ru.main.emptyText}
          action={
            <PillLink href="/purchases/new" variant="lime">
              {ru.main.emptyAction}
            </PillLink>
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {entries.map(({ key, item: p, exiting, fresh }) => (
            <li key={key} data-testid="purchase-row" className={cx("[--enter-y:-16px]", exiting ? "leave" : fresh && "enter")}>
                {wrap(
                  p,
                  p.id.startsWith("optimistic-") ? (
                    <PurchaseCard purchase={p} payerName={payerNames.get(p.payer_id) ?? ru.main.formerMember} />
                  ) : (
                    <Link href={`/purchases/${p.id}`} prefetch={false} draggable={false} className="block transition-transform duration-200 ease-smooth active:scale-[0.98]">
                      <PurchaseCard purchase={p} payerName={payerNames.get(p.payer_id) ?? ru.main.formerMember} />
                    </Link>
                  ),
                )}
            </li>
          ))}
        </ul>
      )}
      {sheet}
    </section>
  );
}
