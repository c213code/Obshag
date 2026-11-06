/**
 * Motion foundation.
 *
 * RULES
 * 1. Animate ONLY `transform` and `opacity` (x, y, scale, opacity). Never width,
 *    height, top/left, box-shadow or filter while moving.
 * 2. `smooth` is the default curve. `softSpring` is reserved for success states
 *    and pop-ins.
 * 3. Interactive components must ignore taps while their animation is running
 *    (see `useTapLock`).
 * 4. Under prefers-reduced-motion, movement becomes a short opacity fade
 *    (see `useReducedMotionSafe`).
 */
import { useCallback, useRef } from "react";
import { useReducedMotion, type Transition } from "motion/react";

export const ease = {
  smooth: [0.22, 1, 0.36, 1],
  softSpring: [0.34, 1.18, 0.64, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;

/** Spring presets approximating the curves, for motion/react. */
export const spring = {
  /** Tabs, pills, layout slides: quick and fully damped. */
  snap: { type: "spring", stiffness: 520, damping: 40, mass: 0.8 },
  /** Success states and pop-ins: a touch of overshoot. */
  soft: { type: "spring", stiffness: 300, damping: 20, mass: 0.9 },
} as const satisfies Record<string, Transition>;

export const durations = { fast: 0.2, base: 0.38, slow: 0.5 } as const;

export const smoothTransition: Transition = { duration: durations.base, ease: ease.smooth };

const reducedTransition: Transition = { duration: 0.15, ease: "linear" };

/**
 * Returns `reduced` plus a `t()` that swaps any transition for a short fade
 * when the user prefers reduced motion. Components also drop x/y/scale targets
 * when `reduced` is true so only opacity changes.
 */
export function useReducedMotionSafe() {
  const reduced = useReducedMotion() ?? false;
  const t = useCallback(
    (transition: Transition = smoothTransition): Transition => (reduced ? reducedTransition : transition),
    [reduced],
  );
  return { reduced, t };
}

/** Ignore taps for `ms` after an accepted tap (animation in flight). */
export function useTapLock(ms: number) {
  const until = useRef(0);
  return useCallback(
    (fn: () => void) => {
      const now = performance.now();
      if (now < until.current) return false;
      until.current = now + ms;
      fn();
      return true;
    },
    [ms],
  );
}
