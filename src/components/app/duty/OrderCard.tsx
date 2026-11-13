"use client";

import { memo, useState } from "react";
import { Dot, RING } from "./parts";
import { MemberAwaySheet } from "@/components/app/flat/MemberAwaySheet";
import { formatAwayShort } from "@/components/app/flat/dates";
import { isAway } from "@/lib/domain/away";
import { nextDayOf, nextLabel } from "@/lib/domain/duty";
import type { DutyDay } from "@/lib/data/types";
import { ru } from "@/lib/i18n/ru";
import type { DutyView } from "./useDuty";

/**
 * «Порядок»: everybody in rotation order with the next day of theirs. The cook of today wears the ring.
 * Tapping a person opens «{Имя} в отъезде» (my own row opens it for me): their cooking days go to the next in the circle.
 */
export const OrderCard = memo(function OrderCard({ view, plan }: { view: DutyView; plan: ReadonlyArray<DutyDay> }) {
  const order = view.duty?.order ?? [];
  const todayCook = plan.find((d) => d.day === view.today)?.user_id;
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const picked = view.roster.find((m) => m.user_id === pickedId) ?? null;
  return (
    <section aria-labelledby="duty-order-h" className="rounded-[24px] bg-card p-4">
      <div className="flex items-baseline justify-between pb-3">
        <h2 id="duty-order-h" className="text-[17px] font-bold">
          {ru.duty.order.title}
        </h2>
        <span className="text-[13px] text-muted">{ru.duty.order.hint}</span>
      </div>
      <ul className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(Math.max(order.length, 1), 4)}, minmax(0, 1fr))` }}>
        {order.map((id) => {
          const away = view.roster.find((m) => m.user_id === id)?.away_until;
          const awayUntil = isAway(away, view.today) ? away : null;
          return (
            <li key={id} data-testid="order-person">
              <button
                type="button"
                aria-label={ru.flat.awayFor.title(view.nameOf(id))}
                onClick={() => {
                  setPickedId(id);
                  setOpen(true);
                }}
                className="flex w-full flex-col items-center gap-[6px] transition-transform duration-200 ease-smooth active:scale-[0.96]"
              >
                <Dot name={view.nameOf(id)} tone={view.toneOf(id)} size={44} fontSize={16} style={id === todayCook ? RING : undefined} />
                <span className="max-w-full truncate text-[12px] font-medium whitespace-nowrap">{view.nameOf(id)}</span>
                <span className="text-center text-[11px] text-muted">
                  {awayUntil ? ru.flat.awayFor.until(formatAwayShort(awayUntil)) : nextLabel(nextDayOf(plan, id, view.today), view.today)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <MemberAwaySheet
        member={picked ? { id: picked.user_id, name: picked.profile.display_name, away_until: picked.away_until } : null}
        open={open}
        onClose={() => setOpen(false)}
        onSaved={view.reload}
      />
    </section>
  );
});
