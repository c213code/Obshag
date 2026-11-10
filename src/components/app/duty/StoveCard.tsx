"use client";

import { Dot } from "./parts";
import { cx } from "@/components/ui/cx";
import { CheckIcon, SwapIcon } from "@/components/ui/icons";
import { longDay } from "@/lib/domain/duty";
import { ru } from "@/lib/i18n/ru";
import type { DutyView } from "./useDuty";

const AVATAR_RING = { boxShadow: "0 0 0 4px var(--color-stove), 0 0 0 6px var(--color-stove-flame)" } as const;

/** The burner drawn behind the card (DutyMain.dc.html), token colours only. */
export function Burner({ className }: { className?: string }) {
  return (
    <svg width="230" height="230" viewBox="0 0 230 230" aria-hidden="true" focusable="false" className={className}>
      <circle cx="115" cy="115" r="108" fill="none" strokeWidth="2" className="stroke-stove-ring" />
      <circle cx="115" cy="115" r="86" className="fill-stove-disc" />
      <circle cx="115" cy="115" r="58" fill="none" strokeWidth="10" strokeDasharray="9 7" opacity="0.95" className="stroke-stove-flame" />
      <circle cx="115" cy="115" r="58" fill="none" strokeWidth="3" strokeDasharray="9 7" opacity="0.9" className="stroke-stove-flame-2" />
      <circle cx="115" cy="115" r="30" className="fill-stove-core" />
      <circle cx="115" cy="115" r="12" className="fill-stove-ring" />
      <path d="M28 115h22M180 115h22M115 28v22M115 180v22" strokeWidth="6" strokeLinecap="round" className="stroke-stove-ring" />
    </svg>
  );
}

const btn =
  "inline-flex h-10 items-center gap-[6px] rounded-[20px] px-4 text-[15px] font-semibold transition-[transform,opacity] duration-200 ease-smooth active:scale-[0.97] disabled:pointer-events-none disabled:opacity-60";

/** «Сегодня у плиты»: today's cook, tomorrow's, «Приготовил» and «Поменяться». */
export function StoveCard({
  view,
  busy,
  onDone,
  onSwap,
  onReplace,
}: {
  view: DutyView;
  busy: boolean;
  onDone: () => void;
  onSwap: () => void;
  onReplace: () => void;
}) {
  const { me, plan, today } = view;
  const row = plan.find((d) => d.day === today);
  const tomorrow = plan.find((d) => d.day > today);
  const cook = row?.user_id ?? null;
  const isMe = !!me && cook === me.id;
  const hasMyDay = !!me && plan.some((d) => d.day >= today && d.user_id === me.id && !d.request_id && !d.done);
  const tomorrowName = tomorrow ? (me && tomorrow.user_id === me.id ? null : view.nameOf(tomorrow.user_id)) : "";

  return (
    <section
      aria-label={ru.duty.stove.today(longDay(today))}
      data-testid="duty-stove"
      className="relative flex h-[196px] flex-col justify-between overflow-hidden rounded-[28px] bg-stove p-5 text-stove-text"
    >
      <Burner className="pointer-events-none absolute -top-5 -right-[54px]" />
      <div className="relative flex items-center gap-2 text-[13px] font-medium text-stove-muted">
        <span aria-hidden="true" className="size-2 rounded-full bg-stove-flame" />
        {ru.duty.stove.today(longDay(today))}
      </div>
      <div className="relative flex items-center gap-3">
        {cook ? <Dot name={view.nameOf(cook)} tone={view.toneOf(cook)} size={56} fontSize={22} className="font-bold" style={AVATAR_RING} /> : null}
        <div className="min-w-0">
          <div data-testid="duty-cook" className="text-[26px] leading-[1.1] font-bold tracking-[-0.5px]">
            {cook ? (isMe ? ru.duty.stove.you : ru.duty.stove.cooks(view.nameOf(cook))) : ru.duty.stove.nobody}
          </div>
          {tomorrow ? (
            <div className="mt-[3px] text-[14px] text-stove-muted">
              {tomorrowName === null ? ru.duty.stove.tomorrowYou : ru.duty.stove.tomorrow(tomorrowName)}
            </div>
          ) : null}
        </div>
      </div>
      <div className="relative flex gap-2">
        {isMe ? (
          row?.done ? (
            <span data-testid="duty-done-state" className={cx(btn, "bg-stove-ring")}>
              <CheckIcon size={16} strokeWidth={2.2} />
              {ru.duty.stove.doneAlready}
            </span>
          ) : (
            <button type="button" data-testid="duty-done" disabled={busy} onClick={onDone} className={cx(btn, "bg-stove-text text-stove")}>
              <CheckIcon size={16} strokeWidth={2.2} />
              {ru.duty.stove.done}
            </button>
          )
        ) : null}
        {hasMyDay ? (
          <button type="button" data-testid="duty-swap" onClick={onSwap} className={cx(btn, "bg-stove-ring text-stove-text")}>
            <SwapIcon size={16} strokeWidth={2} />
            {ru.duty.stove.swap}
          </button>
        ) : null}
        {view.isAdmin && cook && !row?.done && !isMe ? (
          <button type="button" data-testid="duty-replace" onClick={onReplace} className={cx(btn, "bg-stove-ring text-stove-text")}>
            {ru.duty.stove.replace}
          </button>
        ) : null}
      </div>
    </section>
  );
}
