"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/ui/Header";
import { CheckIcon, CopyIcon } from "@/components/ui/icons";
import { Pill, pillClass } from "@/components/ui/Pill";
import { SHORTCUT_ICLOUD_URL } from "@/lib/shortcutLink";
import { copyText } from "@/lib/clipboard";
import type { CaptureTokenInfo } from "@/lib/data/types";
import { getPublicEnv } from "@/lib/env/public";
import { ru } from "@/lib/i18n/ru";
import { useRepo } from "@/components/RepoProvider";
import { useAppData } from "../AppDataProvider";
import { Screen } from "../Screen";
import { PushPill } from "./PushPill";
import { Steps } from "./Steps";

const dateFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/** A labelled value with a copy pill (URL or token). */
function CopyField({ label, value, testId, mono }: { label: string; value: string; testId: string; mono?: boolean }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = () => {
    void copyText(value).then((ok) => {
      setState(ok ? "copied" : "failed");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setState("idle"), 2000);
    });
  };
  return (
    <div className="flex flex-col gap-2">
      <span className="text-label !text-muted">{label}</span>
      <div className={mono ? "flex flex-col gap-3 rounded-md border border-card-2 bg-card p-3" : "flex items-center gap-2 rounded-pill border border-card-2 bg-card py-[6px] pr-[6px] pl-4"}>
        <code
          data-testid={testId}
          className={mono ? "block min-w-0 font-mono text-[14px] leading-[1.5] break-all select-all" : "min-w-0 flex-1 truncate text-[14px]"}
        >
          {value}
        </code>
        <Pill variant="on" size="sm" onClick={copy} aria-label={`${ru.shortcut.copy}: ${label}`} className={mono ? "!h-9 w-full" : "!h-9"}>
          {state === "copied" ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
          {state === "copied" ? ru.shortcut.copied : ru.shortcut.copy}
        </Pill>
      </div>
      {state === "failed" ? (
        <p role="status" className="text-caption !text-orange">
          {ru.shortcut.copyFailed}
        </p>
      ) : null}
    </div>
  );
}

/** /settings/shortcut: the one-time capture key, the Shortcuts recipe and the notification switch. */
export function ShortcutScreen() {
  const router = useRouter();
  const repo = useRepo();
  const { me } = useAppData();
  const [info, setInfo] = useState<CaptureTokenInfo | null | undefined>(undefined); // undefined = loading
  const [installCopied, setInstallCopied] = useState(false);
  const [token, setToken] = useState<string | null>(null); // plaintext, in memory only, shown once
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    repo
      .getCaptureTokenInfo()
      .then((i) => !cancelled && setInfo(i))
      .catch(() => {
        if (!cancelled) {
          setInfo(null);
          setError(ru.shortcut.errors.loadFailed);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [repo]);

  const rotate = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const fresh = await repo.rotateCaptureToken();
      if (!alive.current) return;
      setToken(fresh);
      setInfo({ created_at: new Date().toISOString(), last_used_at: null });
    } catch {
      if (alive.current) setError(ru.shortcut.errors.createFailed);
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [busy, repo]);

  if (!me) return null;
  // this tree renders on the client only (RepoProvider), so reading the origin here cannot mismatch the server render
  const url = `${typeof window === "undefined" ? "" : window.location.origin}/api/capture`;
  const vapidKey = getPublicEnv().NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  return (
    <Screen topOffset={54} bottomRoom={false} className="pb-12">
      <Header title={ru.shortcut.title} onBack={() => (window.history.length > 1 ? router.back() : router.push("/flat"))} />
      <p className="text-body !text-muted">{ru.shortcut.intro}</p>

      <section aria-labelledby="token-title" className="flex flex-col gap-3 rounded-lg bg-card p-4">
        <h2 id="token-title" className="text-headline">
          {ru.shortcut.tokenTitle}
        </h2>
        {token ? (
          <>
            <CopyField label={ru.shortcut.tokenLabel} value={token} testId="capture-token" mono />
            <p role="note" data-testid="token-warning" className="rounded-sm bg-lime-soft px-3 py-2 text-[13px] font-medium text-lime">
              {ru.shortcut.saveWarning}
            </p>
            <a
              href={SHORTCUT_ICLOUD_URL}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="install-shortcut"
              // copy inside the tap (iOS only allows clipboard writes during the gesture), then the link opens Shortcuts
              onClick={() => {
                void copyText(token);
                setInstallCopied(true);
              }}
              className={pillClass("lime", "lg", "w-full")}
            >
              {ru.shortcut.install}
            </a>
            {installCopied ? (
              <p role="status" className="text-center text-caption">
                {ru.shortcut.installCopied}
              </p>
            ) : null}
          </>
        ) : info === undefined ? (
          <div aria-hidden="true" className="h-[44px] animate-pulse rounded-pill bg-card-2" />
        ) : info ? (
          <div data-testid="token-exists" className="flex flex-col gap-1">
            <p className="text-body">{ru.shortcut.existsTitle}</p>
            <p className="text-caption">
              {ru.shortcut.existsText(dateFormat.format(new Date(info.created_at)))}{" "}
              {info.last_used_at ? ru.shortcut.lastUsed(dateFormat.format(new Date(info.last_used_at))) : ru.shortcut.neverUsed}.
            </p>
          </div>
        ) : null}
        {info !== undefined ? (
          <div className="flex flex-col gap-2 pt-1">
            <Pill variant={info ? "on" : "lime"} size="lg" onClick={() => void rotate()} disabled={busy} data-testid="rotate-token" className="w-full">
              {busy ? ru.shortcut.creating : info ? ru.shortcut.rotate : ru.shortcut.create}
            </Pill>
            {info && !token ? <p className="text-center text-caption">{ru.shortcut.rotateHint}</p> : null}
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-caption !text-orange">
            {error}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="quick-title" className="flex flex-col gap-3">
        <h2 id="quick-title" className="text-headline">
          {ru.shortcut.quick.title}
        </h2>
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-body">
          <li>{ru.shortcut.quick.one}</li>
          <li>{ru.shortcut.quick.two}</li>
          <li>{ru.shortcut.quick.three}</li>
        </ol>
      </section>

      <section aria-labelledby="steps-title" className="flex flex-col gap-3">
        <h2 id="steps-title" className="text-headline">
          {ru.shortcut.manualTitle}
        </h2>
        <Steps urlField={<CopyField label={ru.shortcut.urlLabel} value={url} testId="capture-url" />} />
      </section>

      <p className="text-caption">{ru.shortcut.note}</p>

      <PushPill vapidKey={vapidKey} />
    </Screen>
  );
}
