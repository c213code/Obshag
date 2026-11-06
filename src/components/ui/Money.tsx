"use client";

import { useEffect, useRef, useState, type HTMLAttributes } from "react";
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

/** Integer tenge that rolls to its new value (easeOut). The final value is always exact. */
export function Money({ value, sign, duration = 0.7, className, ...rest }: MoneyProps) {
  const { reduced } = useReducedMotionSafe();
  const [shown, setShown] = useState(value);
  const current = useRef(value);

  useEffect(() => {
    if (reduced || current.current === value) {
      current.current = value;
      setShown(value);
      return;
    }
    const controls = animate(current.current, value, {
      duration,
      ease: ease.smooth,
      onUpdate: (v) => {
        current.current = v;
        setShown(Math.round(v));
      },
      onComplete: () => {
        current.current = value;
        setShown(value);
      },
    });
    return () => controls.stop();
  }, [value, duration, reduced]);

  return (
    <span className={cx("money tabular-nums", className)} {...rest}>
      {formatTenge(shown, { sign })}
    </span>
  );
}
