"use client";

import Link from "next/link";
import { Burner } from "../duty/StoveCard";
import { Dot } from "../duty/parts";
import { useDuty } from "../duty/useDuty";
import { addDays } from "@/lib/domain/duty";
import { ru } from "@/lib/i18n/ru";

const RANGE = { from: (t: string) => t, to: (t: string) => addDays(t, 1) };

/** «Сегодня у плиты»: the dark stove tile on Главная. Hidden while loading and when the household has no duty. */
export function DutyTile() {
  const view = useDuty(RANGE);
  if (view.status !== "ready" || !view.duty) return null;
  const row = view.plan.find((d) => d.day === view.today);
  if (!row) return null;
  const tomorrow = view.plan.find((d) => d.day > view.today);
  const isMe = row.user_id === view.me?.id;
  const next = tomorrow ? (tomorrow.user_id === view.me?.id ? ru.duty.stove.tomorrowYou : ru.duty.tile.tomorrow(view.nameOf(tomorrow.user_id))) : null;
  return (
    <Link
      href="/duty"
      data-testid="home-duty-tile"
      className="relative flex min-h-[96px] items-center gap-3 overflow-hidden rounded-md bg-stove p-4 text-stove-text transition-transform duration-200 ease-smooth active:scale-[0.99]"
    >
      <Burner className="pointer-events-none absolute -top-[70px] -right-[70px] size-[190px] opacity-80" />
      <Dot name={view.nameOf(row.user_id)} tone={view.toneOf(row.user_id)} size={48} fontSize={19} style={{ boxShadow: "0 0 0 3px var(--color-stove), 0 0 0 5px var(--color-stove-flame)" }} />
      <div className="relative min-w-0">
        <div className="flex items-center gap-2 text-[12px] font-medium text-stove-muted">
          <span aria-hidden="true" className="size-[7px] rounded-full bg-stove-flame" />
          {ru.duty.tile.label}
        </div>
        <div data-testid="home-duty-cook" className="truncate text-[20px] leading-[1.15] font-bold tracking-[-0.3px]">
          {isMe ? ru.duty.tile.you : ru.duty.stove.cooks(view.nameOf(row.user_id))}
        </div>
        {next ? <div className="text-[13px] text-stove-muted">{next}</div> : null}
      </div>
    </Link>
  );
}
