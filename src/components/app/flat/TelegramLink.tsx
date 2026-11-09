"use client";

import { useState } from "react";
import { useRepo } from "@/components/RepoProvider";
import { Pill, pillClass } from "@/components/ui/Pill";
import { telegramLink } from "@/lib/domain/telegramLink";
import { ru } from "@/lib/i18n/ru";

const t = ru.flat.profile;

/**
 * Профиль: connect the Telegram DM bot. Not linked: a pill creates a single-use code and turns into an «Открыть Telegram»
 * link (t.me/<bot>?start=<code>). Linked: «Telegram подключён · Отключить». `onChanged` refreshes the profile.
 */
export function TelegramLink({ linked, onChanged }: { linked: boolean; onChanged: () => void }) {
  const repo = useRepo();
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const code = await repo.createTelegramLinkCode();
      const link = telegramLink(code, process.env.NEXT_PUBLIC_TELEGRAM_BOT);
      setUrl(link);
      // a popup blocker may refuse this (we are after an await): the visible link below is the reliable path
      window.open(link, "_blank", "noopener,noreferrer");
    } catch {
      setError(t.tgFailed);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await repo.unlinkTelegram();
      setUrl(null);
      onChanged();
    } catch {
      setError(t.tgFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2" data-testid="telegram-link">
      {linked ? (
        <div className="flex items-center gap-3 rounded-pill border border-hairline bg-card py-[6px] pr-[6px] pl-5" data-testid="telegram-connected">
          <div className="min-w-0 flex-1">
            <p className="text-body">{t.tgConnected}</p>
            <p className="text-caption">{t.tgConnectedHint}</p>
          </div>
          <Pill variant="on" size="row" onClick={() => void disconnect()} disabled={busy} data-testid="telegram-disconnect">
            {t.tgDisconnect}
          </Pill>
        </div>
      ) : url ? (
        <>
          <a href={url} target="_blank" rel="noopener noreferrer" className={pillClass("lime", "lg", "w-full")} data-testid="telegram-open">
            {t.tgOpen}
          </a>
          <p className="px-1 text-caption" data-testid="telegram-open-hint">
            {t.tgOpenHint}
          </p>
        </>
      ) : (
        <Pill variant="on" size="lg" className="w-full" onClick={() => void connect()} disabled={busy} data-testid="telegram-connect">
          {t.tgConnect}
        </Pill>
      )}
      {error ? (
        <p role="alert" className="px-1 text-label text-orange">
          {error}
        </p>
      ) : null}
    </div>
  );
}
