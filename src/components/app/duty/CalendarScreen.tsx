"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cx } from "@/components/ui/cx";
import { BackIcon, ChevronRightIcon } from "@/components/ui/icons";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { almatyDay, shiftMonth } from "@/lib/domain/almaty";
import { buildMonth, daysInMonth, DOW_CAP, longDay, monthStats, monthTitle, MONTHS_NOM, type DayCell } from "@/lib/domain/duty";
import { ru } from "@/lib/i18n/ru";
import { DutyColumn } from "./DutyScreen";
import { AwayDot, Dot, SwapBadge, Tick } from "./parts";
import { useDuty, type DutyView } from "./useDuty";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const navBtn = "inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-card text-text transition-transform duration-200 ease-smooth active:scale-[0.94]";

function MonthCell({ c, view, pick, onPick }: { c: DayCell; view: DutyView; pick: boolean; onPick: (day: string) => void }) {
  const today = c.kind === "today";
  const past = c.kind === "past";
  const who = c.user_id ? view.nameOf(c.user_id) : "";
  const canPick = pick && !!c.user_id && c.user_id !== view.me?.id && c.kind !== "past" && !c.pending;
  const inner = (
    <>
      <span className={cx("text-[13px]", today ? "font-bold text-lime-ink" : past ? "font-medium text-faint" : "font-medium text-text")}>{c.dom}</span>
      {c.skipped_user && c.user_id ? (
        <AwayDot size={26} coverName={who} coverTone={view.toneOf(c.user_id)} />
      ) : c.user_id ? (
        <Dot name={who} tone={view.toneOf(c.user_id)} size={26} fontSize={11} faded={past || c.done}>
          {c.done ? <Tick size={16} /> : null}
          {c.swapped ? <SwapBadge size={14} /> : null}
        </Dot>
      ) : null}
    </>
  );
  const cls = cx(
    "flex h-[62px] flex-col items-center justify-center gap-1 rounded-[14px]",
    today && "bg-lime-soft shadow-[inset_0_0_0_2px_var(--color-lime)]",
    pick && !canPick && "opacity-40",
    canPick && "transition-transform duration-200 ease-smooth active:scale-[0.95]",
  );
  const label = c.user_id ? ru.duty.calendar.dayLabel(longDay(c.date), c.skipped_user ? ru.duty.calendar.away(view.nameOf(c.skipped_user)) : who) : longDay(c.date);
  const data = { "data-testid": "month-cell", "data-day": c.date, "data-user": c.user_id ?? "", "data-done": c.done, "data-swapped": c.swapped } as const;
  return canPick ? (
    <button type="button" aria-label={label} onClick={() => onPick(c.date)} className={cls} {...data}>
      {inner}
    </button>
  ) : (
    <div role="group" aria-label={label} className={cls} {...data}>
      {inner}
    </div>
  );
}

