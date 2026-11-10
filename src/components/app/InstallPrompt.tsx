"use client";

import { useEffect, useState } from "react";
import { CloseIcon, ShareIcon } from "@/components/ui/icons";
import { Pill } from "@/components/ui/Pill";
import { cx } from "@/components/ui/cx";
import { usePresenceValue } from "@/lib/motion/presence";
import { isIos, isStandalone } from "@/lib/pwa";
import { ru } from "@/lib/i18n/ru";

const KEY = "obshak.install.dismissedAt";
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

type InstallEvent = Event & { prompt(): Promise<unknown> };

export function isSnoozed(raw: string | null, now = Date.now()): boolean {
  const at = Number(raw);
  return Number.isFinite(at) && at > 0 && now - at < SNOOZE_MS;
}

function readSnoozed(): boolean {
  try {
    return isSnoozed(window.localStorage.getItem(KEY));
  } catch {
    return false;
  }
}

/** Dismissible bottom capsule: iOS Safari gets the Share → Home Screen hint, browsers with beforeinstallprompt get an install button. */
export function InstallPrompt() {
  const [mode, setMode] = useState<"ios" | "prompt" | null>(null);
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const { shown, exiting } = usePresenceValue(mode, 300);

  useEffect(() => {
    if (isStandalone() || readSnoozed()) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as InstallEvent);
      setMode("prompt");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    // after the first paint, so the hint never competes with the screen appearing
    const timer = isIos() ? window.setTimeout(() => setMode((m) => m ?? "ios"), 600) : undefined;
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  const dismiss = () => {
    try {
      window.localStorage.setItem(KEY, String(Date.now()));
    } catch {
      // private mode: it simply comes back next visit
    }
    setMode(null);
  };

  const install = async () => {
    if (!event) return;
    await event.prompt().catch(() => undefined);
    dismiss();
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(max(env(safe-area-inset-bottom),28px)+84px)] z-30 flex justify-center px-5">
      {shown ? (
        <div
          data-testid="install-prompt"
          className={cx(
            "pointer-events-auto flex w-full max-w-[350px] items-center gap-3 rounded-pill border border-card-2 bg-card py-[6px] pl-4 pr-[6px] [--enter-d:0.3s] [--enter-y:12px] [--leave-d:0.3s]",
            exiting ? "leave" : "enter",
          )}
        >
            <ShareIcon size={20} className="shrink-0 text-lime" />
            <p className="flex-1 text-label !text-text">{shown === "ios" ? ru.install.ios : ru.install.android}</p>
            {shown === "prompt" ? (
              <Pill variant="lime" size="row" onClick={() => void install()}>
                {ru.install.action}
              </Pill>
            ) : null}
            <button
              type="button"
              onClick={dismiss}
              aria-label={ru.install.dismiss}
              className="grid size-9 shrink-0 place-items-center rounded-full bg-card-2 text-muted transition-transform duration-200 ease-smooth active:scale-90"
            >
              <CloseIcon size={16} />
            </button>
        </div>
      ) : null}
    </div>
  );
}
