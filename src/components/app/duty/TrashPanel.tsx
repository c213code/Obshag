"use client";

import { useState } from "react";
import { useRepo } from "@/components/RepoProvider";
import { cx } from "@/components/ui/cx";
import { BellIcon, ChevronRightIcon } from "@/components/ui/icons";
import { RepoError } from "@/lib/data/repo";
import { cooldownLeft, dative, weekDoneCount, whenLabel } from "@/lib/domain/dutyEvents";
import { ru } from "@/lib/i18n/ru";
import { useAppActions } from "../AppDataProvider";
import { Dot } from "./parts";
import type { EventDutyView } from "./useEventDuty";

const AVATAR_RING = { boxShadow: "0 0 0 4px var(--color-bin), 0 0 0 6px var(--color-bin-lid)" } as const;
const CHAIN_RING = { boxShadow: "0 0 0 3px var(--color-card), 0 0 0 5px var(--color-bin)" } as const;

const btn =
  "inline-flex h-10 items-center gap-[6px] rounded-[20px] px-4 text-[15px] font-semibold transition-[transform,opacity] duration-200 ease-smooth active:scale-[0.97] disabled:pointer-events-none disabled:opacity-60";

/** The bin drawn behind the card (DutyTrash.dc.html), token colours only. */
function BinArt({ className }: { className?: string }) {
  return (
    <svg width="170" height="200" viewBox="0 0 170 200" aria-hidden="true" focusable="false" className={className}>
      <path d="M48 70 C 40 40, 70 26, 85 40 C 100 26, 130 40, 122 70 Z" className="fill-bin-lid" />
      <path d="M70 44 C 78 30, 92 30, 100 44" fill="none" strokeWidth="5" strokeLinecap="round" className="stroke-bin" />
      <path d="M30 74 h110 l-10 120 h-90 z" className="fill-bin-body" />
      <path d="M30 74 h110" strokeWidth="10" strokeLinecap="round" className="stroke-bin-rim" />
      <path d="M62 100 v74 M85 100 v74 M108 100 v74" strokeWidth="6" strokeLinecap="round" opacity="0.6" className="stroke-bin" />
    </svg>
  );
}

