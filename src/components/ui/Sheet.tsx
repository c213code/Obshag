"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { ease, useReducedMotionSafe } from "@/lib/motion";
import { cx } from "./cx";
import { CheckIcon } from "./icons";

type Phase = "closed" | "pill" | "open" | "fading" | "collapsed";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * "Island" sheet (approved reference #2). It grows from a small black pill into a wide card;
 * its content fades in late. On close the content fades out and the card collapses back to a
 * pill, showing a lime check and `doneLabel` when `outcome` is "done".
 *
 * The growth is a motion layout animation (it runs on transforms, with the border radius
 * corrected by motion so it never distorts), NOT a width/height transition. The content is
 * hidden while the size changes, so the layout scale is never visible on it.
 *
 * Also: focus trap, focus restore, Esc and backdrop close.
 * Under reduced motion the card simply fades.
 */
export function Sheet({
  open,
  onClose,
  label,
  children,
  outcome = "dismissed",
  doneLabel,
  onClosed,
  radius = 32,
  expandedClassName = "max-w-[358px] px-[14px] py-4",
  focusFirst = true,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
  outcome?: "done" | "dismissed";
  doneLabel?: string;
  /** Called once the collapse has finished and the sheet is gone (e.g. to leave a route). */
  onClosed?: () => void;
  /** Corner radius of the open card (a fixed value, so motion keeps it undistorted during the layout animation). */
  radius?: number;
  /** Size and padding of the open card. */
  expandedClassName?: string;
  /** Focus the first control when the sheet opens. Off: the dialog itself gets focus (no focus ring on a chip before the user does anything). */
  focusFirst?: boolean;
}) {
  const { reduced } = useReducedMotionSafe();
  const [phase, setPhase] = useState<Phase>("closed");
  const [prevOpen, setPrevOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const returnFocus = useRef<HTMLElement | null>(null);
  const outcomeRef = useRef(outcome);
  const onClosedRef = useRef(onClosed);
  const showDone = outcome === "done" && Boolean(doneLabel);

  useEffect(() => {
    onCloseRef.current = onClose;
    onClosedRef.current = onClosed;
    outcomeRef.current = showDone ? "done" : "dismissed";
  });

  // Phase follows `open` (derived during render, so there is no flash of stale state).
  if (open !== prevOpen) {
    setPrevOpen(open);
    setPhase(open ? (reduced ? "open" : "pill") : reduced ? "collapsed" : "fading");
  }

  // Timers drive the rest of the lifecycle: pill -> open, and on close
  // open -> fading -> collapsed -> closed (unmounted).
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    if (open) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (!reduced) later(40, () => setPhase("open"));
    } else if (reduced) {
      later(200, () => {
        setPhase("closed");
        onClosedRef.current?.();
      });
    } else {
      later(200, () => setPhase("collapsed"));
      later(200 + (outcomeRef.current === "done" ? 1200 : 450), () => {
        setPhase("closed");
        onClosedRef.current?.();
      });
    }
    return () => timers.forEach(clearTimeout);
  }, [open, reduced]);

  // Focus restore, tied to `open`. The page behind cannot scroll: the overlay is fixed over everything and takes the touches
  // (touch-action: none, overscroll contained), so no `body { overflow }` toggle (which forces a full relayout) is needed.
  useEffect(() => {
    if (!open) return;
    const target = returnFocus.current;
    return () => {
      target?.focus({ preventScroll: true });
    };
  }, [open]);

  // Move focus into the dialog once its content is visible.
  useEffect(() => {
    if (phase !== "open") return;
    const first = focusFirst ? dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE) : null;
    (first ?? dialogRef.current)?.focus({ preventScroll: true });
  }, [phase, focusFirst]);

  // Esc closes; Tab is trapped inside the dialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const list = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (list.length === 0) {
        e.preventDefault();
        return;
      }
      // Move focus ourselves so the cycle is the same in every browser
      // (Safari skips buttons when tabbing by default).
      e.preventDefault();
      const at = list.indexOf(document.activeElement as HTMLElement);
      const step = e.shiftKey ? -1 : 1;
      const next = at === -1 ? (e.shiftKey ? list.length - 1 : 0) : (at + step + list.length) % list.length;
      list[next].focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (phase === "closed") return null;

  const expanded = phase === "open" || phase === "fading";
  const visible = open || phase === "fading" || phase === "collapsed";

  return (
    <div className="fixed inset-0 z-50 flex touch-none items-start justify-center overscroll-contain px-[11px] pt-[max(env(safe-area-inset-top),11px)]">
      <motion.div
        aria-hidden="true"
        data-testid="sheet-backdrop"
        className="absolute inset-0 bg-bg/15"
        initial={{ opacity: 0 }}
        animate={{ opacity: open ? 1 : 0 }}
        transition={{ duration: 0.3, ease: ease.smooth }}
        onClick={() => {
          if (phase === "open") onCloseRef.current();
        }}
      />
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        layout={!reduced}
        transition={{ layout: { duration: 0.55, ease: ease.softSpring } }}
        style={{ borderRadius: radius }}
        className={cx(
          "relative mx-auto overflow-hidden bg-island outline-none",
          expanded ? cx("w-full", expandedClassName) : cx("h-[34px]", showDone ? "w-[150px]" : "w-[120px]"),
        )}
        initial={reduced ? { opacity: 0 } : false}
        animate={reduced ? { opacity: visible ? 1 : 0 } : undefined}
      >
        {expanded ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: phase === "open" ? 1 : 0 }}
            transition={
              phase === "open"
                ? { duration: 0.25, delay: reduced ? 0 : 0.22, ease: ease.smooth }
                : { duration: 0.2, ease: ease.smooth }
            }
          >
            {children}
          </motion.div>
        ) : null}
        {phase === "collapsed" && showDone ? (
          <motion.div
            className="flex h-full items-center justify-center gap-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25, delay: 0.28, ease: ease.smooth }}
          >
            <span className="inline-flex size-5 items-center justify-center rounded-full bg-lime text-on-lime">
              <CheckIcon size={14} />
            </span>
            <span className="text-[12px]">{doneLabel}</span>
          </motion.div>
        ) : null}
      </motion.div>
    </div>
  );
}
