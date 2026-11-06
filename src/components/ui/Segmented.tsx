"use client";

import { useId } from "react";
import { LayoutGroup, motion } from "motion/react";
import { spring, useReducedMotionSafe } from "@/lib/motion";
import { Bar } from "./Bar";
import { cx } from "./cx";
import { pillClass } from "./Pill";

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
  /** Small text after the label of a disabled option, e.g. «скоро». */
  soon?: string;
};

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
              disabled={o.disabled}
              onClick={() => onChange(o.value)}
              className={cx(
                pillClass("ghost", "bar", "relative min-w-0 flex-1 transition-colors"),
                o.disabled && "!opacity-45 cursor-not-allowed",
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
              {o.disabled && o.soon ? <span className="relative text-[11px] font-normal opacity-70">{o.soon}</span> : null}
            </button>
          );
        })}
      </Bar>
    </LayoutGroup>
  );
}
