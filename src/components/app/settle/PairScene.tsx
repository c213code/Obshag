"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Avatar, type AvatarColor } from "@/components/ui/Avatar";
import { cx } from "@/components/ui/cx";
import { Money } from "@/components/ui/Money";
import { ease, spring, useReducedMotionSafe } from "@/lib/motion";
import { formatNumber, formatTenge } from "@/lib/format/money";
import type { NetDirection } from "@/lib/domain/netting";
import { ru } from "@/lib/i18n/ru";

/** Distance between the two arrow rows (Pay.dc.html: label 20 + gap 2 + arrow 12 + gap 8 -> arrow centers 20px apart). */
const ARROW_GAP = 20;

/** 0 idle, 1 the smaller arrow slides onto the bigger one, 2 merged + counting down, 3 finished (pop, caption). */
type Stage = 0 | 1 | 2 | 3;

type Props = {
  meName: string;
  otherName: string;
  meColor: AvatarColor;
  otherColor: AvatarColor;
  iOwe: number;
  theyOwe: number;
  net: number;
  direction: Exclude<NetDirection, "even">;
  /** «Ждём подтверждения от …»: replaces the caption line under the equation (no extra height). */
  waitingLabel?: string;
};

/** Arrow stroke + head from Pay.dc.html (viewBox 160x12, stretched to the column like the mockup). */
function ArrowRight() {
  return (
    <svg width="100%" height="12" viewBox="0 0 160 12" preserveAspectRatio="none" aria-hidden="true" className="text-orange">
      <path d="M2 6h150" stroke="currentColor" strokeWidth="2.5" fill="none" />
      <path d="M148 1l8 5-8 5" fill="currentColor" />
    </svg>
  );
}
function ArrowLeft() {
  return (
    <svg width="100%" height="12" viewBox="0 0 160 12" preserveAspectRatio="none" aria-hidden="true" className="text-lime">
      <path d="M8 6h150" stroke="currentColor" strokeWidth="2.5" fill="none" />
      <path d="M12 1 4 6l8 5" fill="currentColor" />
    </svg>
  );
}

/**
 * The top card of Pay.dc.html with motion reference #3. Opening the screen plays it once: the smaller arrow slides
 * onto the bigger one and dissolves, the remaining label counts down to the net, and the result pops with the
 * caption. Reduced motion renders the final state with a fade only. Transform and opacity only.
 */
