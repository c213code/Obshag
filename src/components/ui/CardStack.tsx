"use client";

import { useEffect, useId, useRef, useState } from "react";
import { motion } from "motion/react";
import { ease, useReducedMotionSafe, useTapLock } from "@/lib/motion";
import { ru } from "@/lib/i18n/ru";
import { BalanceCard, CARD_HEIGHT, type BalanceCardData } from "./BalanceCard";

const STEP = 20;
const SCALE_STEP = 0.06;
const MAX_DEPTH = 2;
/** The front card slides down and back this long before the order rotates. */
const SLIDE_MS = 220;
const LOCK_MS = 700;

/**
 * 2-3 BalanceCards (approved reference #5). The front card slides down and back, then the
 * next card comes forward. Cards are bottom-anchored; deeper cards sit higher, smaller and
 * darker (a dim overlay, not a filter). Transform + opacity only.
 *
 * The order is derived from `cards` plus a rotation offset, so the `cards` prop stays the source of truth.
 * With a single card nothing is interactive.
 */
export function CardStack({ cards }: { cards: ReadonlyArray<BalanceCardData> }) {
  const n = cards.length;
  const [offset, setOffset] = useState(0);
  const [sliding, setSliding] = useState(false);
  const lock = useTapLock(LOCK_MS);
  const { reduced } = useReducedMotionSafe();
  const hintId = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const frontIndex = n > 0 ? offset % n : 0;
  const interactive = n >= 2;

  const advance = () => {
    if (!interactive) return;
    lock(() => {
      setSliding(true);
      timer.current = setTimeout(() => {
        setOffset((o) => (o + 1) % n);
        setSliding(false);
      }, reduced ? 0 : SLIDE_MS);
    });
  };

  const depthOf = (i: number) => (i - frontIndex + n) % n;
  const rows = Math.max(Math.min(n - 1, MAX_DEPTH), 0);
  // How far the deepest card pokes above the front one (its top also drops as it scales down).
  const peek = Math.ceil(rows * (STEP - SCALE_STEP * CARD_HEIGHT));

  return (
    <div
      data-testid="card-stack"
      data-front={cards[frontIndex]?.name}
      className="relative"
      style={{ height: CARD_HEIGHT + peek }}
    >
      {cards.map((card, i) => {
        const depth = depthOf(i);
        const d = Math.min(depth, MAX_DEPTH);
        const isFront = depth === 0;
        const slidingFront = isFront && sliding;
        const target = reduced
          ? { opacity: isFront ? 1 : 0 }
          : slidingFront
            ? { y: 36, scale: 0.94, opacity: 1 }
            : { y: -d * STEP, scale: 1 - d * SCALE_STEP, opacity: depth > MAX_DEPTH ? 0 : 1 };
        const balanceId = `${hintId}-balance-${card.id}`;
        return (
          <motion.div
            key={card.id}
            className="absolute inset-x-0 bottom-0 origin-bottom"
            style={{ zIndex: n - depth }}
            initial={false}
            animate={target}
            transition={{ duration: slidingFront ? SLIDE_MS / 1000 : 0.6, ease: ease.smooth }}
          >
            {isFront && interactive ? (
              <>
                <button
                  type="button"
                  data-testid="balance-card-front"
                  aria-describedby={hintId}
                  onClick={advance}
                  className="block w-full rounded-lg text-left"
                >
                  <BalanceCard data={card} balanceId={balanceId} />
                </button>
                <span id={hintId} hidden>
                  {ru.common.nextCard}
                </span>
              </>
            ) : (
              <div
                data-testid={isFront ? "balance-card-front" : undefined}
                aria-hidden={isFront ? undefined : true}
              >
                <BalanceCard data={card} balanceId={balanceId} />
              </div>
            )}
            {/* depth shading: an opacity-animated overlay (not a filter) */}
            <motion.div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-lg bg-island"
              initial={false}
              animate={{ opacity: reduced ? 0 : d * 0.25 }}
              transition={{ duration: 0.6, ease: ease.smooth }}
            />
          </motion.div>
        );
      })}
    </div>
  );
}
