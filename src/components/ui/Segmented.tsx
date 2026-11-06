"use client";

import { useId } from "react";
import { LayoutGroup, motion } from "motion/react";
import { spring, useReducedMotionSafe } from "@/lib/motion";
import { Bar } from "./Bar";
import { cx } from "./cx";
import { pillClass } from "./Pill";

export type SegmentedOption<T extends string> = { value: T; label: string };

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  activeVariant = "on",
  label,
}: {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  activeVariant?: "on" | "lime";
  /** Accessible group name, e.g. "Способ деления". */
  label: string;
}) {
  const group = useId();
  const { reduced, t } = useReducedMotionSafe();
  return (
    <LayoutGroup id={group}>
      <Bar role="group" aria-label={label} className="w-full">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(o.value)}
              className={cx(
                pillClass("ghost", "md", "relative flex-1 transition-colors"),
                active && (activeVariant === "lime" ? "!text-on-lime" : "!text-text"),
              )}
            >
              {active ? (
                <motion.span
                  layoutId="segmented-active"
                  aria-hidden="true"
                  className={cx("absolute inset-0 rounded-pill", activeVariant === "lime" ? "bg-lime" : "bg-card-2")}
                  transition={reduced ? t() : spring.snap}
                />
              ) : null}
              <span className="relative">{o.label}</span>
            </button>
          );
        })}
      </Bar>
    </LayoutGroup>
  );
}
