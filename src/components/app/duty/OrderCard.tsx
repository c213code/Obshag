import { memo } from "react";
import { Dot, RING } from "./parts";
import { nextDayOf, nextLabel } from "@/lib/domain/duty";
import type { DutyDay } from "@/lib/data/types";
import { ru } from "@/lib/i18n/ru";
import type { DutyView } from "./useDuty";

/** «Порядок»: everybody in rotation order with the next day of theirs. The cook of today wears the ring. */
export const OrderCard = memo(function OrderCard({ view, plan }: { view: DutyView; plan: ReadonlyArray<DutyDay> }) {
  const order = view.duty?.order ?? [];
  const todayCook = plan.find((d) => d.day === view.today)?.user_id;
  return (
    <section aria-labelledby="duty-order-h" className="rounded-[24px] bg-card p-4">
      <div className="flex items-baseline justify-between pb-3">
        <h2 id="duty-order-h" className="text-[17px] font-bold">
          {ru.duty.order.title}
        </h2>
        <span className="text-[13px] text-muted">{ru.duty.order.hint}</span>
      </div>
      <ul className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(Math.max(order.length, 1), 4)}, minmax(0, 1fr))` }}>
        {order.map((id) => (
          <li key={id} data-testid="order-person" className="flex flex-col items-center gap-[6px]">
            <Dot name={view.nameOf(id)} tone={view.toneOf(id)} size={44} fontSize={16} style={id === todayCook ? RING : undefined} />
            <span className="max-w-full truncate text-[12px] font-medium whitespace-nowrap">{view.nameOf(id)}</span>
            <span className="text-[11px] text-muted">{nextLabel(nextDayOf(plan, id, view.today), view.today)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
});
