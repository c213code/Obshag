"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRepo } from "@/components/RepoProvider";
import { cx } from "@/components/ui/cx";
import { EmptyState } from "@/components/ui/EmptyState";
import { PlusIcon, PotIcon, SlidersIcon } from "@/components/ui/icons";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { RepoError } from "@/lib/data/repo";
import { ru } from "@/lib/i18n/ru";
import { useAppActions } from "../AppDataProvider";
import { OrderSheet, ReplaceSheet } from "./AdminSheets";
import { CreateDuty } from "./CreateDuty";
import { OrderCard } from "./OrderCard";
import { PendingCards } from "./PendingCards";
import { StoveCard } from "./StoveCard";
import { SwapSheet } from "./SwapSheet";
import { MAIN_RANGE, useDuty } from "./useDuty";
import { WeekCard } from "./WeekCard";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const chip = "inline-flex h-9 items-center rounded-full border border-hairline bg-card px-[14px] text-[14px] font-medium text-muted transition-transform duration-200 ease-smooth active:scale-[0.97]";

/** The page column of the Очередь screens (DutyMain.dc.html: 16px sides, 14px between blocks). */
export function DutyColumn({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <main className={cx("mx-auto flex w-full max-w-[390px] flex-col gap-[14px] px-4 pt-[max(0px,calc(58px-env(safe-area-inset-top)))] pb-[156px]", className)}>
      {children}
    </main>
  );
}

function DutyBody() {
  const repo = useRepo();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { showNotice } = useAppActions();
  const view = useDuty(MAIN_RANGE);
  const [busy, setBusy] = useState(false);
  const [swapDay, setSwapDay] = useState<string | null>(null);
  const [swapOpen, setSwapOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [presetOther, setPresetOther] = useState<string | null>(null);

  // coming back from the calendar with a chosen day: ?swap=<my day>&other=<their day>
  const qMine = params.get("swap");
  const qOther = params.get("other");
  const incoming = view.status === "ready" && view.duty && qMine && qOther && ISO.test(qMine) && ISO.test(qOther) ? `${qMine}|${qOther}` : null;
  const [taken, setTaken] = useState<string | null>(null);
  if (incoming && incoming !== taken) {
    setTaken(incoming);
    setSwapDay(qMine);
    setPresetOther(qOther);
    setSwapOpen(true);
  }
  useEffect(() => {
    if (incoming) router.replace(pathname, { scroll: false });
  }, [incoming, router, pathname]);

  const myNext = useMemo(() => {
    const me = view.me;
    if (!me) return null;
    return view.plan.find((d) => d.day >= view.today && d.user_id === me.id && !d.request_id && !d.done)?.day ?? null;
  }, [view.plan, view.me, view.today]);

  const markDone = useCallback(async () => {
    if (!view.duty || busy) return;
    setBusy(true);
    try {
      await repo.markDutyDone(view.duty.id, view.today);
      await view.reload();
    } catch (e) {
      showNotice(e instanceof RepoError && e.code === "locked" ? ru.duty.stove.locked : ru.duty.stove.markFailed);
    } finally {
      setBusy(false);
    }
  }, [repo, view, busy, showNotice]);

  const openSwap = () => {
    setSwapDay(myNext);
    setPresetOther(null);
    setSwapOpen(true);
  };

  if (view.status === "loading") {
    return (
      <DutyColumn>
        <h1 className="text-[30px] leading-[1.15] font-bold tracking-[-0.6px]">{ru.duty.title}</h1>
        <SkeletonCard />
      </DutyColumn>
    );
  }
  if (view.status === "error") {
    return (
      <DutyColumn>
        <h1 className="text-[30px] leading-[1.15] font-bold tracking-[-0.6px]">{ru.duty.title}</h1>
        <p role="alert" className="text-body text-orange">
          {ru.duty.loadFailed}
        </p>
      </DutyColumn>
    );
  }

  const soon = () => showNotice(ru.duty.soonNotice);

  return (
    <DutyColumn>
      <div className="flex items-center justify-between">
        <h1 className="text-[30px] leading-[1.15] font-bold tracking-[-0.6px]">{ru.duty.title}</h1>
        {view.isAdmin && view.duty ? (
          <button
            type="button"
            aria-label={ru.duty.settings}
            data-testid="duty-settings"
            onClick={() => setOrderOpen(true)}
            className="inline-flex size-10 items-center justify-center rounded-full bg-card text-text transition-transform duration-200 ease-smooth active:scale-[0.94]"
          >
            <SlidersIcon size={20} />
          </button>
        ) : null}
      </div>

      {view.duty ? (
        <>
          <div className="flex gap-2">
            <span aria-current="true" className="inline-flex h-9 items-center gap-[6px] rounded-full bg-text pr-[14px] pl-[10px] text-[14px] font-semibold text-bg">
              <PotIcon size={18} />
              {ru.duty.chips.cooking}
            </span>
            <button type="button" className={chip} onClick={soon}>
              {ru.duty.chips.trash}
            </button>
            <button type="button" className={chip} onClick={soon}>
              {ru.duty.chips.water}
            </button>
            <button
              type="button"
              aria-label={ru.duty.chips.add}
              onClick={soon}
              className="inline-flex size-9 items-center justify-center rounded-full border border-dashed border-outline text-muted transition-transform duration-200 ease-smooth active:scale-[0.97]"
            >
              <PlusIcon size={16} strokeWidth={2} />
            </button>
          </div>
          <StoveCard view={view} busy={busy} onDone={markDone} onSwap={openSwap} onReplace={() => setReplaceOpen(true)} />
          <PendingCards view={view} />
          <WeekCard view={view} plan={view.plan} />
          <OrderCard view={view} plan={view.plan} />
          <SwapSheet open={swapOpen} onClose={() => setSwapOpen(false)} view={view} myDay={swapDay} presetOther={presetOther} />
          {view.isAdmin ? <OrderSheet open={orderOpen} onClose={() => setOrderOpen(false)} view={view} /> : null}
          {view.isAdmin ? <ReplaceSheet open={replaceOpen} onClose={() => setReplaceOpen(false)} view={view} /> : null}
        </>
      ) : view.isAdmin ? (
        <CreateDuty view={view} />
      ) : (
        <EmptyState testId="duty-empty" title={ru.duty.empty.member} text={ru.duty.empty.memberText} />
      )}
    </DutyColumn>
  );
}

/** Очередь (DutyMain.dc.html). */
export function DutyScreen() {
  return (
    <Suspense fallback={null}>
      <DutyBody />
    </Suspense>
  );
}