/** «Мусор»: whose turn it is now, «Пакет полный» / «Вынес я», the queue and the history. */
export function TrashPanel({ ev }: { ev: EventDutyView }) {
  const repo = useRepo();
  const { showNotice } = useAppActions();
  const [busy, setBusy] = useState(false);
  const { me, current, queue, events, today, nowMs } = ev;
  const isMe = !!me && current === me.id;
  const name = (id: string | null) => (id && me && id === me.id ? ru.duty.trash.you : ev.nameOf(id));

  const lastDone = events.find((e) => e.kind === "done");
  const lastLine = lastDone
    ? ru.duty.trash.last(me && lastDone.user_id === me.id ? ru.duty.trash.lastYou : ev.nameOf(lastDone.user_id), whenLabel(lastDone.created_at, today))
    : ru.duty.trash.lastNone;

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      if (e instanceof RepoError && e.code === "rate_limited") {
        showNotice(ru.duty.event.cooldown(Math.max(1, Math.ceil((e.retryAfter ?? 60) / 60))));
      } else {
        showNotice(ru.duty.event.failed);
      }
    } finally {
      setBusy(false);
    }
  };

  const done = () =>
    run(async () => {
      await repo.dutyDoneEvent(ev.duty.id);
      await ev.reload();
      showNotice(ru.duty.trash.doneOk);
    });
  const ping = () =>
    run(async () => {
      const left = cooldownLeft(events, "ping", nowMs);
      if (left > 0) {
        showNotice(ru.duty.event.cooldown(Math.max(1, Math.ceil(left / 60))));
        return;
      }
      const e = await repo.dutyPing(ev.duty.id);
      await ev.reload();
      showNotice(isMe ? ru.duty.trash.pingSelf : ru.duty.trash.pingOk(name(current)));
      void ev.notify(e.id);
    });

  const history = events.filter((e) => e.kind === "done" || e.kind === "ping").slice(0, 6);
  const week = weekDoneCount(events, today);

  return (
    <>
      <section aria-label={ru.duty.trash.queue} data-testid="trash-card" className="relative flex h-[208px] flex-col justify-between overflow-hidden rounded-[28px] bg-bin p-5 text-bin-text">
        <BinArt className="pointer-events-none absolute -right-[6px] -bottom-6" />
        <div className="relative flex items-center gap-2 text-[13px] font-medium text-bin-muted">
          <span aria-hidden="true" className="size-2 rounded-full bg-bin-lid" />
          {ru.duty.trash.queue}
        </div>
        <div className="relative flex items-center gap-3">
          {current ? <Dot name={ev.nameOf(current)} tone={ev.toneOf(current)} size={56} fontSize={22} className="font-extrabold" style={AVATAR_RING} /> : null}
          <div className="min-w-0">
            <div data-testid="trash-current" className="truncate text-[26px] leading-[1.1] font-extrabold tracking-[-0.5px]">
              {current ? name(current) : "—"}
            </div>
            <div data-testid="trash-last" className="mt-[3px] text-[14px] text-bin-muted">
              {lastLine}
            </div>
          </div>
        </div>
        <div className="relative flex gap-2">
          <button type="button" data-testid="trash-ping" disabled={busy} onClick={ping} className={cx(btn, "bg-bin-text text-bin")}>
            <BellIcon size={16} strokeWidth={2} />
            {ru.duty.trash.ping}
          </button>
          <button type="button" data-testid="trash-done" disabled={busy} onClick={done} className={cx(btn, "bg-bin-body text-bin-text")}>
            {ru.duty.trash.done}
          </button>
        </div>
      </section>

      <section aria-labelledby="trash-next-h" className="rounded-[24px] bg-card p-4">
        <div className="flex items-baseline justify-between pb-3">
          <h2 id="trash-next-h" className="text-[17px] font-bold">
            {ru.duty.trash.next}
          </h2>
          <span className="text-[13px] text-muted">{ru.duty.trash.nextHint}</span>
        </div>
        <ol data-testid="trash-chain" className="flex items-center gap-[6px] overflow-x-auto [scrollbar-width:none]">
          {queue.map((id, i) => {
            const mine = !!me && id === me.id;
            const label = i === 0 ? ru.duty.trash.now : mine ? ru.duty.trash.youLabel : i === 1 ? ru.duty.trash.then : ru.duty.trash.after(i);
            return (
              <li key={id} className="flex shrink-0 items-center gap-[6px]">
                {i > 0 ? <ChevronRightIcon size={16} strokeWidth={2.2} className="text-faint" /> : null}
                <div className={cx("flex flex-col items-center gap-[6px]", i === 0 ? "w-16" : "w-14")}>
                  <Dot name={ev.nameOf(id)} tone={ev.toneOf(id)} size={i === 0 ? 48 : 40} fontSize={i === 0 ? 17 : 15} style={i === 0 ? CHAIN_RING : undefined} />
                  <span className={cx("max-w-full truncate text-[12px]", i === 0 ? "font-semibold" : "text-muted")}>{label}</span>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-labelledby="trash-history-h" className="rounded-[24px] bg-card px-4 py-[6px]">
        <div className="flex items-baseline justify-between pt-[10px] pb-[6px]">
          <h2 id="trash-history-h" className="text-[17px] font-bold">
            {ru.duty.trash.history}
          </h2>
          <span className="text-[13px] text-muted">{ru.duty.trash.week(week)}</span>
        </div>
        {history.length === 0 ? (
          <p data-testid="trash-history-empty" className="border-t border-hairline py-4 text-[14px] text-muted">
            {ru.duty.trash.historyEmpty}
          </p>
        ) : (
          <ul data-testid="trash-history">
            {history.map((e) => {
              const mine = !!me && e.user_id === me.id;
              const isPing = e.kind === "ping";
              const target = e.partner_id ? (me && e.partner_id === me.id ? "тебе" : dative(ev.nameOf(e.partner_id))) : "";
              return (
                <li key={e.id} className="flex items-center gap-3 border-t border-hairline py-[9px]">
                  {isPing ? (
                    <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-orange-soft text-orange">
                      <BellIcon size={15} strokeWidth={2} />
                    </span>
                  ) : (
                    <Dot name={ev.nameOf(e.user_id)} tone={ev.toneOf(e.user_id)} size={32} fontSize={12} />
                  )}
                  <span className={cx("min-w-0 flex-1 truncate text-[15px]", isPing && "text-muted")}>
                    {isPing
                      ? ru.duty.trash.pinged(mine ? ru.duty.trash.you : ev.nameOf(e.user_id), target)
                      : mine
                        ? ru.duty.trash.youDone
                        : ru.duty.trash.doneBy(ev.nameOf(e.user_id))}
                  </span>
                  <span className="shrink-0 text-[13px] text-muted">{whenLabel(e.created_at, today)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
