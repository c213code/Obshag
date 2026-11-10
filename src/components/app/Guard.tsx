"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Pill } from "@/components/ui/Pill";
import { guardRedirect, type PageKind } from "@/lib/domain/guard";
import { ru } from "@/lib/i18n/ru";
import { useAppActions, useAppStatus } from "./AppDataProvider";
import { ScreenSkeleton } from "./ScreenSkeleton";

/**
 * Auth guard: keeps each screen reachable only at the right onboarding stage
 * (signed out -> /login, no profile -> /onboarding, no household -> /household).
 * Renders a skeleton while loading or redirecting, so protected content never flashes.
 */
export function Guard({ page, children }: { page: PageKind; children: ReactNode }) {
  const { status, stage } = useAppStatus();
  const { refresh } = useAppActions();
  const router = useRouter();
  const target = status === "ready" ? guardRedirect(stage, page) : null;

  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  if (status === "error") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-[390px] flex-col items-start justify-center gap-4 px-5">
        <p role="alert" className="text-headline">
          {ru.errors.loadFailed}
        </p>
        <Pill variant="lime" onClick={() => void refresh()}>
          {ru.errors.retry}
        </Pill>
      </main>
    );
  }
  if (status === "loading" || target) return <ScreenSkeleton />;
  return <>{children}</>;
}
