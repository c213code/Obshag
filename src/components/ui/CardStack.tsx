"use client";

import { memo, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { css, useReducedMotionSafe, useTapLock } from "@/lib/motion";
import { ru } from "@/lib/i18n/ru";
import { BalanceCard, CARD_HEIGHT, type BalanceCardData } from "./BalanceCard";

/** Main.dc.html: each layer behind peeks out 10px above the one in front and is ~7% narrower. */
const PEEK = 10;
const SCALE_STEP = 0.07;
const STEP = PEEK + SCALE_STEP * CARD_HEIGHT;
const MAX_DEPTH = 2;
/** The front card slides down and back this long before the order rotates. */
const SLIDE_MS = 220;
const LOCK_MS = 700;
/** The page follows the front card after the cards have settled. */
const FOLLOW_MS = 650;

/**
 * 2-3 BalanceCards (approved reference #5, static look from Main.dc.html). The front card slides
 * down and back, then the next card comes forward. Cards are bottom-anchored; deeper cards sit
 * higher and smaller and wear a neutral face (stack grey, then card-2), so only a 10px sliver of
 * each shows. Transform + opacity only.
 *
 * The order is derived from `cards` plus a rotation offset, so the `cards` prop stays the source of truth.
 * With a single card nothing is interactive.
 */
export const CardStack = memo(function CardStack({
  cards,
  frontId,
  onFrontChange,
}: {
  cards: ReadonlyArray<BalanceCardData>;
  /** Which card starts in front (e.g. the one the page below it is showing). */
  frontId?: string;
  /** Called with the id of the card that came to the front. */
  onFrontChange?: (id: string) => void;
}) {
  const n = cards.length;
  const [offset, setOffset] = useState(() => Math.max(0, cards.findIndex((c) => c.id === frontId)));
  const [sliding, setSliding] = useState(false);
  const lock = useTapLock(LOCK_MS);
  const { reduced } = useReducedMotionSafe();
  const hintId = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const frontIndex = n > 0 ? offset % n : 0;
  const frontCardId = cards[frontIndex]?.id;
  const onFrontChangeRef = useRef(onFrontChange);
  useEffect(() => {
    onFrontChangeRef.current = onFrontChange;
  });
  // The page below follows the front card only once the card animation has finished (0.6 s + a beat): switching the
  // household re-renders the whole screen, and that must not land in the middle of the slide.
  const announced = useRef(false);
  useEffect(() => {
    if (!frontCardId) return;
    const t = setTimeout(() => onFrontChangeRef.current?.(frontCardId), announced.current && !reduced ? FOLLOW_MS : 0);
    announced.current = true;
    return () => clearTimeout(t);
  }, [frontCardId, reduced]);
  const interactive = n >= 2;

  // The page can switch the household from outside (the flat pill): bring that card to the front.
  const cardsRef = useRef(cards);
  const frontIndexRef = useRef(frontIndex);
  useEffect(() => {
    cardsRef.current = cards;
    frontIndexRef.current = frontIndex;
  });
  useEffect(() => {
    if (!frontId) return;
    const target = cardsRef.current.findIndex((c) => c.id === frontId);
    if (target >= 0 && target !== frontIndexRef.current) setOffset(target);
  }, [frontId]);

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
  // Always two peeking layers, like the mockup: with fewer than three cards the missing ones are decorative faces.
  const rows = n > 0 ? MAX_DEPTH : 0;
  // How far the deepest layer pokes above the front card (its top also drops as it scales down).
  const peek = rows * PEEK;
  const decorative = Array.from({ length: Math.max(rows + 1 - n, 0) }, (_, i) => n + i);

  return (
    <div
      data-testid="card-stack"
      data-front={cards[frontIndex]?.name}
      className="relative"
      style={{ height: CARD_HEIGHT + peek }}
    >
      {decorative.map((d) => (
        <div
          key={`peek-${d}`}
          data-testid="stack-peek"
          aria-hidden="true"
          className={d === 1 ? "absolute inset-x-0 bottom-0 origin-bottom rounded-lg bg-night-2" : "absolute inset-x-0 bottom-0 origin-bottom rounded-lg bg-night-1"}
          style={{ height: CARD_HEIGHT, zIndex: MAX_DEPTH + 1 - d, transform: `translateY(${-d * STEP}px) scale(${1 - d * SCALE_STEP})` }}
        />
      ))}
      {cards.map((card, i) => {
        const depth = depthOf(i);
        const d = Math.min(depth, MAX_DEPTH);
        const isFront = depth === 0;
        const slidingFront = isFront && sliding;
        // inline transform + CSS transition (compositor): the slide is 0.22 s, the settle into the order 0.6 s, both smooth
        const y = slidingFront ? 36 : -d * STEP;
        const scale = slidingFront ? 0.94 : 1 - d * SCALE_STEP;
        const layerStyle: CSSProperties = {
          zIndex: MAX_DEPTH + 1 + n - depth,
          transform: reduced ? undefined : `translateY(${y}px) scale(${scale})`,
          opacity: reduced ? (isFront ? 1 : 0) : depth > MAX_DEPTH ? 0 : 1,
          transition: `transform ${slidingFront ? SLIDE_MS / 1000 : 0.6}s ${css.smooth}, opacity ${slidingFront ? SLIDE_MS / 1000 : 0.6}s ${css.smooth}`,
        };
        const balanceId = `${hintId}-balance-${card.id}`;
        return (
          <div key={card.id} className="absolute inset-x-0 bottom-0 origin-bottom will-change-transform" style={layerStyle}>
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
            {/* neutral faces for the layers behind (opacity only, never a filter) */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -inset-px rounded-lg bg-night-2 transition-opacity duration-[600ms] ease-smooth"
              style={{ opacity: reduced ? 0 : d >= 1 ? 1 : 0 }}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -inset-px rounded-lg bg-night-1 transition-opacity duration-[600ms] ease-smooth"
              style={{ opacity: reduced ? 0 : d >= 2 ? 1 : 0 }}
            />
          </div>
        );
      })}
    </div>
  );
});