function CalendarBody() {
  const router = useRouter();
  const params = useSearchParams();
  const swapParam = params.get("swap");
  const swapMine = swapParam && ISO.test(swapParam) ? swapParam : null;
  const [month, setMonth] = useState(() => almatyDay(new Date()).month);
  const view = useDuty({ from: `${month}-01`, to: `${month}-${String(daysInMonth(month)).padStart(2, "0")}` });
  const grid = useMemo(() => buildMonth(view.plan, month, view.today), [view.plan, month, view.today]);
  const stats = useMemo(() => monthStats(view.plan, month, view.duty?.order ?? []), [view.plan, month, view.duty]);
  const monthName = MONTHS_NOM[Number(month.slice(5, 7)) - 1];
  const backHref = "/duty";

  if (view.status === "loading") {
    return (
      <DutyColumn>
        <SkeletonCard />
      </DutyColumn>
    );
  }
  if (view.status === "error" || !view.duty) {
    return (
      <DutyColumn>
        <Link href={backHref} aria-label={ru.duty.calendar.back} className={navBtn}>
          <BackIcon size={20} />
        </Link>
        <p role="alert" className="text-body text-orange">
          {view.status === "error" ? ru.duty.loadFailed : ru.duty.empty.member}
        </p>
      </DutyColumn>
    );
  }

  const pickDay = (day: string) => swapMine && router.push(`/duty?swap=${swapMine}&other=${day}`);
  const order = view.duty.order;

  return (
    <DutyColumn className="!pb-10">
      <div className="flex items-center gap-[10px]">
        <Link href={swapMine ? "/duty" : backHref} aria-label={ru.duty.calendar.back} className={cx(navBtn, "!size-10")}>
          <BackIcon size={20} strokeWidth={2} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-muted">{view.duty.title}</div>
          <h1 data-testid="calendar-title" className="text-[24px] leading-[1.2] font-bold tracking-[-0.4px]">
            {monthTitle(month)}
          </h1>
        </div>
        <button type="button" aria-label={ru.duty.calendar.prev} data-testid="calendar-prev" onClick={() => setMonth((m) => shiftMonth(m, -1))} className={navBtn}>
          <BackIcon size={18} strokeWidth={2} />
        </button>
        <button type="button" aria-label={ru.duty.calendar.next} data-testid="calendar-next" onClick={() => setMonth((m) => shiftMonth(m, 1))} className={navBtn}>
          <ChevronRightIcon size={18} strokeWidth={2} />
        </button>
      </div>

      {swapMine ? (
        <div role="status" data-testid="calendar-pick" className="flex items-center gap-3 rounded-[20px] bg-lime-soft p-3">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold">{ru.duty.swap.pickHint}</div>
            <div className="text-[13px] text-muted">{ru.duty.swap.pickText(longDay(swapMine))}</div>
          </div>
          <Link href="/duty" className="rounded-full bg-card px-3 py-2 text-[13px] font-semibold">
            {ru.duty.swap.pickCancel}
          </Link>
        </div>
      ) : null}

      <section aria-label={monthTitle(month)} className="rounded-[24px] bg-card px-[10px] pt-3 pb-[10px]">
        <div className="grid grid-cols-7 pb-[6px] text-center text-[11px] font-semibold text-muted" aria-hidden="true">
          {DOW_CAP.map((d, i) => (
            <span key={d} className={i >= 5 ? "text-lime" : undefined}>
              {d}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-1" data-testid="month-grid">
          {Array.from({ length: grid.lead }, (_, i) => (
            <div key={`b${i}`} aria-hidden="true" className="h-[62px]" />
          ))}
          {grid.cells.map((c) => (
            <MonthCell key={c.date} c={c} view={view} pick={!!swapMine} onPick={pickDay} />
          ))}
        </div>
      </section>

      <div className="flex flex-wrap gap-x-[14px] gap-y-[6px] px-1 text-[12px] text-muted" data-testid="calendar-legend">
        {order.map((id) => (
          <span key={id} className="flex items-center gap-[5px]">
            <Dot name="" tone={view.toneOf(id)} size={10} />
            {id === view.me?.id ? ru.duty.calendar.you : view.nameOf(id)}
          </span>
        ))}
        <span>{ru.duty.calendar.legendDone}</span>
      </div>

      <section aria-labelledby="duty-stats-h" className="rounded-[24px] bg-card px-4 py-[14px]">
        <div className="flex items-baseline justify-between pb-[6px]">
          <h2 id="duty-stats-h" className="text-[17px] font-bold">
            {ru.duty.calendar.stats(monthName.toLowerCase())}
          </h2>
          <span className="text-[13px] text-muted">{ru.duty.calendar.statsHint}</span>
        </div>
        <ul>
          {stats.map((s, i) => (
            <li key={s.user_id} data-testid="stat-row" data-user={s.user_id} className={cx("flex items-center gap-[10px] py-[7px]", i > 0 && "border-t border-hairline")}>
              <Dot name={view.nameOf(s.user_id)} tone={view.toneOf(s.user_id)} size={28} fontSize={12} />
              <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{s.user_id === view.me?.id ? ru.duty.calendar.you : view.nameOf(s.user_id)}</span>
              <span aria-hidden="true" className="flex h-[6px] w-[84px] overflow-hidden rounded-[3px] bg-card-2">
                <span className="h-full rounded-[3px] bg-lime" style={{ width: `${s.total ? Math.round((s.done / s.total) * 100) : 0}%` }} />
              </span>
              <span data-testid="stat-count" className="w-11 text-right text-[14px] font-semibold">
                {s.done}/{s.total}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </DutyColumn>
  );
}

/** /duty/calendar (DutyCalendar.dc.html); with ?swap=<day> it is the picker of the swap sheet's «Другой день». */
export function CalendarScreen() {
  return (
    <Suspense fallback={null}>
      <CalendarBody />
    </Suspense>
  );
}
