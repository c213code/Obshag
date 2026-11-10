import Link from "next/link";
import { memo } from "react";
import { cx } from "@/components/ui/cx";
import { buildWeek, DOW_SHORT, MONTHS_NOM, type DayCell } from "@/lib/domain/duty";
import type { DutyDay } from "@/lib/data/types";
import { ru } from "@/lib/i18n/ru";
import { AwayDot, Dot, RING, SwapBadge, Tick } from "./parts";
import type { DutyView } from "./useDuty";

function Cell({ c, view }: { c: DayCell; view: DutyView }) {
  const today = c.kind === "today";
  const past = c.kind === "past";
  const who = c.user_id ? view.nameOf(c.user_id) : "";
  const label = c.user_id ? `${DOW_SHORT[c.dow]}, ${c.dom}: ${who}` : `${DOW_SHORT[c.dow]}, ${c.dom}`;
  const labelTone = today ? "text-lime-ink" : past ? "text-faint" : "text-muted";
  return (
    <li
      aria-label={label}
      data-testid="week-cell"
      data-day={c.date}
      data-user={c.user_id ?? ""}
      data-done={c.done}
      data-swapped={c.swapped}
      className={cx("flex flex-col items-center gap-[6px] rounded-[16px] py-2", today && "bg-lime-soft")}
    >
      <span className={cx("text-[11px] font-semibold", labelTone)}>{DOW_SHORT[c.dow]}</span>
      {c.skipped_user && c.user_id ? (
        <AwayDot size={36} coverName={who} coverTone={view.toneOf(c.user_id)} big />
      ) : c.user_id ? (
        <Dot name={who} tone={view.toneOf(c.user_id)} size={36} fontSize={14} faded={past || c.done} style={today ? RING : undefined}>
          {c.done ? <Tick size={20} /> : null}
          {c.swapped ? <SwapBadge size={18} onSurface /> : null}
        </Dot>
      ) : (
        <Dot name="" tone="blue" size={36} empty />
      )}
      <span className={cx("text-[12px] font-semibold", labelTone)}>{c.dom}</span>
    </li>
  );
}

/** «Эта неделя»: seven cells Mon..Sun, a tick over a faded letter for a cooked day, a ring on today, ⇄ on swapped days. */
export const WeekCard = memo(function WeekCard({ view, plan }: { view: DutyView; plan: ReadonlyArray<DutyDay> }) {
  const cells = buildWeek(plan, view.today);
  const month = MONTHS_NOM[Number(view.today.slice(5, 7)) - 1];
  return (
    <section aria-labelledby="duty-week-h" className="rounded-[24px] bg-card px-[14px] pt-4 pb-[14px]">
      <div className="flex items-baseline justify-between px-[2px] pb-3">
        <h2 id="duty-week-h" className="text-[17px] font-bold">
          {ru.duty.week.title}
        </h2>
        <Link href="/duty/calendar" data-testid="duty-calendar-link" className="text-[14px] font-medium text-lime">
          {month}
        </Link>
      </div>
      <ul className="grid grid-cols-7 gap-1 text-center">
        {cells.map((c) => (
          <Cell key={c.date} c={c} view={view} />
        ))}
      </ul>
    </section>
  );
});
