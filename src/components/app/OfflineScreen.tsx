"use client";

import { EmptyState } from "@/components/ui/EmptyState";
import { Pill } from "@/components/ui/Pill";
import { ru } from "@/lib/i18n/ru";

/** Precached by the service worker and shown instead of a failed navigation. Needs no data and no session. */
export function OfflineScreen() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[390px] flex-col justify-center px-5">
      <EmptyState
        testId="offline-screen"
        title={ru.offline.title}
        text={ru.offline.text}
        action={
          <Pill variant="lime" onClick={() => window.location.reload()}>
            {ru.offline.retry}
          </Pill>
        }
      />
    </main>
  );
}
