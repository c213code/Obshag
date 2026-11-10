"use client";

import { useSyncExternalStore } from "react";
import { cx } from "@/components/ui/cx";
import { usePresenceValue } from "@/lib/motion/presence";
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
  const { shown, exiting } = usePresenceValue(online ? null : true, 250);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[max(env(safe-area-inset-top),12px)] z-30 flex justify-center">
      {shown ? (
        <div
          role="status"
          data-testid="offline-banner"
          className={cx(
            "mt-[52px] rounded-pill border border-wait-line bg-orange-soft px-3 py-1 text-label !text-orange [--enter-d:0.25s] [--enter-y:-8px] [--leave-d:0.25s]",
            exiting ? "leave" : "enter",
          )}
        >
          {ru.offline.banner}
        </div>
      ) : null}
    </div>
  );
}