export function PairScene({ meName, otherName, meColor, otherColor, iOwe, theyOwe, net, direction, waitingLabel }: Props) {
  const { reduced } = useReducedMotionSafe();
  const bothSides = iOwe > 0 && theyOwe > 0;
  const animate = bothSides && !reduced;
  const [played, setPlayed] = useState<Stage>(animate ? 0 : 3);
  const [flash, setFlash] = useState(false);
  const started = useRef(false);
  /** Without animation (reduced motion, one-sided pair) the final state is shown straight away. */
  const stage: Stage = animate ? played : 3;

  useEffect(() => {
    if (!animate || started.current) return;
    started.current = true;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    // same timings as motion-reference #3: slide, merge after 420ms, count for 800ms, then the pop
    // a restart (reduced motion switched off, a new pair) begins from the idle state again, not from the old final stage
    at(0, () => {
      setPlayed(0);
      setFlash(false);
    });
    at(30, () => setPlayed(1));
    at(30 + 420, () => setPlayed(2));
    at(30 + 420 + 800, () => {
      setPlayed(3);
      setFlash(true); // the result turns lime with the pop, then settles back to the Pay.dc.html white
    });
    at(30 + 420 + 800 + 900, () => setFlash(false));
    return () => {
      timers.forEach(clearTimeout);
      started.current = false; // StrictMode re-runs the effect: start again from scratch
    };
  }, [animate]);

  const merged = stage >= 2;
  const finished = stage === 3;
  /** The bigger side keeps its arrow; the smaller one is dissolved into it. */
  const orangeWins = direction === "i_pay";
  const smooth = { duration: 0.5, ease: ease.smooth };
  const fade = { duration: 0.4, ease: ease.smooth };
  /** An arrow that lost the merge: fully hidden in the final state, also when nothing was animated (reduced motion). */
  const orangeGone = !orangeWins && bothSides && merged;
  const limeGone = orangeWins && bothSides && merged;
  const orangeY = !bothSides ? 0 : orangeWins ? (merged && !reduced ? 4 : 0) : stage >= 1 && !reduced ? ARROW_GAP : 0;
  const limeY = !bothSides ? 0 : !orangeWins ? (merged && !reduced ? -4 : 0) : stage >= 1 && !reduced ? -ARROW_GAP : 0;
  const dim = (owed: number) => (owed === 0 ? 0.35 : 1);

  const eqLarge = orangeWins ? iOwe : theyOwe;
  const eqSmall = orangeWins ? theyOwe : iOwe;
  const eqLargeTone = orangeWins ? "text-orange" : "text-lime";
  const eqSmallTone = orangeWins ? "text-lime" : "text-orange";

  return (
    <motion.section
      data-testid="pair-scene"
      data-stage={stage}
      aria-label={ru.settle.scene(meName, otherName, formatTenge(iOwe), formatTenge(theyOwe))}
      className="flex flex-col gap-4 rounded-lg border border-hairline bg-card px-4 py-5"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={fade}
    >
      <div className="grid grid-cols-[60px_1fr_60px] items-center">
        <div className="flex flex-col items-center gap-1">
          <Avatar name={meName} color={meColor} size={52} decorative />
          <span className="text-label">{ru.settle.you}</span>
        </div>
        <div className="flex flex-col gap-2 px-[6px]">
          <motion.div
            data-testid="arrow-owe"
            className="flex flex-col items-center gap-[2px]"
            initial={false}
            animate={{ y: orangeY, opacity: orangeGone ? 0 : dim(iOwe) }}
            transition={{ y: smooth, opacity: fade }}
          >
            <Money
              value={orangeWins && merged ? net : iOwe}
              duration={0.8}
              data-testid="arrow-owe-amount"
              className="text-amount !text-[17px] text-orange"
            />
            <ArrowRight />
          </motion.div>
          <motion.div
            data-testid="arrow-owed"
            className="flex flex-col items-center gap-[2px]"
            initial={false}
            animate={{ y: limeY, opacity: limeGone ? 0 : dim(theyOwe) }}
            transition={{ y: smooth, opacity: fade }}
          >
            <ArrowLeft />
            <Money
              value={!orangeWins && merged ? net : theyOwe}
              duration={0.8}
              data-testid="arrow-owed-amount"
              className="text-amount !text-[17px] text-lime"
            />
          </motion.div>
        </div>
        <div className="flex flex-col items-center gap-1">
          <Avatar name={otherName} color={otherColor} size={52} decorative />
          <span className="max-w-[60px] truncate text-label">{otherName}</span>
        </div>
      </div>

      <div
        data-testid="equation"
        className="flex items-baseline justify-center gap-2 rounded-pill border border-hairline bg-bg px-5 py-[14px]"
      >
        <span className={cx("text-amount", eqLargeTone)}>{formatNumber(eqLarge)}</span>
        <span className="text-amount text-muted">−</span>
        <span className={cx("text-amount", eqSmallTone)}>{formatNumber(eqSmall)}</span>
        <span className="text-amount text-muted">=</span>
        <motion.span
          data-testid="equation-result"
          className={cx(
            "inline-block text-[34px] font-bold leading-[1.05] tracking-[-0.02em] font-rounded tabular-nums transition-colors duration-[600ms] ease-smooth",
            flash ? "text-lime" : "text-text",
          )}
          initial={false}
          animate={{ scale: finished && animate ? [1.08, 1] : 1 }}
          transition={finished && animate ? spring.soft : { duration: 0 }}
        >
          {formatTenge(net)}
        </motion.span>
      </div>
      <div className="relative min-h-[17px]">
        <AnimatePresence initial={false} mode="popLayout">
          {waitingLabel ? (
            <motion.p
              key="waiting"
              data-testid="waiting"
              role="status"
              className="flex items-center justify-center gap-2 text-[13px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={fade}
            >
              <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-orange" />
              {waitingLabel}
            </motion.p>
          ) : bothSides ? (
            <motion.p
              key="caption"
              data-testid="scene-caption"
              className="text-center text-caption"
              initial={false}
              animate={{ opacity: finished ? 1 : 0 }}
              exit={{ opacity: 0 }}
              transition={fade}
            >
              {ru.settle.oneTransfer}
            </motion.p>
          ) : null}
        </AnimatePresence>
      </div>
    </motion.section>
  );
}
