"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { Avatar } from "@/components/ui/Avatar";
import { ChevronRightIcon } from "@/components/ui/icons";
import { formatTenge } from "@/lib/format/money";
import { ease, useReducedMotionSafe } from "@/lib/motion";
import { ru } from "@/lib/i18n/ru";
import { avatarColorFor } from "../avatars";
import { useSettleData } from "../settle/useSettleData";

/**
 * «Ждём подтверждения»: payments I marked as paid that the other person has not confirmed yet. Same section and
 * capsule language as «Подтверди оплату» (the reference #4 row), without the action: tapping opens the pair screen,
 * where «Отменить» lives. Renders nothing when there is nothing to wait for.
 */
export function WaitingSection() {
  const data = useSettleData();
  const { reduced } = useReducedMotionSafe();
  if (!data) return null;
  const rows = data.outgoing.flatMap((s) => {
    const to = data.memberOf(s.to_id);
    return to ? [{ settlement: s, to }] : [];
  });
  if (rows.length === 0) return null;

  return (
    <section aria-labelledby="waiting-title" data-testid="waiting-section" className="flex flex-col gap-3">
      <h2 id="waiting-title" className="text-headline">
        {ru.settle.waitingTitle}
      </h2>
      <ul className="flex flex-col gap-3">
        <AnimatePresence initial={false}>
          {rows.map(({ settlement, to }) => (
            <motion.li
              key={settlement.id}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease: ease.smooth }}
            >
              <Link
                href={`/settle/${to.user_id}`}
                data-testid="waiting-row"
                className="flex items-center gap-[10px] rounded-pill border border-card-2 bg-card p-[6px] transition-transform duration-200 ease-smooth active:scale-[0.98]"
              >
                <Avatar name={to.profile.display_name} color={avatarColorFor(to.profile, data.meId)} size={40} decorative />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[14px]">{to.profile.display_name}</span>
                  <span className="truncate text-[12px] text-muted">{ru.settle.waitingRow(formatTenge(settlement.amount))}</span>
                </div>
                <ChevronRightIcon size={20} className="mr-2 shrink-0 text-muted" />
              </Link>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </section>
  );
}
