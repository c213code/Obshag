"use client";

import { motion } from "motion/react";
import { ease, useReducedMotionSafe } from "@/lib/motion";
import { ru } from "@/lib/i18n/ru";
import { CARD_HEIGHT } from "./BalanceCard";
import { cx } from "./cx";

/** Shimmer by opacity only. Static under reduced motion. */
export function Skeleton({ className }: { className?: string }) {
  const { reduced } = useReducedMotionSafe();
  return (
    <motion.div
      aria-hidden="true"
      className={cx("rounded-md bg-card-2", className)}
      initial={{ opacity: 0.45 }}
      animate={{ opacity: reduced ? 0.7 : [0.45, 0.9, 0.45] }}
      transition={{ duration: 1.4, ease: ease.smooth, repeat: Infinity }}
    />
  );
}

function Busy({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={ru.common.loading} className={className}>
      {children}
    </div>
  );
}

/** Same footprint as BalanceCard: title + chip, big amount, avatar stack. */
export function SkeletonCard() {
  return (
    <Busy>
      <div
        style={{ height: CARD_HEIGHT }}
        className="flex flex-col justify-between rounded-lg border border-hairline bg-card p-4"
      >
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-6 w-14 rounded-pill" />
        </div>
        <Skeleton className="h-10 w-44" />
        <div className="flex">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className={cx("size-[26px] rounded-full", i > 0 && "-ml-2")} />
          ))}
        </div>
      </div>
    </Busy>
  );
}

/** Same footprint as ListRow: avatar, two text lines, trailing chip. */
export function SkeletonRow() {
  return (
    <Busy className="flex items-center gap-3 rounded-pill border border-hairline bg-card p-[6px]">
      <Skeleton className="size-[44px] shrink-0 rounded-full" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-3 w-1/3" />
      </div>
      <Skeleton className="mr-1 h-8 w-20 rounded-pill" />
    </Busy>
  );
}

/** Placeholder for a large money value (text-display). */
export function SkeletonAmount() {
  return (
    <Busy>
      <Skeleton className="h-10 w-40" />
    </Busy>
  );
}
