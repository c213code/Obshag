"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Bar } from "@/components/ui/Bar";
import { ExternalIcon } from "@/components/ui/icons";
import { Money } from "@/components/ui/Money";
import { Pill } from "@/components/ui/Pill";
import { PaidPromptSheet } from "@/components/app/settle/PaidPromptSheet";
import { copyText, KASPI_TRANSFERS_URL } from "@/lib/clipboard";
import type { PaidAnswer, PayLinkView } from "@/lib/data/types";
import { maskKaspiPhone } from "@/lib/domain/phoneFormat";
import { formatTenge } from "@/lib/format/money";
import { decline } from "@/lib/i18n/declension";
import { ru } from "@/lib/i18n/ru";

type Stored = { armed: boolean; prompt: string | null };

const storeKey = (code: string) => `obshak:k:${code}`;

/** What this browser remembers about the link: «went to Kaspi» (armed) and the prompt id. Survives the app switch and a reload. */
function readStored(code: string): Stored {
  try {
    const raw = window.localStorage.getItem(storeKey(code));
    if (raw) {
      const v = JSON.parse(raw) as Partial<Stored>;
      return { armed: v.armed === true, prompt: typeof v.prompt === "string" ? v.prompt : null };
    }
  } catch {
    // private mode: the link still works, it just cannot ask again after a reload
  }
  return { armed: false, prompt: null };
}
function writeStored(code: string, value: Stored | null) {
  try {
    if (value === null) window.localStorage.removeItem(storeKey(code));
    else window.localStorage.setItem(storeKey(code), JSON.stringify(value));
  } catch {
    // ignored: see readStored
  }
}

type Done = Exclude<PaidAnswer, "no"> | "failed";

/** One line under the card for the states that have nothing to pay. */
function Notice({ title, text }: { title: string; text?: string }) {
  return (
    <section data-testid="pay-notice" role="status" className="enter flex flex-col gap-1 rounded-lg border border-hairline bg-card px-5 py-5">
      <h2 className="text-headline">{title}</h2>
      {text ? <p className="text-caption">{text}</p> : null}
    </section>
  );
}

/**
 * /k/<code>: the page behind «💸 Перевести» in the Telegram reminder. One lime button copies the creditor's Kaspi number
 * and opens Kaspi (both inside the tap: iOS only allows the clipboard and the app switch there). When the user comes back,
 * «Ты оплатил <имя> <сумма>?» asks whether the transfer went through; «Да» marks it, the creditor still confirms.
 */
