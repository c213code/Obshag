"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useHasDynamicIsland } from "@/lib/device";
import { useReducedMotionSafe } from "@/lib/motion";
import { cx } from "./cx";
import { CheckIcon } from "./icons";

type Phase = "closed" | "pill" | "open" | "fading" | "collapsed";

/** The island pill: 120 x 34 (150 wide with the «✓ Поделено» label). */
const PILL_W = 120;
const PILL_DONE_W = 150;
const PILL_H = 34;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * "Island" sheet (approved reference #2). It grows from a small black pill into a wide card;
 * its content fades in late. On close the content fades out and the card collapses back to a
 * pill, showing a lime check and `doneLabel` when `outcome` is "done".
 *
 * The growth runs on the compositor (CSS transitions, see `.sheet` in globals.css), NOT as a width/height transition:
 * the card is laid out at its final size, its black face scales from the pill size (measured once, kept in --sx/--sy
 * and --ex/--ey) with origin top center, and a real pill element (undistorted corners) crossfades with it. The content is
 * hidden while the size changes, so the scale is never visible on it.
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
  /** Corner radius of the open card. */
  radius?: number;
  /** Size and padding of the open card. */
  expandedClassName?: string;
  /** Focus the first control when the sheet opens. Off: the dialog itself gets focus (no focus ring on a chip before the user does anything). */
  focusFirst?: boolean;
}) {
  const { reduced } = useReducedMotionSafe();
  const island = useHasDynamicIsland();
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

  // Pill-size scale of the face, from the measured card (once per phase change, written as CSS variables: no state, no re-render).
  useLayoutEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (!w || !h) return;
    const pillW = showDone ? PILL_DONE_W : PILL_W;
    if (phase === "pill") {
      el.style.setProperty("--sx", String(PILL_W / w));
      el.style.setProperty("--sy", String(PILL_H / h));
    } else if (phase === "fading") {
      el.style.setProperty("--ex", String(pillW / w));
      el.style.setProperty("--ey", String(PILL_H / h));
      el.style.setProperty("--h", `${h}px`);
    }
  }, [phase, showDone]);

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

  const hasContent = phase === "pill" || phase === "open" || phase === "fading" || (reduced && phase === "collapsed");

  return (
    <div className="fixed inset-0 z-50 flex touch-none items-start justify-center overscroll-contain px-[11px] pt-[max(env(safe-area-inset-top),11px)]">
      <div
        aria-hidden="true"
        data-testid="sheet-backdrop"
        className={cx("absolute inset-0 bg-bg/15", open ? "enter [--enter-d:0.3s]" : "leave [--leave-d:0.3s]")}
        onClick={() => {
          if (phase === "open" || phase === "pill") onCloseRef.current();
        }}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        data-phase={phase}
        data-island={island}
        data-done={showDone}
        data-reduced={reduced}
        style={{ borderRadius: radius }}
        className={cx("sheet relative mx-auto w-full overflow-hidden outline-none", expandedClassName)}
      >
        <div aria-hidden="true" className="sheet-face absolute inset-0 bg-island" style={{ borderRadius: radius }} />
        {/* the real pill: shown while the card is pill-sized (without a Dynamic Island an empty black pill reads as a stray icon, so it stays invisible there) */}
        <div
          aria-hidden={phase === "collapsed" && showDone ? undefined : true}
          className="sheet-pill absolute inset-x-0 top-0 mx-auto h-[34px] overflow-hidden rounded-pill bg-island"
          style={{ width: showDone ? PILL_DONE_W : PILL_W }}
        >
          {phase === "collapsed" && showDone ? (
            <div className="enter flex h-full items-center justify-center gap-2 [--enter-d:0.25s] [--enter-delay:0.28s]">
              <span className="inline-flex size-5 items-center justify-center rounded-full bg-lime text-on-lime">
                <CheckIcon size={14} />
              </span>
              <span className="text-[12px]">{doneLabel}</span>
            </div>
          ) : null}
        </div>
        {hasContent ? <div className="sheet-content relative">{children}</div> : null}
      </div>
    </div>
  );
}
