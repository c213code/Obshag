"use client";

import { useEffect, useRef } from "react";
import { animate } from "motion/react";
import { cx } from "@/components/ui/cx";
import { ease, useReducedMotionSafe } from "@/lib/motion";

const LENGTH = 6;

/**
 * Six big rounded digits driven by ONE real input (so SMS/email autofill, paste and the numeric keypad work).
 * The input sits invisibly over the boxes. `shake` nudges the row sideways (transform only) after a wrong code.
 */
export function CodeInput({
  value,
  onChange,
  label,
  disabled,
  invalid,
  shake,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  disabled?: boolean;
  invalid?: boolean;
  shake?: number;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const { reduced } = useReducedMotionSafe();
  const active = Math.min(value.length, LENGTH - 1);

  // wrong code: nudge the row sideways (transform only)
  useEffect(() => {
    if (!shake || reduced || !row.current) return;
    const controls = animate(row.current, { x: [0, -10, 10, -6, 6, 0] }, { duration: 0.45, ease: ease.smooth });
    return () => controls.stop();
  }, [shake, reduced]);

  useEffect(() => {
    if (!disabled) ref.current?.focus({ preventScroll: true });
  }, [disabled, shake]);

  return (
    <div ref={row} className="relative">
      <div aria-hidden="true" className="grid grid-cols-6 gap-2">
        {Array.from({ length: LENGTH }, (_, i) => (
          <div
            key={i}
            className={cx(
              "flex h-[68px] items-center justify-center rounded-md border bg-card font-rounded text-[32px] font-bold transition-colors duration-200 ease-smooth",
              invalid ? "border-orange" : i === active && !disabled ? "border-lime" : "border-card-2",
              disabled && "opacity-60",
            )}
          >
            {value[i] ?? ""}
          </div>
        ))}
      </div>
      <input
        ref={ref}
        aria-label={label}
        aria-invalid={invalid || undefined}
        value={value}
        disabled={disabled}
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="one-time-code"
        maxLength={LENGTH}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, LENGTH))}
        className="absolute inset-0 size-full bg-transparent text-transparent caret-transparent outline-none"
      />
    </div>
  );
}
