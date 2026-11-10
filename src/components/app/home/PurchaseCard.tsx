import { memo } from "react";
import { Money } from "@/components/ui/Money";
import { cx } from "@/components/ui/cx";
import { almatyDay } from "@/lib/domain/almaty";
import { categoryFor } from "@/lib/domain/category";
import { purchaseProgress } from "@/lib/domain/summary";
import type { PurchaseWithShares } from "@/lib/data/repo";
import { ru } from "@/lib/i18n/ru";
import { useAppData } from "../AppDataProvider";
import { BillIcon } from "../bills/BillIcon";
import { CategoryTile } from "./CategoryTile";

const dateFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });

/** «сегодня» / «вчера» / «5 дек» by the Almaty calendar day. */
function dayLabel(iso: string, now: Date): string {
  const day = almatyDay(new Date(iso)).date;
  if (day === almatyDay(now).date) return ru.main.today;
  if (day === almatyDay(new Date(now.getTime() - 86_400_000)).date) return ru.main.yesterday;
  return dateFormat.format(new Date(iso)).replace(".", "");
}

/** One row of «Последние покупки»: category tile, title, "payer · день", amount and the «paid/total» chip. */
export const PurchaseCard = memo(function PurchaseCard({ purchase, payerName }: { purchase: PurchaseWithShares; payerName: string }) {
  const { paid, total } = purchaseProgress(purchase.payer_id, purchase.shares);
  const complete = total === 0 || paid === total;
  const { bills, activeId } = useAppData();
  const billIcon = purchase.bill_id && activeId ? (bills[activeId] ?? []).find((b) => b.id === purchase.bill_id)?.icon : undefined;
  return (
    <article className="flex items-center gap-3 bg-card px-4 py-3">
      {billIcon ? <BillIcon icon={billIcon} size={20} tile /> : <CategoryTile category={categoryFor(purchase)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <h3 className="truncate text-body font-medium">{purchase.description}</h3>
        <span className="truncate text-caption">
          {payerName} · {dayLabel(purchase.created_at, new Date())}
        </span>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Money value={purchase.amount} className="text-[17px] leading-[1.2] font-bold" />
        <span data-testid="purchase-chip" className={cx("rounded-pill px-2 py-[2px] text-[11px] leading-[1.3] font-semibold", complete ? "bg-lime-soft text-lime" : "bg-card-2 text-muted")}>
          {purchase.status === "personal" ? (
            ru.main.personal
          ) : total === 0 ? (
            ru.main.everyonePaid
          ) : (
            <>
              {ru.main.progress(paid, total)}
              <span className="sr-only"> {ru.main.progressSuffix}</span>
            </>
          )}
        </span>
      </div>
    </article>
  );
});
