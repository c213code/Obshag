"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRepo } from "@/components/RepoProvider";
import { cx } from "@/components/ui/cx";
import { ArrowRightIcon, CheckIcon, ClockIcon, CloseIcon, PotIcon, CalendarIcon } from "@/components/ui/icons";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { RepoError } from "@/lib/data/repo";
import type { SwapRequest } from "@/lib/data/types";
import { DOW_FULL, addDays, dayOfMonth, effectiveStatus, isoDow, longDay, shortDay, timeLeft } from "@/lib/domain/duty";
import { ru } from "@/lib/i18n/ru";
import { useAppActions } from "../AppDataProvider";
import { Dot, RING_BG } from "./parts";
import { useNotifyDuty, useDuty, useNow, type DutyView } from "./useDuty";

const REQUEST_RANGE = { from: (t: string) => t, to: (t: string) => addDays(t, 28) };

/** One calendar card of the request: weekday header, big date, who had it (faded) -> who has it. */
function DayCard({ day, from, to, header, tilt, view }: { day: string; from: string; to: string; header: "accent" | "dark"; tilt: string; view: DutyView }) {
  const label = (id: string) => (id === view.me?.id ? ru.duty.request.you : undefined);
  return (
    <div className={cx("w-32 overflow-hidden rounded-[22px] bg-card shadow-[0_10px_30px_rgb(0_0_0/0.10)]", tilt)} data-testid="request-day-card">
      <div className={cx("flex h-[30px] items-center justify-center text-[12px] font-bold tracking-[1px]", header === "accent" ? "bg-lime text-on-lime" : "bg-stove text-stove-text")}>
        {DOW_FULL[isoDow(day)].toUpperCase()}
      </div>
      <div className="flex flex-col items-center gap-2 pt-[10px] pb-[14px]">
        <span className="text-[44px] leading-none font-extrabold tracking-[-1.5px]">{dayOfMonth(day)}</span>
        <div className="flex items-center gap-[6px]">
          <Dot name={view.nameOf(from)} tone={view.toneOf(from)} size={26} fontSize={11} className="opacity-35" label={label(from)} />
          <ArrowRightIcon size={12} className="text-faint" strokeWidth={2.4} />
          <Dot name={view.nameOf(to)} tone={view.toneOf(to)} size={30} fontSize={12} label={label(to)} />
        </div>
      </div>
    </div>
  );
}

function Countdown({ req, nowMs }: { req: SwapRequest; nowMs: number }) {
  const left = timeLeft(req.expires_at, nowMs);
  if (!left) return null;
  const text = left.unit === "m" ? ru.duty.request.leftMinutes(left.n) : left.unit === "h" ? ru.duty.request.leftHours(left.n) : ru.duty.request.leftDays(left.n);
  const first = req.from_day < req.to_day ? req.from_day : req.to_day;
  return (
    <span data-testid="request-countdown" className="inline-flex h-8 items-center gap-[6px] rounded-full bg-orange-soft px-3 text-[13px] font-semibold text-orange">
      <ClockIcon size={14} strokeWidth={2.2} />
      {text} · {ru.duty.request.until(`${shortDay(first).split(",")[0]} 10:00`)}
    </span>
  );
}

function Result({ req, view }: { req: SwapRequest; view: DutyView }) {
  const status = req.status;
  const title = status === "accepted" ? ru.duty.request.resultAccepted : status === "declined" ? ru.duty.request.resultDeclined : status === "cancelled" ? ru.duty.request.resultCancelled : ru.duty.request.resultExpired;
  const text =
    status === "accepted" ? ru.duty.request.resultAcceptedText(longDay(req.from_day), longDay(req.to_day))
    : status === "declined" ? ru.duty.request.resultDeclinedText
    : status === "cancelled" ? ru.duty.request.resultCancelledText
    : ru.duty.request.resultExpiredText;
  void view;
  return (
    <div data-testid="request-result" data-status={status} className="mt-8 flex flex-col items-center gap-2 text-center">
      <span className={cx("inline-flex size-14 items-center justify-center rounded-full", status === "accepted" ? "bg-lime text-on-lime" : "bg-card-2 text-muted")}>
        {status === "accepted" ? <CheckIcon size={26} strokeWidth={2.6} /> : <CloseIcon size={22} strokeWidth={2.4} />}
      </span>
      <h2 className="text-[22px] font-bold">{title}</h2>
      <p className="max-w-[280px] text-body text-muted">{text}</p>
    </div>
  );
}