export function PayLinkScreen({ code, view }: { code: string; view: PayLinkView | "error" }) {
  const [current, setCurrent] = useState<PayLinkView | "error">(view);
  const [asking, setAsking] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const checking = useRef(false);
  const pay = current !== "error" && current.state !== "expired" ? current : null;

  /** The prompt of this pair: the one the open call returned, or (the response never reached us) the same call again. */
  const ensurePrompt = useCallback(async (): Promise<string | null> => {
    const stored = readStored(code);
    if (stored.prompt) return stored.prompt;
    try {
      const res = await fetch(`/api/k/${code}/open`, { method: "POST", credentials: "same-origin" });
      const json = (await res.json().catch(() => null)) as { state?: string; prompt_id?: string | null } | null;
      if (json?.prompt_id) {
        writeStored(code, { armed: true, prompt: json.prompt_id });
        return json.prompt_id;
      }
      if (json?.state === "paid" || json?.state === "small") setCurrent((c) => (c !== "error" && c.state !== "expired" ? { ...c, state: json.state as "paid" | "small" } : c));
      else if (json?.state === "expired") setCurrent({ state: "expired" });
    } catch {
      // offline: the question comes with the next return
    }
    return null;
  }, [code]);

  /** Back from Kaspi (the page became visible, or it was reloaded): ask whether the transfer went through. */
  const check = useCallback(async () => {
    if (checking.current || !readStored(code).armed) return;
    checking.current = true;
    try {
      const prompt = await ensurePrompt();
      if (prompt) setAsking((cur) => cur ?? prompt);
      else writeStored(code, null);
    } finally {
      checking.current = false;
    }
  }, [code, ensurePrompt]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    void check(); // reloaded after Kaspi
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, [check]);

  const go = () => {
    if (!pay || pay.state !== "pay" || !pay.to_phone) return;
    // everything below happens synchronously inside the tap: the clipboard and the app switch both need the gesture
    void copyText(pay.to_phone);
    writeStored(code, { armed: true, prompt: readStored(code).prompt });
    // fire and forget: the page is about to be left, keepalive lets the request finish
    void fetch(`/api/k/${code}/open`, { method: "POST", credentials: "same-origin", keepalive: true })
      .then((res) => res.json().catch(() => null))
      .then((json: { prompt_id?: string | null } | null) => {
        if (json?.prompt_id) writeStored(code, { armed: true, prompt: json.prompt_id });
      })
      .catch(() => undefined);
    window.location.href = KASPI_TRANSFERS_URL;
  };

  const answer = async (yes: boolean) => {
    const prompt = asking;
    if (!prompt) return;
    writeStored(code, null);
    try {
      const res = await fetch(`/api/k/${code}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt_id: prompt, yes }),
        credentials: "same-origin",
      });
      const json = (await res.json().catch(() => null)) as { result?: PaidAnswer } | null;
      if (!res.ok || !json?.result) {
        setDone("failed");
        return;
      }
      if (json.result !== "no") setDone(json.result);
      if (json.result === "marked") setCurrent((c) => (c !== "error" && c.state !== "expired" ? { ...c, state: "paid" } : c));
    } catch {
      setDone("failed");
    }
  };

  const name = pay?.to_name ?? "";
  const masked = pay ? maskKaspiPhone(pay.to_phone) : null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[390px] flex-col gap-4 px-5 pt-[max(0px,calc(54px-env(safe-area-inset-top)))] pb-[max(24px,env(safe-area-inset-bottom))]">
      <p className="text-label text-muted">{ru.payLink.brand}</p>

      {pay ? (
        <section
          data-testid="pay-card"
          className="enter flex flex-col items-center gap-4 rounded-lg border border-hairline bg-card px-4 py-6 text-center"
        >
          <Avatar name={name} color="blue" size={52} decorative />
          <div className="flex flex-col gap-1">
            <span className="text-caption">{ru.payLink.transferTo}</span>
            <h1 data-testid="pay-to" className="text-headline">
              {decline(name, "dat")}
            </h1>
          </div>
          {pay.state === "pay" ? (
            <Money value={pay.amount} data-testid="pay-amount" className="font-rounded text-[44px] leading-[1.05] font-bold tracking-[-0.02em]" />
          ) : (
            <span data-testid="pay-amount" className="font-rounded text-[44px] leading-[1.05] font-bold tracking-[-0.02em] text-muted">
              {formatTenge(pay.amount)}
            </span>
          )}
          {pay.state === "pay" ? (
            <Bar className="w-full pl-5" data-testid="kaspi-bar">
              <div className="flex min-w-0 flex-1 flex-col text-left">
                <span className="truncate text-caption">{ru.payLink.kaspiOf(name)}</span>
                <span className="text-headline tabular-nums">{masked ?? ru.payLink.noKaspi}</span>
              </div>
            </Bar>
          ) : null}
        </section>
      ) : null}

      {pay?.state === "paid" && !done ? <Notice title={ru.payLink.paid} text={ru.payLink.paidText} /> : null}
      {pay?.state === "small" ? <Notice title={ru.payLink.small} text={ru.payLink.smallText} /> : null}
      {current === "error" ? <Notice title={ru.payLink.failed} text={ru.payLink.failedText} /> : null}
      {current !== "error" && current.state === "expired" ? <Notice title={ru.payLink.expired} text={ru.payLink.expiredText} /> : null}
      {done ? (
        <Notice
          title={done === "marked" ? ru.payLink.result.marked(name) : ru.payLink.result[done]}
        />
      ) : null}

      <div className="flex-1" />

      {pay?.state === "pay" && !done ? (
        <div className="flex flex-col items-center gap-2">
          <Pill variant="lime" size="lg" onClick={go} disabled={!pay.to_phone} className="w-full" data-testid="pay-go">
            {ru.payLink.go}
            <ExternalIcon size={18} strokeWidth={2.2} />
          </Pill>
          <p className="text-center text-caption">{ru.payLink.hint}</p>
        </div>
      ) : null}
      <Link href="/" prefetch={false} className="self-center py-2 text-label font-semibold text-lime" data-testid="pay-open-app">
        {ru.payLink.openApp}
      </Link>

      {asking && pay ? (
        <PaidPromptSheet
          key={asking}
          name={name}
          amount={pay.amount}
          copy={ru.payLink.ask}
          onAnswer={(yes) => void answer(yes)}
          onClosed={() => setAsking(null)}
        />
      ) : null}
    </main>
  );
}
