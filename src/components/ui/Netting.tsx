"use client";

import { useEffect, useRef, useState } from "react";
import { cssTransition, useReducedMotionSafe } from "@/lib/motion";
import { ru } from "@/lib/i18n/ru";
import { Avatar } from "./Avatar";
import { Money } from "./Money";
import { Pill } from "./Pill";
import { cx } from "./cx";

const OWED = 2000;
const OWE = 1800;
const NET = OWED - OWE;

/** 0 idle, 1 lime arrow slides up, 2 arrows merged + counting down, 3 finished (lime pop, caption). */
type Stage = 0 | 1 | 2 | 3;

function Scene({ play, onDone }: { play: boolean; onDone: () => void }) {
  const { reduced } = useReducedMotionSafe();
  const [stage, setStage] = useState<Stage>(0);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });

  useEffect(() => {
    if (!play) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    // frame delay so the start state paints first
    at(30, () => setStage(1));
    at(30 + 420, () => setStage(2));
    at(30 + 420 + 800, () => {
      setStage(3);
      done.current();
    });
    return () => timers.forEach(clearTimeout);
  }, [play]);

  const merged = stage >= 2;
  const finished = stage === 3;

  return (
    <>
      <div
        role="img"
        aria-label={ru.kit.netting.scene}
        className="grid grid-cols-[40px_1fr_40px] items-center gap-[10px]"
      >
        <Avatar name="Ерасыл" color="me" size={40} decorative />
        <div className="relative h-16">
          {/* Е -> А: 2 000 (orange) */}
          <div
            className="absolute inset-x-0 top-[18px] flex flex-col items-center"
            style={{ transform: `translateY(${merged && !reduced ? 4 : 0}px)`, transition: cssTransition({ transform: 0.5 }) }}
          >
            <Money
              value={merged ? NET : OWED}
              duration={0.8}
              className="absolute -top-[18px] text-[14px] font-bold text-orange"
            />
            <div className="relative h-[3px] w-full rounded-[2px] bg-orange">
              <span className="absolute -top-[4px] -right-[2px] border-y-[5.5px] border-l-8 border-y-transparent border-l-orange" />
            </div>
          </div>
          {/* А -> Е: 1 800 (lime) slides up onto the orange arrow and dissolves */}
          <div
            className="absolute inset-x-0 top-[42px] flex flex-col items-center"
            style={{
              transform: `translateY(${stage >= 1 && !reduced ? -24 : 0}px)`,
              opacity: merged ? 0 : 1,
              transition: cssTransition({ transform: 0.5, opacity: 0.4 }),
            }}
          >
            <div className="relative h-[3px] w-full rounded-[2px] bg-lime">
              <span className="absolute -top-[4px] -left-[2px] border-y-[5.5px] border-r-8 border-y-transparent border-r-lime" />
            </div>
            <Money value={OWE} className="mt-1 text-[14px] font-bold text-lime" />
          </div>
        </div>
        <Avatar name="Айдос" color="blue" size={40} decorative />
      </div>
      <div className="flex items-center justify-center gap-[10px] rounded-pill border border-card-2 bg-card p-3">
        <span className="text-[13px] text-muted">{ru.kit.netting.transferTo}</span>
        <span
          className={cx(
            "inline-block text-[26px] font-bold transition-colors duration-[400ms] ease-smooth",
            finished ? "text-lime" : "text-text",
            finished && "pop",
          )}
        >
          <Money value={merged ? NET : OWED} duration={0.8} data-testid="netting-total" />
        </span>
      </div>
    </>
  );
}

/** Netting demo (approved reference #3): two opposing debts collapse into one transfer. */
export function Netting() {
  const [run, setRun] = useState(0);
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-card p-4">
      {/* a fresh Scene per run restarts from the 2 000 / 1 800 state with no reverse animation */}
      <Scene
        key={run}
        play={run > 0}
        onDone={() => {
          setBusy(false);
          setFinished(true);
        }}
      />
      <div className="flex min-h-8 items-center justify-between gap-3">
        <Pill
          variant="on"
          size="sm"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setFinished(false);
            setRun((r) => r + 1);
          }}
        >
          {ru.kit.netting.run}
        </Pill>
        <span aria-live="polite" className="sr-only">
          {finished ? ru.kit.netting.caption : ""}
        </span>
        <span
          aria-hidden="true"
          className="text-[12px] text-muted transition-opacity duration-[400ms] ease-smooth"
          style={{ opacity: finished ? 1 : 0 }}
        >
          {ru.kit.netting.caption}
        </span>
      </div>
    </div>
  );
}
