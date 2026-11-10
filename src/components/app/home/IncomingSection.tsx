"use client";

import { AnimatePresence, motion } from "motion/react";
import { ease, useReducedMotionSafe } from "@/lib/motion";
import { ru } from "@/lib/i18n/ru";
import { useAppActions } from "../AppDataProvider";
import { IncomingRow } from "../settle/IncomingRow";
import { useHeldIncoming } from "../settle/useHeldIncoming";
import { useSettleData, type Incoming } from "../settle/useSettleData";

/** «Подтверди оплату»: settlements people marked as paid to me. Renders nothing when there are none. */
export function IncomingSection() {
  const data = useSettleData();
  const { confirmReceived } = useAppActions();
  const { reduced } = useReducedMotionSafe();
  const { rows, hold, release } = useHeldIncoming(data?.incoming ?? []);
  if (!data || rows.length === 0) return null;

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
        <AnimatePresence initial={false}>
          {rows.map((r) => (
            <motion.li
              key={r.settlement.id}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease: ease.smooth }}
            >
              <IncomingRow row={r} meId={data.meId} received={r.received} onReceive={onReceive} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </section>
  );
}
