"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "@/components/ui/cx";
import { CloseIcon } from "@/components/ui/icons";
import { ru } from "@/lib/i18n/ru";

const CLOSE_MS = 260;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Bottom sheet of DutySwap.dc.html: dimmed page, white sheet with a handle, rounded 32px top, a close button.
 * Slides on transform/opacity; mounted only while open (plus the close animation). Esc and the backdrop close it,
 * Tab stays inside, focus goes back to where it was.
 */
export function DutySheet({
  open,
  onClose,
  label,
  title,
  subtitle,
  children,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
  testId?: string;
}) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const [was, setWas] = useState(open);
  const ref = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  // mounting happens while rendering; the slide itself is started from the effect below one frame later
  if (open !== was) {
    setWas(open);
    if (open) setMounted(true);
  }

  useEffect(() => {
    if (open) {
      returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(raf);
    }
    const t0 = setTimeout(() => setShown(false), 0);
    const t = setTimeout(() => {
      setMounted(false);
      returnTo.current?.focus?.({ preventScroll: true });
    }, CLOSE_MS);
    return () => {
      clearTimeout(t0);
      clearTimeout(t);
    };
  }, [open]);

  useEffect(() => {
    if (shown) ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
  }, [shown]);

  if (!mounted) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const list = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (list.length === 0) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onKeyDown={onKeyDown}>
      <div
        aria-hidden="true"
        onClick={onClose}
        className={cx("absolute inset-0 touch-none overscroll-contain bg-island/45 transition-opacity duration-[260ms] ease-smooth", shown ? "opacity-100" : "opacity-0")}
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        data-testid={testId}
        className={cx(
          "relative flex max-h-[92dvh] w-full max-w-[390px] flex-col gap-[14px] overflow-y-auto overscroll-contain rounded-t-[32px] bg-card px-4 pt-[10px] pb-[max(30px,env(safe-area-inset-bottom))]",
          "shadow-[0_-10px_40px_rgb(0_0_0/0.18)] transition-transform duration-[320ms] ease-smooth",
          shown ? "translate-y-0" : "translate-y-full",
        )}
      >
        <div aria-hidden="true" className="h-[5px] w-10 shrink-0 self-center rounded-[3px] bg-outline" />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[22px] leading-[1.2] font-bold tracking-[-0.3px]">{title}</h1>
            {subtitle ? <p className="mt-1 text-[14px] text-muted">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            aria-label={ru.duty.swap.close}
            onClick={onClose}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-card-2 text-muted transition-transform duration-200 ease-smooth active:scale-[0.94]"
          >
            <CloseIcon size={16} strokeWidth={2.2} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
