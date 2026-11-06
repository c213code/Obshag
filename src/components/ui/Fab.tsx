"use client";

import type { Ref } from "react";
import { motion, type HTMLMotionProps } from "motion/react";
import { ease, useReducedMotionSafe } from "@/lib/motion";
import { cx } from "./cx";

type FabProps = Omit<HTMLMotionProps<"button">, "children" | "aria-label" | "ref"> & {
  "aria-label": string;
  children: React.ReactNode;
  /** Shrinks and fades out (scale .6, opacity 0) while the Fab menu is open. Never rotates. */
  hidden?: boolean;
  ref?: Ref<HTMLButtonElement>;
};

/** 58px lime circle. Never rotates: it only scales (press .94, hidden .6) and fades. */
export function Fab({ className, children, hidden = false, ref, ...rest }: FabProps) {
  const { reduced } = useReducedMotionSafe();
  const shown = hidden ? 0 : rest.disabled ? 0.4 : 1;
  return (
    <motion.button
      ref={ref}
      type="button"
      whileTap={hidden || reduced || rest.disabled ? undefined : { scale: 0.94 }}
      animate={reduced ? { opacity: shown } : { scale: hidden ? 0.6 : 1, opacity: shown }}
      transition={
        reduced
          ? { duration: 0.2, ease: "linear" }
          : { scale: { duration: 0.5, ease: ease.smooth }, opacity: { duration: 0.4, ease: ease.smooth } }
      }
      className={cx(
        "inline-flex size-[58px] shrink-0 items-center justify-center rounded-full bg-lime text-on-lime motion-reduce:transform-none!",
        className,
      )}
      {...rest}
    >
      {children}
    </motion.button>
  );
}
