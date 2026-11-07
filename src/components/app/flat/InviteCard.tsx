"use client";

import { useEffect, useRef, useState } from "react";
import { formatInviteCode } from "@/lib/domain/inviteCode";
import { ru } from "@/lib/i18n/ru";
import { SHORTCUT_ICLOUD_URL } from "@/lib/shortcutLink";
import { QrSheet } from "./QrSheet";

/** The lime invite card of Invite.dc.html: code, «Поделиться» (Web Share, copy as the fallback) and «QR». */
export function InviteCard({ code, householdName }: { code: string; householdName: string }) {
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const link = () => `${window.location.origin}/join/${encodeURIComponent(code)}`;

  const share = async () => {
    const url = link();
    // one message: the join link and the Apple Pay Shortcut (url is inside the text so the order stays readable)
    const text = ru.flat.shareWithShortcut(householdName, url, SHORTCUT_ICLOUD_URL);
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: householdName, text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // the share sheet was dismissed, or the clipboard is not available: nothing to do
    }
  };

  return (
    <>
      <section aria-label={ru.flat.inviteCode} className="relative flex flex-col gap-3 overflow-hidden rounded-lg bg-lime p-5 text-on-lime">
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 170 170"
          className="pointer-events-none absolute -top-10 -right-10 size-[170px]"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.08"
        >
          <circle cx="85" cy="85" r="76" strokeWidth="20" />
        </svg>
        <span className="relative text-label">{ru.flat.inviteCode}</span>
        <p
          data-testid="invite-code"
          aria-label={code}
          className="relative font-rounded text-[30px] leading-[1.1] font-bold tracking-[0.02em] whitespace-nowrap tabular-nums"
        >
          {formatInviteCode(code)}
        </p>
        <div className="relative flex gap-2 rounded-pill bg-on-lime/[0.08] p-[5px]">
          <button
            type="button"
            onClick={share}
            data-testid="invite-share"
            className="flex-1 rounded-pill bg-on-lime p-3 text-[15px] font-semibold text-lime transition-transform duration-200 ease-smooth active:scale-[0.97]"
          >
            {copied ? ru.flat.copied : ru.flat.share}
          </button>
          <button
            type="button"
            onClick={() => setQrOpen(true)}
            data-testid="invite-qr-open"
            className="rounded-pill px-5 py-3 text-[15px] font-semibold text-on-lime transition-transform duration-200 ease-smooth active:scale-[0.97]"
          >
            {ru.flat.qr}
          </button>
        </div>
      </section>
      <QrSheet open={qrOpen} onClose={() => setQrOpen(false)} url={qrOpen ? link() : ""} code={code} />
    </>
  );
}
