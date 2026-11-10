"use client";

import { memo, useRef, useState, type ReactNode } from "react";
import { animate, m, useMotionValue, useTransform } from "motion/react";
import { spring } from "@/lib/motion";
import { ru } from "@/lib/i18n/ru";

const ACTION = 84; // width of the «Удалить» block behind the row (px)
const OPEN = ACTION + 8; // a short swipe parks the row here, uncovering the block
const OPEN_AT = 44; // released past this: park open; less: snap back (an accidental nudge does nothing)
const FULL = 170; // a long pull (or a hard flick) goes straight to the confirmation
const DRAG_CONSTRAINTS = { left: -OPEN, right: 0 } as const;
const DRAG_ELASTIC = { left: 0.35, right: 0 } as const;

function TrashIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
    </svg>
  );
}

/**
 * Swipe a row to the left (iOS-style). A short swipe parks the row open and uncovers a red «Удалить» block;
 * tapping the block, or one long pull, asks for confirmation. A small nudge just snaps back. Tapping the row while it is
 * open closes it. `dragDirectionLock` keeps vertical scrolling working. When `enabled` is false the row is a plain wrapper.
 */
export const SwipeDeleteRow = memo(function SwipeDeleteRow({ enabled, onRequest, children }: { enabled: boolean; onRequest: () => void; children: ReactNode }) {
  const x = useMotionValue(0);
  const actionOpacity = useTransform(x, [-OPEN, -16, 0], [1, 0.4, 0]);
  const dragged = useRef(false);
  const open = useRef(false);
  /** The red block exists only while the row is moved or parked open (nothing extra at rest). */
  const [revealed, setRevealed] = useState(false);
  if (!enabled) return <>{children}</>;

  const close = () => {
    open.current = false;
    void animate(x, 0, spring.snap).then(() => {
      if (x.get() === 0) setRevealed(false);
    });
  };
  const park = () => {
    open.current = true;
    void animate(x, -OPEN, spring.snap);
  };

  return (
    <div className="relative" data-swipeable="true">
      {revealed ? (
        <m.button
          type="button"
          data-testid="swipe-delete"
          aria-label={ru.purchases.swipeDelete}
          tabIndex={-1}
          onClick={() => {
            close();
            onRequest();
          }}
          style={{ opacity: actionOpacity, width: ACTION }}
          className="absolute inset-y-0 right-0 flex flex-col items-center justify-center gap-1 rounded-[18px] bg-danger text-[12px] font-semibold text-bg"
        >
          <TrashIcon />
          {ru.purchases.swipeDelete}
        </m.button>
      ) : null}
      <m.div
        style={{ x }}
        drag="x"
        dragDirectionLock
        dragConstraints={DRAG_CONSTRAINTS}
        dragElastic={DRAG_ELASTIC}
        dragMomentum={false}
        onDragStart={() => {
          dragged.current = true;
          setRevealed(true);
        }}
        onDragEnd={(_, info) => {
          // a drag must not also count as a tap on the link inside
          setTimeout(() => {
            dragged.current = false;
          }, 0);
          const pulled = -info.offset.x + (open.current ? OPEN : 0);
          if (pulled > FULL || info.velocity.x < -1400) {
            close();
            onRequest();
          } else if (pulled > OPEN_AT && info.velocity.x < 400) {
            park();
          } else {
            close();
          }
        }}
        onClickCapture={(e) => {
          if (dragged.current || open.current) {
            // a tap on a parked-open row closes it instead of opening the purchase
            e.preventDefault();
            e.stopPropagation();
            if (!dragged.current) close();
          }
        }}
        className="relative"
      >
        {children}
      </m.div>
    </div>
  );
});
