"use client";

import { useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ease } from "@/lib/motion";
import { ru } from "@/lib/i18n/ru";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

/** «Офлайн» pill under the header while the device has no connection. Writes keep their rollback and toasts. */
export function OfflineBanner() {
  const online = useOnline();
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[max(env(safe-area-inset-top),12px)] z-30 flex justify-center">
      <AnimatePresence>
        {online ? null : (
          <motion.div
            role="status"
            data-testid="offline-banner"
            className="mt-[52px] rounded-pill border border-wait-line bg-orange-soft px-3 py-1 text-label !text-orange"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: ease.smooth }}
          >
            {ru.offline.banner}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
