"use client";

import { useEffect, useState } from "react";
import { Pill } from "@/components/ui/Pill";
import { Sheet } from "@/components/ui/Sheet";
import { qrPath } from "@/lib/domain/qr";
import { formatInviteCode } from "@/lib/domain/inviteCode";
import { ru } from "@/lib/i18n/ru";

/** «QR»: the join link as a QR code, drawn in token colors (dark modules on the lime card color, no external service). */
export function QrSheet({ open, onClose, url, code }: { open: boolean; onClose: () => void; url: string; code: string }) {
  const [qr, setQr] = useState<{ url: string; size: number; d: string } | null>(null);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    void qrPath(url).then((r) => {
      if (!cancelled) setQr({ url, ...r });
    });
    return () => {
      cancelled = true;
    };
  }, [url]);
  const quiet = 3;
  return (
    <Sheet open={open} onClose={onClose} label={ru.flat.qrTitle} expandedClassName="max-w-[358px] p-5">
      <div className="flex flex-col items-center gap-4">
        <h2 className="text-headline">{ru.flat.qrTitle}</h2>
        {qr && qr.url === url ? (
          <svg
            role="img"
            aria-label={ru.flat.qrLabel}
            data-testid="invite-qr"
            viewBox={`${-quiet} ${-quiet} ${qr.size + quiet * 2} ${qr.size + quiet * 2}`}
            shapeRendering="crispEdges"
            className="size-[240px] rounded-md bg-lime text-on-lime"
          >
            <path d={qr.d} fill="currentColor" />
          </svg>
        ) : null}
        <p className="font-rounded text-[20px] font-bold tracking-[0.04em] tabular-nums">{formatInviteCode(code)}</p>
        <p className="text-center text-caption">{ru.flat.qrHint}</p>
        <Pill variant="on" size="lg" onClick={onClose} className="w-full">
          {ru.common.close}
        </Pill>
      </div>
    </Sheet>
  );
}
