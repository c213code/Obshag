"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { EmptyState } from "@/components/ui/EmptyState";
import { PillLink } from "@/components/ui/Pill";
import { ease, useReducedMotionSafe } from "@/lib/motion";
import type { UiPurchase } from "@/lib/data/purchaseTracker";
import { ru } from "@/lib/i18n/ru";
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
  const { reduced } = useReducedMotionSafe();
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
          <AnimatePresence initial={false}>
            {purchases.slice(0, MAX_ROWS).map((p) => (
              <motion.li
                key={p.clientKey}
                data-testid="purchase-row"
                layout={reduced ? false : "position"}
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: -16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4, ease: ease.smooth }}
              >
                {p.id.startsWith("optimistic-") ? (
                  <PurchaseCard purchase={p} payerName={payerNames.get(p.payer_id) ?? ru.main.formerMember} />
                ) : (
                  <Link href={`/purchases/${p.id}`} className="block transition-transform duration-200 ease-smooth active:scale-[0.98]">
                    <PurchaseCard purchase={p} payerName={payerNames.get(p.payer_id) ?? ru.main.formerMember} />
                  </Link>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}
