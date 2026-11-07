import Link from "next/link";
import { memo } from "react";
import { cx } from "@/components/ui/cx";
import type { BillState } from "@/lib/domain/bills";
import type { Bill } from "@/lib/data/types";
import { formatNumber } from "@/lib/format/money";
import { ru } from "@/lib/i18n/ru";
import { BillIcon } from "./BillIcon";

/** One bill of the month (Bills.dc.html .bill): icon, «N числа · платит X», amount and the month's progress. */
export const BillCard = memo(function BillCard({
  bill,
  state,
  payerName,
  editHref,
  canEnter,
  onEnter,
}: {
  bill: Bill;
  state: BillState;
  payerName: string;
  /** Admins open the bill form from the card. */
  editHref: string | null;
  /** The payer or an admin may enter the amount of a variable bill. */
  canEnter: boolean;
  onEnter: () => void;
}) {
  const needs = state.kind === "needs_amount";
  const amount = state.kind === "generated" ? state.amount : state.kind === "idle" ? state.amount : null;
  const caption = needs ? ru.bills.needsAmount : `${ru.bills.day(bill.day_of_month)} · ${ru.bills.payer(payerName)}`;

  const head = (
    <>
      <BillIcon icon={bill.icon} alert={needs} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-headline">{bill.title}</span>
        <span className={cx("truncate text-caption", needs && "!text-orange")}>{caption}</span>
      </div>
    </>
  );
  const rowClass = "flex min-w-0 flex-1 items-center gap-3";

  return (
    <li
      data-testid="bill-card"
      className={cx("flex flex-col gap-3 rounded-lg border bg-card p-4", needs ? "border-wait-line" : "border-hairline")}
    >
      <div className="flex items-center gap-3">
        {editHref ? (
          <Link href={editHref} className={cx(rowClass, "transition-transform duration-200 ease-smooth active:scale-[0.98]")}>
            {head}
          </Link>
        ) : (
          <div className={rowClass}>{head}</div>
        )}
        {needs ? (
          canEnter ? (
            <button
              type="button"
              onClick={onEnter}
              className="h-9 shrink-0 rounded-pill bg-orange px-4 text-[13px] font-semibold text-on-orange transition-transform duration-200 ease-smooth active:scale-[0.97]"
            >
              {ru.bills.enter}
            </button>
          ) : null
        ) : (
          <span className={cx("text-amount", amount === null && "text-muted")}>{amount === null ? "—" : formatNumber(amount)}</span>
        )}
      </div>
      {state.kind === "generated" ? <Progress settled={state.settled} total={state.total} /> : null}
    </li>
  );
});

function Progress({ settled, total }: { settled: number; total: number }) {
  const done = total > 0 && settled >= total;
  const ratio = total > 0 ? Math.min(1, settled / total) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="h-[6px] flex-1 overflow-hidden rounded-[3px] bg-card-2" role="presentation">
        <div className="h-full w-full origin-left bg-lime transition-transform duration-500 ease-smooth" style={{ transform: `scaleX(${ratio})` }} />
      </div>
      <span className={cx("text-label", done ? "text-lime" : "text-muted")}>{done ? ru.bills.allPaid : ru.bills.progress(settled, total)}</span>
    </div>
  );
}
