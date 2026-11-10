"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KeyIcon, PlusIcon } from "@/components/ui/icons";
import { cx } from "@/components/ui/cx";
import { pendingJoin } from "@/lib/pendingJoin";
import { ru } from "@/lib/i18n/ru";
import { AuthFrame } from "./AuthFrame";
import { useAppStatus } from "./AppDataProvider";
import { Guard } from "./Guard";

function Choice({ href, icon, title, caption, primary }: { href: string; icon: ReactNode; title: string; caption: string; primary?: boolean }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-4 rounded-pill border border-card-2 bg-card p-[6px] pr-6 transition-transform duration-200 ease-smooth active:scale-[0.98]"
    >
      <span
        className={cx(
          "inline-flex size-[68px] shrink-0 items-center justify-center rounded-full",
          primary ? "bg-lime text-on-lime" : "bg-card-2 text-text",
        )}
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-headline">{title}</span>
        <span className="text-caption">{caption}</span>
      </span>
    </Link>
  );
}

/** «Создать квартиру» / «У меня есть код»: two big capsule choices. */
export function HouseholdChoice() {
  const router = useRouter();
  const { status, stage } = useAppStatus();

  // A deep link opened before onboarding: continue with it, but only for a user who is exactly at this step
  // (profile done, no household yet). Everyone else just sees the choice.
  useEffect(() => {
    if (status !== "ready" || stage !== 2) return;
    const code = pendingJoin.get();
    if (code) router.replace(`/join/${encodeURIComponent(code)}`);
  }, [router, status, stage]);

  return (
    <Guard page="household">
      <AuthFrame title={ru.household.title} subtitle={ru.household.subtitle}>
        <div className="flex flex-col gap-3">
          <Choice href="/household/new" primary icon={<PlusIcon size={28} strokeWidth={2.2} />} title={ru.household.create.title} caption={ru.household.create.caption} />
          <Choice href="/join" icon={<KeyIcon size={26} />} title={ru.household.join.title} caption={ru.household.join.caption} />
        </div>
      </AuthFrame>
    </Guard>
  );
}
