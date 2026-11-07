"use client";

import { EmptyState } from "@/components/ui/EmptyState";
import { Pill, PillLink } from "@/components/ui/Pill";
import { ru } from "@/lib/i18n/ru";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[390px] flex-col justify-center px-5">
      <EmptyState
        testId="not-found-screen"
        title={ru.notFound.title}
        text={ru.notFound.text}
        action={
          <div className="flex gap-2">
            <PillLink href="/" variant="lime">
              {ru.errorPage.home}
            </PillLink>
            <Pill variant="on" onClick={() => window.location.reload()}>
              {ru.errorPage.refresh}
            </Pill>
          </div>
        }
      />
    </main>
  );
}