/** /duty/request/[id] (DutyRequest.dc.html): the counterparty answers; the requester sees the state and can cancel. */
export function RequestScreen({ id }: { id: string }) {
  const repo = useRepo();
  const notify = useNotifyDuty();
  const { showNotice } = useAppActions();
  const view = useDuty(REQUEST_RANGE);
  const [req, setReq] = useState<SwapRequest | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nowMs = useNow();

  useEffect(() => {
    let alive = true;
    repo
      .getSwapRequest(id)
      .then((r) => alive && setReq(r))
      .catch(() => alive && setMissing(true));
    return () => {
      alive = false;
    };
  }, [repo, id]);

  const answer = useCallback(
    async (accept: boolean) => {
      if (!req || busy) return;
      setBusy(true);
      setError(null);
      try {
        const next = await repo.respondSwap(req.id, accept);
        setReq(next);
        if (next.status === "declined") void notify(next.id, "declined");
        if (next.status === "accepted") showNotice(ru.duty.request.resultAccepted);
        await view.reload();
      } catch (e) {
        setError(e instanceof RepoError && e.code === "stale" ? ru.duty.request.stale : ru.duty.request.acceptFailed);
      } finally {
        setBusy(false);
      }
    },
    [req, busy, repo, notify, showNotice, view],
  );

  const cancel = useCallback(async () => {
    if (!req || busy) return;
    setBusy(true);
    try {
      setReq(await repo.cancelSwap(req.id));
      await view.reload();
    } catch {
      setError(ru.duty.pendingOut.cancelFailed);
    } finally {
      setBusy(false);
    }
  }, [req, busy, repo, view]);

  const frame = (children: React.ReactNode) => (
    <main className="mx-auto flex min-h-dvh w-full max-w-[390px] flex-col px-5 pt-[max(0px,calc(58px-env(safe-area-inset-top)))] pb-7">{children}</main>
  );

  if (missing || (view.status === "ready" && req && view.duty && view.duty.id !== req.duty_id)) {
    return frame(
      <>
        <p role="alert" data-testid="request-missing" className="text-body text-orange">
          {ru.duty.request.notFound}
        </p>
        <Link href="/duty" className="mt-4 self-start rounded-full bg-card px-4 py-3 text-[15px] font-semibold">
          {ru.duty.request.backToDuty}
        </Link>
      </>,
    );
  }
  if (!req || view.status !== "ready" || !view.me) {
    return frame(<SkeletonCard />);
  }

  const me = view.me.id;
  const status = effectiveStatus(req, nowMs);
  const shown: SwapRequest = status === req.status ? req : { ...req, status };
  const mine = req.from_user === me;
  const other = mine ? req.to_user : req.from_user;
  const pending = status === "pending";
  const myNextDay = view.plan.find((d) => d.user_id === me && d.day >= view.today && d.day !== req.to_day && d.day !== req.from_day)?.day;

  return frame(
    <>
      <div className="flex items-center justify-between">
        <Link href="/duty" aria-label={ru.duty.request.close} className="inline-flex size-10 items-center justify-center rounded-full bg-card text-text transition-transform duration-200 ease-smooth active:scale-[0.94]">
          <CloseIcon size={18} strokeWidth={2.2} />
        </Link>
        {pending ? <Countdown req={req} nowMs={nowMs} /> : null}
      </div>

      <div className="mt-[26px] flex flex-col items-center text-center">
        <Dot name={view.nameOf(req.from_user)} tone={view.toneOf(req.from_user)} size={64} fontSize={24} className="font-extrabold" style={RING_BG} />
        <h1 data-testid="request-title" className="mt-4 text-[26px] leading-[1.15] font-extrabold tracking-[-0.6px]">
          {mine ? ru.duty.request.mineTitle(view.nameOf(req.to_user)) : ru.duty.request.asks(view.nameOf(req.from_user))}
        </h1>
        {req.reason ? (
          <div data-testid="request-reason" className="mt-3 max-w-[290px] rounded-[18px_18px_18px_6px] bg-card px-[14px] py-[10px] text-left text-[15px] leading-[1.4] shadow-[0_1px_2px_rgb(0_0_0/0.06)]">
            «{req.reason}»
          </div>
        ) : null}
      </div>

      <div className="relative mt-[30px] flex items-center justify-center gap-[46px]">
        <DayCard day={req.from_day} from={req.from_user} to={req.to_user} header="accent" tilt="-rotate-[4deg]" view={view} />
        <svg width="70" height="90" viewBox="0 0 70 90" aria-hidden="true" focusable="false" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <path d="M10 30 C 25 8, 45 8, 60 30" fill="none" strokeWidth="3" strokeLinecap="round" className="stroke-lime" />
          <path d="M52 24 L60 30 L62 20" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="stroke-lime" />
          <path d="M60 60 C 45 82, 25 82, 10 60" fill="none" strokeWidth="3" strokeLinecap="round" className="stroke-orange" />
          <path d="M18 66 L10 60 L8 70" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="stroke-orange" />
        </svg>
        <DayCard day={req.to_day} from={req.to_user} to={req.from_user} header="dark" tilt="rotate-[4deg]" view={view} />
      </div>

      {!mine && pending ? (
        <div className="mt-[30px] rounded-[22px] bg-card px-4 py-[6px]">
          <div className="flex items-center gap-3 border-b border-hairline py-3">
            <span className="inline-flex size-[34px] items-center justify-center rounded-[11px] bg-lime-soft text-lime">
              <PotIcon size={18} strokeWidth={1.9} />
            </span>
            <span className="flex-1 text-[15px]">{ru.duty.request.youCook}</span>
            <span className="text-[15px] font-semibold">{longDay(req.from_day)}</span>
          </div>
          <div className="flex items-center gap-3 py-3">
            <span className="inline-flex size-[34px] items-center justify-center rounded-[11px] bg-card-2 text-muted">
              <CalendarIcon size={18} strokeWidth={1.9} />
            </span>
            <span className="shrink-0 text-[15px]">{ru.duty.request.yourNext}</span>
            <span className="min-w-0 flex-1 text-right text-[14px] font-semibold text-muted">{myNextDay ? `${shortDay(myNextDay)} · ${ru.duty.request.unchanged}` : "—"}</span>
          </div>
        </div>
      ) : null}

      {pending ? (
        mine ? (
          <div className="mt-auto flex flex-col gap-[10px] pt-8">
            <p className="text-center text-[13px] text-muted">{ru.duty.request.mineWaiting}</p>
            <button
              type="button"
              data-testid="request-cancel"
              disabled={busy}
              onClick={cancel}
              className="h-[50px] rounded-full bg-card text-[16px] font-semibold transition-[transform,opacity] duration-200 ease-smooth active:scale-[0.98] disabled:opacity-50"
            >
              {ru.duty.request.cancel}
            </button>
            {error ? <p role="alert" className="text-center text-label text-orange">{error}</p> : null}
          </div>
        ) : (
          <div className="mt-auto flex flex-col gap-[10px] pt-8">
            <button
              type="button"
              data-testid="request-accept"
              disabled={busy}
              onClick={() => answer(true)}
              className="flex h-14 items-center justify-center gap-2 rounded-full bg-lime text-[17px] font-bold text-on-lime shadow-[0_10px_24px_rgb(0_0_0/0.16)] transition-[transform,opacity] duration-200 ease-smooth active:scale-[0.98] disabled:opacity-50"
            >
              <CheckIcon size={18} strokeWidth={2.6} />
              {ru.duty.request.accept}
            </button>
            <button
              type="button"
              data-testid="request-decline"
              disabled={busy}
              onClick={() => answer(false)}
              className="h-[50px] rounded-full text-[16px] font-semibold transition-[transform,opacity] duration-200 ease-smooth active:scale-[0.98] disabled:opacity-50"
            >
              {ru.duty.request.decline}
            </button>
            {error ? <p role="alert" className="text-center text-label text-orange">{error}</p> : null}
            <p className="text-center text-[12px] text-muted">{ru.duty.request.footer(view.nameOf(other))}</p>
          </div>
        )
      ) : (
        <div className="mt-auto flex flex-col items-center gap-4 pb-2">
          <Result req={shown} view={view} />
          <Link href="/duty" className="rounded-full bg-lime px-6 py-3 text-[16px] font-semibold text-on-lime">
            {ru.duty.request.backToDuty}
          </Link>
        </div>
      )}
    </>,
  );
}
