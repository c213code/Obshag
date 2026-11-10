"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { ChevronRightIcon } from "@/components/ui/icons";
import { formatTenge } from "@/lib/format/money";
import { cx } from "@/components/ui/cx";
import { usePresenceList } from "@/lib/motion/presence";
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
  const outgoing = data?.outgoing;
  const memberOf = data?.memberOf;
  const rows = useMemo(
    () =>
      (outgoing ?? []).flatMap((s) => {
        const to = memberOf?.(s.to_id);
        return to ? [{ settlement: s, to }] : [];
      }),
    [outgoing, memberOf],
  );
  const entries = usePresenceList(rows, (r) => r.settlement.id, 400);
  if (!data || entries.length === 0) return null;

  return (
    <section aria-labelledby="waiting-title" data-testid="waiting-section" className="flex flex-col gap-3">
      <h2 id="waiting-title" className="text-headline">
        {ru.settle.waitingTitle}
      </h2>
      <ul className="flex flex-col gap-3">
        {entries.map(({ key, item: { settlement, to }, exiting, fresh }) => (
          <li key={key} className={cx("[--enter-y:-12px]", exiting ? "leave" : fresh && "enter")}>
              <Link
                href={`/settle/${to.user_id}`}
                prefetch={false}
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
          </li>
        ))}
      </ul>
    </section>
  );
}
