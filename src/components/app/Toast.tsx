"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CloseIcon } from "@/components/ui/icons";
import { Bar } from "@/components/ui/Bar";
import { ease, useReducedMotionSafe } from "@/lib/motion";
import { ru } from "@/lib/i18n/ru";
import { useAppActions, useNotice } from "./AppDataProvider";

const VISIBLE_MS = 6000;

/** A capsule notice above the tab bar (rollback messages, errors). Fades and slides up; auto-dismisses. */
export function Toast() {
  const notice = useNotice();
  const { dismissNotice } = useAppActions();
  const { reduced } = useReducedMotionSafe();

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(dismissNotice, VISIBLE_MS);
    return () => clearTimeout(t);
  }, [notice, dismissNotice]);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[120px] z-50 flex justify-center px-5">
      <AnimatePresence>
        {notice ? (
          <motion.div
            key={notice}
            role="alert"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
            transition={{ duration: 0.35, ease: ease.smooth }}
            className="pointer-events-auto w-full max-w-[350px]"
          >
            <Bar className="gap-3 !bg-card pl-5">
              <p className="min-w-0 flex-1 py-2 text-body">{notice}</p>
              <button
                type="button"
                aria-label={ru.toast.close}
                onClick={dismissNotice}
                className="inline-flex size-[44px] shrink-0 items-center justify-center rounded-full bg-card-2 text-text"
              >
                <CloseIcon size={18} />
              </button>
            </Bar>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
