"use client";

import { EmptyState } from "@/components/ui/EmptyState";
import { Pill, PillLink } from "@/components/ui/Pill";
import { ru } from "@/lib/i18n/ru";

/** Global error boundary: a calm capsule message, a way to retry and a way home. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[390px] flex-col justify-center px-5">
      <EmptyState
        testId="error-screen"
        title={ru.errorPage.title}
        text={ru.errorPage.text}
        action={
          <div className="flex gap-2">
            <Pill variant="lime" onClick={() => reset()}>
              {ru.errorPage.refresh}
            </Pill>
            <PillLink href="/" variant="on">
              {ru.errorPage.home}
            </PillLink>
          </div>
        }
      />
    </main>
  );
}
