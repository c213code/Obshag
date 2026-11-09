"use client";

import { useRef, type ReactNode } from "react";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { spring } from "@/lib/motion";
import { ru } from "@/lib/i18n/ru";

const REVEAL = 112; // how far the row can be pulled (px)
const THRESHOLD = 84; // released past this (or flicked) asks for confirmation

/**
 * Swipe a row to the left to delete it. The row slides on `x` (transform), a «Удалить» capsule fades in behind it.
 * Release past the threshold, or tap the capsule, calls `onRequest`; the row always snaps back (the confirm sheet decides).
 * `dragDirectionLock` keeps vertical scrolling working. When `enabled` is false the row is a plain wrapper
 * (no permission, or reduced motion: the detail screen has its own delete).
 */
export function SwipeDeleteRow({ enabled, onRequest, children }: { enabled: boolean; onRequest: () => void; children: ReactNode }) {
  const x = useMotionValue(0);
  const hintOpacity = useTransform(x, [-REVEAL, -24, 0], [1, 0.6, 0]);
  const dragged = useRef(false);
  if (!enabled) return <>{children}</>;

  const snapBack = () => void animate(x, 0, spring.snap);
  return (
    <div className="relative" data-swipeable="true">
      <motion.button
        type="button"
        data-testid="swipe-delete"
        aria-label={ru.purchases.swipeDelete}
        tabIndex={-1}
        onClick={() => {
          snapBack();
          onRequest();
        }}
        style={{ opacity: hintOpacity }}
        className="absolute inset-y-0 right-0 flex w-[104px] items-center justify-center rounded-pill bg-danger text-headline !text-bg"
      >
        {ru.purchases.swipeDelete}
      </motion.button>
      <motion.div
        style={{ x }}
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: -REVEAL, right: 0 }}
        dragElastic={{ left: 0.12, right: 0 }}
        dragMomentum={false}
        onDragStart={() => {
          dragged.current = true;
        }}
        onDragEnd={(_, info) => {
          const past = info.offset.x < -THRESHOLD || info.velocity.x < -600;
          // a drag must not also count as a tap on the link inside
          setTimeout(() => {
            dragged.current = false;
          }, 0);
          snapBack();
          if (past) onRequest();
        }}
        onClickCapture={(e) => {
          if (dragged.current) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        className="relative"
      >
        {children}
      </motion.div>
    </div>
  );
}
