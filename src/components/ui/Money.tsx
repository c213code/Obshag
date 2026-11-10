"use client";

import { useLayoutEffect, useRef, type HTMLAttributes } from "react";
import { animate } from "motion/react";
import { ease, useReducedMotionSafe } from "@/lib/motion";
import { formatTenge } from "@/lib/format/money";
import { cx } from "./cx";

type MoneyProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  value: number;
  sign?: boolean;
  /** Roll duration in seconds. */
  duration?: number;
};

/**
 * Integer tenge that rolls to its new value (easeOut). The final value is always exact.
 * The roll writes the text straight into the DOM node: no React state per frame, so a roll never re-renders anything.
 * JSX always renders the final value; an unchanged value (a silent refresh) does nothing at all.
 */
export function Money({ value, sign, duration = 0.7, className, ...rest }: MoneyProps) {
  const { reduced } = useReducedMotionSafe();
  const ref = useRef<HTMLSpanElement>(null);
  const current = useRef(value);

  // layout effect: the old number goes back on screen before the browser paints the new one, so the roll starts without a flash
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || reduced || current.current === value) {
      current.current = value;
      return;
    }
    const write = (n: number) => {
      el.textContent = formatTenge(n, { sign });
    };
    write(Math.round(current.current));
    const controls = animate(current.current, value, {
      duration,
      ease: ease.smooth,
      onUpdate: (v) => {
        current.current = v;
        write(Math.round(v));
      },
      onComplete: () => {
        current.current = value;
        write(value);
      },
    });
    return () => controls.stop();
  }, [value, sign, duration, reduced]);

  return (
    <span ref={ref} className={cx("money tabular-nums", className)} {...rest}>
      {formatTenge(value, { sign })}
    </span>
  );
}
