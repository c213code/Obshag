"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRepo } from "@/components/RepoProvider";
import { BellIcon, CheckIcon } from "@/components/ui/icons";
import { Pill } from "@/components/ui/Pill";
import { enablePush, readPushStatus, syncPush } from "@/lib/pushClient";
import type { PushStatus } from "@/lib/pushState";
import { ru } from "@/lib/i18n/ru";

const LABEL: Record<Exclude<PushStatus, "off">, string> = {
  on: ru.shortcut.push.on,
  denied: ru.shortcut.push.denied,
  needs_home_screen: ru.shortcut.push.addToHome,
  unsupported: ru.shortcut.push.unsupported,
  not_configured: ru.shortcut.push.notConfigured,
};
const HINT: Partial<Record<PushStatus, string>> = {
  denied: ru.shortcut.push.deniedHint,
  needs_home_screen: ru.shortcut.push.addToHomeHint,
};

/** «Включить уведомления» and the states it can be in: включены / запрещены в настройках iOS / добавь на экран Домой. */
export function PushPill({ vapidKey }: { vapidKey: string | undefined }) {
  const repo = useRepo();
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    void readPushStatus(vapidKey).then((s) => alive.current && setStatus(s));
    return () => {
      alive.current = false;
    };
  }, [vapidKey]);

  useEffect(() => {
    if (status === "on") void syncPush(repo, vapidKey);
  }, [status, repo, vapidKey]);

  const enable = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const next = await enablePush(repo, vapidKey);
      if (alive.current) setStatus(next);
    } catch {
      if (alive.current) setFailed(true);
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [busy, repo, vapidKey]);

  if (!status) return <div aria-hidden="true" className="h-[48px] animate-pulse rounded-pill bg-card" />;

  return (
    <section aria-labelledby="push-title" className="flex flex-col gap-2">
      <h2 id="push-title" className="text-headline">
        {ru.shortcut.push.title}
      </h2>
      {status === "off" ? (
        <Pill variant="lime" size="lg" onClick={() => void enable()} disabled={busy} data-testid="enable-push" className="w-full">
          <BellIcon size={18} />
          {busy ? ru.shortcut.push.enabling : ru.shortcut.push.enable}
        </Pill>
      ) : (
        <div
          data-testid="push-status"
          data-status={status}
          className="flex items-center gap-3 rounded-pill border border-card-2 bg-card py-[6px] pr-5 pl-[6px]"
        >
          <span
            aria-hidden="true"
            className={`grid size-[36px] shrink-0 place-items-center rounded-full ${status === "on" ? "bg-lime text-on-lime" : "bg-card-2 text-muted"}`}
          >
            {status === "on" ? <CheckIcon size={18} /> : <BellIcon size={18} />}
          </span>
          <span className="text-[15px] font-medium">{LABEL[status]}</span>
        </div>
      )}
      {HINT[status] ? <p className="px-2 text-caption">{HINT[status]}</p> : null}
      {failed ? (
        <p role="alert" className="px-2 text-caption !text-orange">
          {ru.shortcut.push.failed}
        </p>
      ) : null}
    </section>
  );
}
