"use client";

import { AnimatePresence, m } from "motion/react";
import { CheckIcon } from "@/components/ui/icons";
import { Pill, type PillSize, type PillVariant } from "@/components/ui/Pill";
import { ease } from "@/lib/motion";
import { ru } from "@/lib/i18n/ru";
import { cooldownParts } from "@/lib/remindClient";
import { useRemind } from "./useRemind";

/**
 * «Напомнить» → «Отправляем…» → «Напомнили» ✓ → «Можно через 5 ч». The cooldown is the server's (6 h per pair); the button
 * learns it from the 429 as well, so it is right after a reload too.
 */
export function RemindButton({
  householdId,
  debtorId,
  name,
  size = "row",
  variant = "on",
  className,
  testId,
}: {
  householdId: string;
  debtorId: string;
  name: string;
  size?: PillSize;
  variant?: PillVariant;
  className?: string;
  testId?: string;
}) {
  const { entry, press } = useRemind(householdId, debtorId);
  const cool = entry.kind === "cooldown" ? cooldownParts(entry.seconds) : null;
  const text =
    entry.kind === "sending"
      ? ru.remind.sending
      : entry.kind === "sent"
        ? ru.remind.sent
        : cool
          ? cool.unit === "h"
            ? ru.remind.cooldownHours(cool.n)
            : ru.remind.cooldownMinutes(cool.n)
          : ru.remind.action;
  const idle = entry.kind === "idle";
  return (
    <Pill
      variant={entry.kind === "sent" ? "lime" : variant}
      size={size}
      className={className}
      data-testid={testId}
      data-state={entry.kind}
      aria-label={idle ? ru.remind.label(name) : undefined}
      aria-disabled={!idle}
      onClick={() => void press()}
    >
      <AnimatePresence initial={false} mode="popLayout">
        <m.span
          key={entry.kind}
          className={entry.kind === "cooldown" ? "inline-flex items-center gap-[6px] text-muted" : "inline-flex items-center gap-[6px]"}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: ease.smooth }}
          role={idle ? undefined : "status"}
        >
          {entry.kind === "sent" ? <CheckIcon size={14} strokeWidth={3} /> : null}
          {text}
        </m.span>
      </AnimatePresence>
    </Pill>
  );
}
