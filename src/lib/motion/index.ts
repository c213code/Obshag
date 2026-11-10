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
import { useCallback, useRef, useSyncExternalStore } from "react";
import type { Transition } from "motion/react";

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

/**
 * The same curves as CSS `cubic-bezier()` strings, for the compositor (CSS transitions / keyframes / WAAPI).
 * Frequent motion runs there, not in motion/react (a rAF loop that WebKit throttles to ~30 fps in Low Power Mode).
 *
 * Spring -> bezier mapping (what the CSS uses in place of the JS springs):
 * - `spring.snap` (k520 c40 m.8, critically damped, settles in ~0.27 s) -> `snap` below, 270 ms. Fitted by least squares
 *   against the spring's step response (max error < 1.5% of the travel).
 * - `ease.softSpring` -> `softSpring`, the very curve of docs/design/motion-reference.html (`--s`).
 * - `spring.soft` pop on a result ([1.08, 1]) -> a `pop` keyframe, 450 ms `softSpring`.
 * Tailwind exposes `ease-smooth` / `ease-soft-spring` (tokens.css); globals.css holds the keyframes (enter / leave / pop).
 */
export const css = {
  smooth: "cubic-bezier(0.22, 1, 0.36, 1)",
  softSpring: "cubic-bezier(0.34, 1.18, 0.64, 1)",
  snap: "cubic-bezier(0.25, 0.25, 0.2, 1)",
} as const;

/** CSS `transition` value on the smooth curve: `smoothTransition({ transform: 0.5, opacity: 0.4 })` (durations in s). */
export function cssTransition(props: Record<string, number>, curve: string = css.smooth): string {
  return Object.entries(props)
    .map(([prop, seconds]) => `${prop} ${seconds}s ${curve}`)
    .join(", ");
}

/** Duration of the `snap` pill slide, in ms. */
export const SNAP_MS = 270;

export const durations = { fast: 0.2, base: 0.38, slow: 0.5 } as const;

export const smoothTransition: Transition = { duration: durations.base, ease: ease.smooth };

const reducedTransition: Transition = { duration: 0.15, ease: "linear" };

/**
 * Returns `reduced` plus a `t()` that swaps any transition for a short fade
 * when the user prefers reduced motion. Components also drop x/y/scale targets
 * when `reduced` is true so only opacity changes.
 */
const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReduced(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** `prefers-reduced-motion: reduce`, live (false on the server). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(REDUCED_QUERY).matches,
    () => false,
  );
}

export function useReducedMotionSafe() {
  const reduced = useReducedMotion();
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
