"use client";

import { memo, useMemo } from "react";
import { BillIcon } from "../bills/BillIcon";
import { PillLink } from "@/components/ui/Pill";
import { cx } from "@/components/ui/cx";
import { almatyDay } from "@/lib/domain/almaty";
import { nextBill } from "@/lib/domain/nextBill";
import { spendingSummary } from "@/lib/domain/spending";
import type { Bill } from "@/lib/data/types";
import type { UiPurchase } from "@/lib/data/purchaseTracker";
import { formatTenge } from "@/lib/format/money";
import { ru } from "@/lib/i18n/ru";

const tile = "flex flex-col rounded-md bg-card p-4";
const dateFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });

/** '5 дек' for a bill that falls due on `day` of `month` ('YYYY-MM'). */
function billDate(month: string, day: number): string {
  const [y, m] = month.split("-").map(Number);
  return dateFormat.format(new Date(y, m - 1, day)).replace(".", "");
}

function BillTile({ bills, meId, today }: { bills: ReadonlyArray<Bill>; meId: string; today: { month: string; day: number } }) {
  const next = useMemo(() => nextBill(bills, today, meId), [bills, today, meId]);
  if (!next) {
    return (
      <section aria-label={ru.main.bento.monthly} data-testid="bento-bill" className={cx(tile, "justify-between gap-3")}>
        <div className="flex flex-col gap-2">
          <span className="text-caption">{ru.main.bento.monthly}</span>
          <p className="text-body text-muted">{ru.main.bento.monthlyEmpty}</p>
        </div>
        <PillLink href="/monthly/new" variant="lime" size="md" className="w-full">
          {ru.main.bento.add}
        </PillLink>
      </section>
    );
  }
  return (
    <section aria-label={ru.main.bento.monthly} data-testid="bento-bill" className={cx(tile, "justify-between gap-3")}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-caption">{ru.main.bento.monthly}</span>
          <BillIcon icon={next.bill.icon} size={18} />
        </div>
        <div className="flex flex-col gap-1">
          <h3 className="text-headline break-words">{next.bill.title}</h3>
          <span className="font-rounded text-[28px] leading-[1.05] font-bold">{billDate(next.month, next.day)}</span>
          <span className="text-caption">{next.mine !== null ? ru.main.bento.share(formatTenge(next.mine)) : ru.main.bento.amountPending}</span>
        </div>
      </div>
      <PillLink href="/settle" variant="lime" size="md" className="w-full">
        {ru.main.bento.settle}
      </PillLink>
    </section>
  );
}

function SpendingTile({ purchases, meId }: { purchases: ReadonlyArray<UiPurchase>; meId: string }) {
  const { month, weeks } = useMemo(() => spendingSummary(purchases, meId, new Date()), [purchases, meId]);
  const max = Math.max(...weeks, 1);
  return (
    <section
      aria-label={ru.main.bento.spendingAria(formatTenge(month), weeks.map((w) => formatTenge(w)).join(", "))}
      data-testid="bento-spending"
      className={cx(tile, "justify-between gap-2")}
    >
      <div className="flex flex-col gap-2">
        <span className="text-caption">{ru.main.bento.spending}</span>
        <span className="text-amount">{formatTenge(month)}</span>
      </div>
      <div aria-hidden="true" className="mt-1 flex h-[40px] items-end gap-[5px]">
        {weeks.map((w, i) => (
          <span
            key={i}
            data-testid="spending-bar"
            data-current={i === weeks.length - 1}
            style={{ height: `${Math.max(12, (w / max) * 100)}%` }}
            className={cx("flex-1 rounded-[4px]", i === weeks.length - 1 ? "bg-lime" : "bg-card-2")}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * The bento grid of Главная (2 columns, gap 10): the next monthly bill and Траты, side by side. Slice 27: the money tile
 * is gone — the hero card carries the one number — so the two tiles share one row (no hole in the grid).
 */
export const Bento = memo(function Bento({
  bills,
  purchases,
  meId,
}: {
  bills: ReadonlyArray<Bill>;
  purchases: ReadonlyArray<UiPurchase>;
  meId: string;
}) {
  const today = useMemo(() => almatyDay(new Date()), []);
  return (
    <div className="grid grid-cols-2 gap-[10px]">
      <BillTile bills={bills} meId={meId} today={today} />
      <SpendingTile purchases={purchases} meId={meId} />
    </div>
  );
});
