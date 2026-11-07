"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Bar } from "@/components/ui/Bar";
import { BottomActions } from "@/components/ui/BottomActions";
import { cx } from "@/components/ui/cx";
import { EmptyState } from "@/components/ui/EmptyState";
import { PillLink } from "@/components/ui/Pill";
import { BackIcon, ChevronRightIcon, PlusIcon } from "@/components/ui/icons";
import { almatyDay, shiftMonth } from "@/lib/domain/almaty";
import { billState, monthTotals } from "@/lib/domain/bills";
import { formatTenge } from "@/lib/format/money";
import { RepoError, type MemberWithProfile } from "@/lib/data/repo";
import type { UiPurchase } from "@/lib/data/purchaseTracker";
import type { Bill } from "@/lib/data/types";
import { useRepo } from "@/components/RepoProvider";
import { ru } from "@/lib/i18n/ru";
import { useAppActions, useAppData } from "../AppDataProvider";
import { Screen } from "../Screen";
import { AmountSheet } from "./AmountSheet";
import { BillCard } from "./BillCard";

const circle =
  "inline-flex size-[44px] shrink-0 items-center justify-center rounded-full bg-card-2 text-text transition-transform duration-200 ease-smooth active:scale-[0.94]";
const arrow =
  "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted transition-[transform,color] duration-200 ease-smooth active:scale-[0.94] disabled:opacity-40";

const NONE_MEMBERS: MemberWithProfile[] = [];
const NONE_BILLS: Bill[] = [];
const NONE_PURCHASES: UiPurchase[] = [];

function monthName(month: string, currentYear: string): string {
  const name = ru.months[Number(month.slice(5, 7)) - 1] ?? month;
  return month.slice(0, 4) === currentYear ? name : `${name} ${month.slice(0, 4)}`;
}

/** The Ежемесячно tab (Bills.dc.html): month pill, «Всего» / «Твоя доля», one card per bill, the add bar. */
export function MonthlyScreen() {
  const repo = useRepo();
  const { me, members, bills, purchases, activeId } = useAppData();
  const { refresh } = useAppActions();
  const today = useMemo(() => almatyDay(new Date()), []);
  const [month, setMonth] = useState(today.month);
  const [entering, setEntering] = useState<string | null>(null);

  const roster = (activeId && members[activeId]) || NONE_MEMBERS;
  const list = (activeId && bills[activeId]) || NONE_BILLS;
  const monthPurchases = (activeId && purchases[activeId]) || NONE_PURCHASES;
  const names = useMemo(() => new Map(roster.map((m) => [m.user_id, m.profile.display_name])), [roster]);
  const isAdmin = !!me && roster.some((m) => m.user_id === me.id && m.role === "admin");

  const totals = useMemo(
    () => (me ? monthTotals(list, month, monthPurchases, me.id, today) : { total: 0, mine: 0 }),
    [list, month, monthPurchases, me, today],
  );
  const states = useMemo(() => list.map((b) => ({ bill: b, state: billState(b, month, monthPurchases, today) })), [list, month, monthPurchases, today]);
  if (!me || !activeId) return null;

  const enteringBill = list.find((b) => b.id === entering) ?? null;
  const earliest = list.reduce<number | null>((min, b) => (min === null || b.day_of_month < min ? b.day_of_month : min), null);

  const submitAmount = async (amount: number): Promise<string | null> => {
    if (!enteringBill) return ru.bills.amountSheet.failed;
    try {
      await repo.setBillAmount(enteringBill.id, month, amount);
    } catch (e) {
      return e instanceof RepoError && e.code === "forbidden" ? ru.bills.amountSheet.forbidden : ru.bills.amountSheet.failed;
    }
    setEntering(null);
    await refresh({ silent: true });
    return null;
  };

  return (
    <>
      <Screen topOffset={54} gap={4} bottomRoom>
        <div className="flex items-center justify-between gap-2">
          <Bar className="min-w-0 pr-5">
            <Link href="/" aria-label={ru.bills.back} className={circle}>
              <BackIcon />
            </Link>
            <h1 className="truncate text-headline">{ru.bills.title}</h1>
          </Bar>
          <Bar role="group" aria-label={ru.bills.monthPill} className="shrink-0 !gap-0">
            <button type="button" aria-label={ru.bills.monthPrev} onClick={() => setMonth((m) => shiftMonth(m, -1))} className={arrow}>
              <BackIcon size={16} />
            </button>
            <span data-testid="month-pill" className="rounded-pill bg-card-2 px-3 py-[10px] text-[13px] font-semibold">
              {monthName(month, today.month.slice(0, 4))}
            </span>
            <button type="button" aria-label={ru.bills.monthNext} onClick={() => setMonth((m) => shiftMonth(m, 1))} className={arrow}>
              <ChevronRightIcon size={16} />
            </button>
          </Bar>
        </div>

        <Bar>
          <div className="flex flex-1 flex-col px-[14px] py-2">
            <span className="text-caption">{ru.bills.total}</span>
            <span data-testid="month-total" className="text-amount">
              {formatTenge(totals.total)}
            </span>
          </div>
          <div className="flex flex-1 flex-col rounded-pill bg-lime px-[18px] py-2 text-on-lime">
            <span className="text-label">{ru.bills.yourShare}</span>
            <span data-testid="month-mine" className="text-amount">
              {formatTenge(totals.mine)}
            </span>
          </div>
        </Bar>

        {states.length === 0 ? (
          <EmptyState
            testId="bills-empty"
            title={ru.bills.emptyTitle}
            text={isAdmin ? ru.bills.emptyText : ru.bills.emptyMember}
            action={
              isAdmin ? (
                <PillLink href="/monthly/new" variant="lime">
                  {ru.bills.add}
                </PillLink>
              ) : undefined
            }
          />
        ) : (
          <ul className="flex flex-col gap-4" aria-label={ru.bills.title}>
            {states.map(({ bill, state }) => (
              <BillCard
                key={bill.id}
                bill={bill}
                state={state}
                payerName={names.get(bill.payer_id) ?? ru.main.formerMember}
                editHref={isAdmin ? `/monthly/${bill.id}` : null}
                canEnter={isAdmin || bill.payer_id === me.id}
                onEnter={() => setEntering(bill.id)}
              />
            ))}
          </ul>
        )}
      </Screen>

      <BottomActions
        barClassName={cx("h-[58px] min-w-0 flex-1 !pl-5")}
        trailing={
          isAdmin ? (
            <Link
              href="/monthly/new"
              aria-label={ru.bills.add}
              className="inline-flex size-[58px] shrink-0 items-center justify-center rounded-full bg-lime text-on-lime transition-transform duration-200 ease-smooth active:scale-[0.94]"
            >
              <PlusIcon size={26} strokeWidth={2.4} />
            </Link>
          ) : null
        }
      >
        <span className="flex-1 truncate text-caption">{earliest === null ? ru.bills.hintEmpty : ru.bills.hint(earliest, roster.length)}</span>
      </BottomActions>

      <AmountSheet
        open={enteringBill !== null}
        title={enteringBill ? ru.bills.amountSheet.title(enteringBill.title, monthName(month, today.month.slice(0, 4))) : ""}
        onClose={() => setEntering(null)}
        onSubmit={submitAmount}
      />
    </>
  );
}
