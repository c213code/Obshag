"use client";

import { useEffect } from "react";
import { CloseIcon } from "@/components/ui/icons";
import { Bar } from "@/components/ui/Bar";
import { cx } from "@/components/ui/cx";
import { usePresenceValue } from "@/lib/motion/presence";
import { ru } from "@/lib/i18n/ru";
import { useAppActions, useNotice } from "./AppDataProvider";

const VISIBLE_MS = 6000;

/** A capsule notice above the tab bar (rollback messages, errors). Fades and slides up; auto-dismisses. */
export function Toast() {
  const notice = useNotice();
  const { dismissNotice } = useAppActions();
  const { shown, exiting } = usePresenceValue(notice, 350);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(dismissNotice, VISIBLE_MS);
    return () => clearTimeout(t);
  }, [notice, dismissNotice]);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[120px] z-50 flex justify-center px-5">
      {shown ? (
        // keyed by the text: a new notice replaces the old one with a fresh enter
        <div
          key={shown}
          role="alert"
          className={cx("pointer-events-auto w-full max-w-[350px] [--enter-d:0.35s] [--enter-y:16px] [--leave-d:0.35s] [--leave-y:8px]", exiting ? "leave" : "enter")}
        >
            <Bar className="gap-3 !bg-card pl-5">
              <p className="min-w-0 flex-1 py-2 text-body">{shown}</p>
              <button
                type="button"
                aria-label={ru.toast.close}
                onClick={dismissNotice}
                className="inline-flex size-[44px] shrink-0 items-center justify-center rounded-full bg-card-2 text-text"
              >
                <CloseIcon size={18} />
              </button>
            </Bar>
        </div>
      ) : null}
    </div>
  );
}
