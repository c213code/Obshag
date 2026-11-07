import { memo } from "react";
import { BasketIcon } from "@/components/ui/icons";
import { Money } from "@/components/ui/Money";
import { purchaseProgress } from "@/lib/domain/summary";
import type { PurchaseWithShares } from "@/lib/data/repo";
import { ru } from "@/lib/i18n/ru";

const timeFormat = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });

/** One recent purchase (Main.dc.html): tile icon, title, "Magnum · 18:40", amount, progress "N из M". */
export const PurchaseCard = memo(function PurchaseCard({ purchase, payerName }: { purchase: PurchaseWithShares; payerName: string }) {
  const { paid, total } = purchaseProgress(purchase.payer_id, purchase.shares);
  const ratio = total === 0 ? 1 : paid / total;
  const source = purchase.merchant ?? payerName;
  return (
    <article className="flex flex-col gap-3 rounded-md bg-card p-4">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="grid size-[44px] shrink-0 place-items-center rounded-sm bg-lime-soft text-lime">
          <BasketIcon size={20} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="truncate text-body">{purchase.description}</h3>
          <span className="truncate text-caption">
            {source} · {timeFormat.format(new Date(purchase.created_at))}
          </span>
        </div>
        <Money value={purchase.amount} className="text-amount" />
      </div>
      <div className="flex items-center gap-3">
        <div aria-hidden="true" className="h-[6px] flex-1 overflow-hidden rounded-[3px] bg-card-2">
          <div
            className="h-full origin-left bg-lime transition-transform duration-500 ease-smooth"
            style={{ transform: `scaleX(${ratio})` }}
          />
        </div>
        <span className="text-caption">
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
