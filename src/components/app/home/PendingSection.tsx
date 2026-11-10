"use client";

import Link from "next/link";
import { memo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BasketIcon } from "@/components/ui/icons";
import { pillClass } from "@/components/ui/Pill";
import { formatTenge } from "@/lib/format/money";
import { ease, useReducedMotionSafe } from "@/lib/motion";
import type { UiPurchase } from "@/lib/data/purchaseTracker";
import { ru } from "@/lib/i18n/ru";

const timeFormat = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });

const Row = memo(function Row({ purchase }: { purchase: UiPurchase }) {
  const merchant = purchase.merchant ?? ru.pending.fallbackMerchant;
  return (
    <Link
      href={`/pending/${purchase.id}`}
      prefetch={false}
      data-testid="pending-row"
      aria-label={`${ru.pending.rowLabel(merchant, formatTenge(purchase.amount))}, ${ru.pending.decide}`}
      className="flex items-center gap-[10px] rounded-pill border border-card-2 bg-card p-[6px] transition-transform duration-200 ease-smooth active:scale-[0.98]"
    >
      <span aria-hidden="true" className="grid size-[44px] shrink-0 place-items-center rounded-full bg-lime-soft text-lime">
        <BasketIcon size={20} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-medium">{merchant}</span>
        <span className="truncate text-label !text-muted">{timeFormat.format(new Date(purchase.created_at))}</span>
      </div>
      <span className="font-rounded text-[16px] font-bold tabular-nums">{formatTenge(purchase.amount)}</span>
      <span aria-hidden="true" className={pillClass("lime", "sm", "!h-[34px] !px-4 !text-[13px] font-semibold")}>
        {ru.pending.decide}
      </span>
    </Link>
  );
});

/**
 * «Ждут решения»: Apple Pay purchases only I can see, until I say «Общее» or «Моё». Capsule rows with a lime «Решить»
 * (same row language as «Ждём подтверждения»). Renders nothing when there are none.
 */
export function PendingSection({ purchases }: { purchases: ReadonlyArray<UiPurchase> }) {
  const { reduced } = useReducedMotionSafe();
  const rows = purchases.filter((p) => p.status === "pending");
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="pending-title" data-testid="pending-section" className="flex flex-col gap-3">
      <h2 id="pending-title" className="text-headline">
        {ru.pending.title}
      </h2>
      <ul className="flex flex-col gap-3">
        <AnimatePresence initial={false}>
          {rows.map((p) => (
            <motion.li
              key={p.clientKey}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease: ease.smooth }}
            >
              <Row purchase={p} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </section>
  );
}
