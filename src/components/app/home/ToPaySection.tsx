"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { PillLink } from "@/components/ui/Pill";
import { cx } from "@/components/ui/cx";
import { isTransferable } from "@/lib/domain/minTransfer";
import { formatTenge } from "@/lib/format/money";
import { usePresenceList } from "@/lib/motion/presence";
import { ru } from "@/lib/i18n/ru";
import { avatarColorFor } from "../avatars";
import { useAppData } from "../AppDataProvider";
import { useSettleData } from "../settle/useSettleData";

const MAX_WHAT = 2;

/**
 * «К оплате»: one row per person I owe a transferable net (100 ₸ and up), with a lime «Перевести» that opens their screen
 * (the Kaspi bar is there). A person I already marked a transfer to is not here: they wait in «Ждём подтверждения».
 * Renders nothing when there is nobody to pay.
 */
export function ToPaySection() {
  const data = useSettleData();
  const { me } = useAppData();
  const net = data?.net;
  const outgoing = data?.outgoing;
  const memberOf = data?.memberOf;
  const pairWith = data?.pairWith;
  const rows = useMemo(() => {
    if (!net || !memberOf || !pairWith) return [];
    const waiting = new Set((outgoing ?? []).map((s) => s.to_id));
    return net.counterparties.flatMap((c) => {
      const member = memberOf(c.userId);
      if (!member || !c.active || c.direction !== "i_pay" || !isTransferable(c.net) || waiting.has(c.userId)) return [];
      const what = pairWith(c.userId)
        .myItems.slice(0, MAX_WHAT)
        .map((i) => i.description)
        .join(", ");
      return [{ userId: c.userId, member, net: c.net, what }];
    });
  }, [net, outgoing, memberOf, pairWith]);
  const entries = usePresenceList(rows, (r) => r.userId, 400, (r) => `${r.userId}:${r.net}:${r.what}`);
  if (!data || !me || entries.length === 0) return null;

  return (
    <section aria-labelledby="to-pay-title" data-testid="to-pay-section" className="flex flex-col gap-3">
      <h2 id="to-pay-title" className="text-headline">
        {ru.main.toPay.title}
      </h2>
      <ul className="flex flex-col gap-3">
        {entries.map(({ key, item, exiting, fresh }) => {
          const name = item.member.profile.display_name;
          const amount = formatTenge(item.net);
          return (
            <li key={key} className={cx("[--enter-y:-12px]", exiting ? "leave" : fresh && "enter")}>
              <div data-testid="to-pay-row" className="flex items-center gap-[10px] rounded-pill border border-card-2 bg-card p-[6px]">
                <Link
                  href={`/settle/${item.userId}`}
                  prefetch={false}
                  className="flex min-w-0 flex-1 items-center gap-[10px] transition-transform duration-200 ease-smooth active:scale-[0.98]"
                >
                  <Avatar name={name} color={avatarColorFor(item.member.profile, me.id)} size={40} decorative />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[14px]">{name}</span>
                    <span className="truncate text-[12px] text-muted">{item.what ? `${amount} · ${item.what}` : amount}</span>
                  </div>
                </Link>
                <PillLink
                  href={`/settle/${item.userId}`}
                  prefetch={false}
                  variant="lime"
                  size="row"
                  aria-label={ru.main.toPay.rowAria(name, amount)}
                  data-testid="to-pay-go"
                >
                  {ru.main.toPay.transfer}
                </PillLink>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
