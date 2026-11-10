"use client";

import Link from "next/link";
import { memo, useMemo } from "react";
import { BillIcon } from "../bills/BillIcon";
import { Money } from "@/components/ui/Money";
import { PillLink } from "@/components/ui/Pill";
import { cx } from "@/components/ui/cx";
import { isAccumulating } from "@/lib/domain/minTransfer";
import { almatyDay } from "@/lib/domain/almaty";
import { nextBill } from "@/lib/domain/nextBill";
import { spendingSummary } from "@/lib/domain/spending";
import type { Bill } from "@/lib/data/types";
import type { UiPurchase } from "@/lib/data/purchaseTracker";
import { formatTenge } from "@/lib/format/money";
import { ru } from "@/lib/i18n/ru";
import { useSettleData } from "../settle/useSettleData";

const tile = "flex flex-col rounded-md bg-card p-4";
const dateFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });

/** '5 дек' for a bill that falls due on `day` of `month` ('YYYY-MM'). */
function billDate(month: string, day: number): string {
  const [y, m] = month.split("-").map(Number);
  return dateFormat.format(new Date(y, m - 1, day)).replace(".", "");
}

/** Splits the per-person nets into what Kaspi can transfer (100 ₸ and up) and what only accumulates (1..99 ₸ per person). */
function useSplitNets(owed: number, owe: number) {
  const data = useSettleData();
  if (!data) return { owed, owe, accruing: 0 };
  let big = { owed: 0, owe: 0 };
  let accruing = 0;
  for (const c of data.net.counterparties) {
    if (isAccumulating(c.net)) accruing += c.net;
    else if (c.direction === "they_pay") big = { ...big, owed: big.owed + c.net };
    else big = { ...big, owe: big.owe + c.net };
  }
  return { ...big, accruing };
}

function OwedTile({ owed, owe }: { owed: number; owe: number }) {
  const split = useSplitNets(owed, owe);
  return (
    <section aria-label={ru.main.bento.owed} data-testid="bento-owed" className={cx(tile, "gap-1")}>
      <Link href="/settle" aria-label={`${ru.main.bento.settleAria} ${formatTenge(split.owed)}`} className="flex flex-col gap-1 active:opacity-70 transition-opacity duration-200">
        <span className="text-caption">{ru.main.bento.owed}</span>
        <Money value={split.owed} data-testid="bento-owed-amount" className="text-[24px] leading-[1.1] font-bold" />
        <span className="text-caption">{ru.main.bento.iOwe(formatTenge(split.owe))}</span>
        {split.accruing > 0 ? (
          <span data-testid="bento-accruing" className="text-caption">
            {ru.main.bento.accruing(formatTenge(split.accruing))}
          </span>
        ) : null}
      </Link>
      {split.owed > 0 ? (
        <Link href="/settle" className="mt-2 self-start text-label font-semibold text-lime">
          {ru.main.bento.remind}
        </Link>
      ) : null}
    </section>
  );
}

function BillTile({ bills, meId, today }: { bills: ReadonlyArray<Bill>; meId: string; today: { month: string; day: number } }) {
  const next = useMemo(() => nextBill(bills, today, meId), [bills, today, meId]);
  if (!next) {
    return (
      <section aria-label={ru.main.bento.monthly} data-testid="bento-bill" className={cx(tile, "row-span-2 justify-between gap-3")}>
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
    <section aria-label={ru.main.bento.monthly} data-testid="bento-bill" className={cx(tile, "row-span-2 justify-between gap-3")}>
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
      className={cx(tile, "gap-2")}
    >
      <span className="text-caption">{ru.main.bento.spending}</span>
      <span className="text-amount">{formatTenge(month)}</span>
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

/** The bento grid of Главная (2 columns, gap 10): Тебе должны, the next monthly bill (2 rows), Траты. */
export const Bento = memo(function Bento({
  owed,
  owe,
  bills,
  purchases,
  meId,
}: {
  owed: number;
  owe: number;
  bills: ReadonlyArray<Bill>;
  purchases: ReadonlyArray<UiPurchase>;
  meId: string;
}) {
  const today = useMemo(() => almatyDay(new Date()), []);
  return (
    <div className="grid grid-cols-2 gap-[10px]">
      <OwedTile owed={owed} owe={owe} />
      <BillTile bills={bills} meId={meId} today={today} />
      <SpendingTile purchases={purchases} meId={meId} />
    </div>
  );
});
