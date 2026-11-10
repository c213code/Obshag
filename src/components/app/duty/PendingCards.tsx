"use client";

import Link from "next/link";
import { useState } from "react";
import { useRepo } from "@/components/RepoProvider";
import { SwapIcon } from "@/components/ui/icons";
import { effectiveStatus, shortDay } from "@/lib/domain/duty";
import { ru } from "@/lib/i18n/ru";
import { useAppActions } from "../AppDataProvider";
import { Dot } from "./parts";
import { useNow, type DutyView } from "./useDuty";

/** My outgoing request (with «Отменить») and the incoming ones waiting for my answer. */
export function PendingCards({ view }: { view: DutyView }) {
  const repo = useRepo();
  const { showNotice } = useAppActions();
  const [busy, setBusy] = useState<string | null>(null);
  const me = view.me;
  const now = useNow();
  if (!me) return null;
  const pending = view.requests.filter((r) => effectiveStatus(r, now) === "pending");
  const outgoing = pending.filter((r) => r.from_user === me.id);
  const incoming = pending.filter((r) => r.to_user === me.id);
  if (outgoing.length === 0 && incoming.length === 0) return null;

  const cancel = async (id: string) => {
    setBusy(id);
    try {
      await repo.cancelSwap(id);
      await view.reload();
    } catch {
      showNotice(ru.duty.pendingOut.cancelFailed);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-2" data-testid="duty-pending">
      {incoming.map((r) => (
        <Link
          key={r.id}
          href={`/duty/request/${r.id}`}
          data-testid="duty-incoming"
          className="flex items-center gap-3 rounded-[20px] bg-lime-soft p-3 transition-transform duration-200 ease-smooth active:scale-[0.99]"
        >
          <Dot name={view.nameOf(r.from_user)} tone={view.toneOf(r.from_user)} size={40} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold">{ru.duty.pendingIn.title(view.nameOf(r.from_user))}</span>
            <span className="block text-[13px] text-muted">{ru.duty.pendingOut.days(shortDay(r.from_day), shortDay(r.to_day))}</span>
          </span>
          <span className="rounded-full bg-lime px-3 py-2 text-[13px] font-semibold text-on-lime">{ru.duty.pendingIn.open}</span>
        </Link>
      ))}
      {outgoing.map((r) => (
        <div key={r.id} data-testid="duty-outgoing" className="flex items-center gap-3 rounded-[20px] bg-card p-3">
          <span aria-hidden="true" className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-lime-soft text-lime">
            <SwapIcon size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold">{ru.duty.pendingOut.title(view.nameOf(r.to_user))}</span>
            <span className="block text-[13px] text-muted">{ru.duty.pendingOut.days(shortDay(r.from_day), shortDay(r.to_day))}</span>
          </span>
          <button
            type="button"
            data-testid="duty-cancel-swap"
            disabled={busy === r.id}
            onClick={() => cancel(r.id)}
            className="rounded-full bg-card-2 px-3 py-2 text-[13px] font-semibold transition-[transform,opacity] duration-200 ease-smooth active:scale-[0.97] disabled:opacity-50"
          >
            {ru.duty.pendingOut.cancel}
          </button>
        </div>
      ))}
    </div>
  );
}
