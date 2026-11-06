"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
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
        <div className="flex flex-col items-start gap-3 rounded-md bg-card p-4">
          <p className="text-headline">{ru.main.emptyTitle}</p>
          <p className="text-caption">{ru.main.emptyText}</p>
          <PillLink href="/purchases/new" variant="lime">
            {ru.main.emptyAction}
          </PillLink>
        </div>
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
                <PurchaseCard purchase={p} payerName={payerNames.get(p.payer_id) ?? ru.main.formerMember} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}
