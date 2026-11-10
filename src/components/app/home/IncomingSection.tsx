"use client";

import { cx } from "@/components/ui/cx";
import { usePresenceList } from "@/lib/motion/presence";
import { ru } from "@/lib/i18n/ru";
import { useAppActions } from "../AppDataProvider";
import { IncomingRow } from "../settle/IncomingRow";
import { useHeldIncoming } from "../settle/useHeldIncoming";
import { useSettleData, type Incoming } from "../settle/useSettleData";

/** «Подтверди оплату»: settlements people marked as paid to me. Renders nothing when there are none. */
export function IncomingSection() {
  const data = useSettleData();
  const { confirmReceived } = useAppActions();
  const { rows, hold, release } = useHeldIncoming(data?.incoming ?? []);
  const entries = usePresenceList(rows, (r) => r.settlement.id, 400, (r) => `${r.settlement.id}:${r.received}`);
  if (!data || entries.length === 0) return null;

  const onReceive = (row: Incoming) => {
    if (!hold(row)) return;
    // a refused confirmation takes the ✓ back: the row returns to «Получил» instead of pretending it worked
    void confirmReceived(row.settlement.id).then((ok) => {
      if (!ok) release(row.settlement.id);
    });
  };

  return (
    <section aria-labelledby="incoming-title" className="flex flex-col gap-3">
      <h2 id="incoming-title" className="text-headline">
        {ru.settle.incomingTitle}
      </h2>
      <ul className="flex flex-col gap-4">
        {entries.map(({ key, item: r, exiting, fresh }) => (
          <li key={key} className={cx("[--enter-y:-12px]", exiting ? "leave" : fresh && "enter")}>
            <IncomingRow row={r} meId={data.meId} received={r.received} onReceive={onReceive} />
          </li>
        ))}
      </ul>
    </section>
  );
}
