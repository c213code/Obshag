"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRepo } from "@/components/RepoProvider";
import { cx } from "@/components/ui/cx";
import { ArrowRightIcon, CalendarIcon, CheckIcon, ChevronRightIcon, SwapIcon } from "@/components/ui/icons";
import { RepoError } from "@/lib/data/repo";
import { DOW_SHORT, fullDay, isoDow, longDay, neighbours, shortDay, swapExpiresAt, SWAP_REASON_MAX } from "@/lib/domain/duty";
import { ru } from "@/lib/i18n/ru";
import { useAppActions } from "../AppDataProvider";
import { DutySheet } from "./DutySheet";
import { Dot } from "./parts";
import { useNotifyDuty, useNow, useOnOpen, type DutyView } from "./useDuty";

const row = "flex items-center gap-3 rounded-[20px] border p-3 text-left transition-[transform,background-color,border-color] duration-200 ease-smooth active:scale-[0.99]";

/** The two circles of the exchange summary: who had the day (faded) -> who has it now. */
function Exchange({ day, from, to, view }: { day: string; from: string; to: string; view: DutyView }) {
  const dot = (id: string, faded: boolean) => (
    <Dot name={view.nameOf(id)} tone={view.toneOf(id)} size={28} fontSize={12} className={faded ? "opacity-40" : undefined} />
  );
  return (
    <div className="flex-1 text-center">
      <div className="text-[12px] text-muted">{shortDay(day)}</div>
      <div className="mt-[6px] flex items-center justify-center gap-[6px]">
        {dot(from, true)}
        <ArrowRightIcon size={14} className="text-muted" strokeWidth={2} />
        {dot(to, false)}
      </div>
    </div>
  );
}

/**
 * «Поменяться днём» (DutySwap.dc.html): my day, a neighbour before / after or a day picked in the calendar, a reason, send.
 * The server decides (busy / not_assignee / expired ...); the sheet only pre-empts the deadline.
 */
export function SwapSheet({
  open,
  onClose,
  view,
  myDay,
  presetOther,
}: {
  open: boolean;
  onClose: () => void;
  view: DutyView;
  myDay: string | null;
  /** A day chosen in the calendar. */
  presetOther: string | null;
}) {
  const repo = useRepo();
  const notify = useNotifyDuty();
  const { showNotice } = useAppActions();
  const me = view.me;
  const duty = view.duty;
  const [other, setOther] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const now = useNow();
  useOnOpen(open, () => {
    setOther(presetOther);
    setReason("");
    setError(null);
    setBusy(false);
  });

  const near = useMemo(
    () => (myDay && me ? neighbours(view.plan, myDay, me.id, view.today) : { before: null, after: null }),
    [view.plan, myDay, me, view.today],
  );
  if (!me || !duty || !myDay) return null;

  type Pick = { day: string; user: string; note: string };
  const picks: Pick[] = [];
  if (near.before) picks.push({ day: near.before.day, user: near.before.user_id, note: ru.duty.swap.before });
  if (near.after) picks.push({ day: near.after.day, user: near.after.user_id, note: ru.duty.swap.after });
  const custom = presetOther && !picks.some((p) => p.day === presetOther) ? view.plan.find((d) => d.day === presetOther) : null;
  if (custom) picks.push({ day: custom.day, user: custom.user_id, note: "" });

  const chosen = other ? view.plan.find((d) => d.day === other) : null;
  const tooLate = !!other && Date.parse(swapExpiresAt(myDay, other)) <= now;
  const first = other ? (myDay < other ? myDay : other) : myDay;

  const send = async () => {
    if (!other || !chosen || busy || tooLate) return;
    setBusy(true);
    setError(null);
    try {
      const req = await repo.requestSwap(duty.id, myDay, other, reason.trim() || null);
      void notify(req.id, "requested");
      showNotice(ru.duty.swap.sent);
      await view.reload();
      onClose();
    } catch (e) {
      const code = e instanceof RepoError ? e.code : "unknown";
      setError(
        code === "busy" ? ru.duty.swap.busy
        : code === "expired" ? ru.duty.swap.tooLate
        : code === "not_assignee" ? ru.duty.swap.notYours
        : code === "past_day" ? ru.duty.swap.past
        : code === "invalid" ? ru.duty.swap.invalid
        : ru.duty.swap.failed,
      );
      setBusy(false);
    }
  };

  return (
    <DutySheet open={open} onClose={onClose} label={ru.duty.swap.title} title={ru.duty.swap.title} subtitle={ru.duty.swap.yourDay(fullDay(myDay))} testId="duty-swap-sheet">
      <div className="flex flex-col gap-2" role="radiogroup" aria-label={ru.duty.swap.title}>
        {picks.map((p) => {
          const on = other === p.day;
          return (
            <button
              key={p.day}
              type="button"
              role="radio"
              aria-checked={on}
              data-testid="swap-option"
              data-day={p.day}
              onClick={() => setOther(p.day)}
              className={cx(row, on ? "border-2 border-lime bg-lime-soft" : "border-hairline bg-card")}
            >
              <Dot name={view.nameOf(p.user)} tone={view.toneOf(p.user)} size={44} fontSize={16} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px] font-semibold">{view.nameOf(p.user)}</span>
                <span className="mt-[2px] block text-[13px] text-muted">{p.note ? `${longDay(p.day)} · ${p.note}` : longDay(p.day)}</span>
              </span>
              <span
                aria-hidden="true"
                className={cx("inline-flex size-6 shrink-0 items-center justify-center rounded-full", on ? "bg-lime text-on-lime" : "border-2 border-outline")}
              >
                {on ? <CheckIcon size={14} strokeWidth={3} /> : null}
              </span>
            </button>
          );
        })}
        {picks.length === 0 ? <p className="px-1 text-body text-muted">{ru.duty.swap.noNeighbours}</p> : null}
        <Link
          href={`/duty/calendar?swap=${myDay}`}
          data-testid="swap-other-day"
          className={cx(row, "border-hairline bg-card text-text")}
        >
          <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-card-2 text-lime">
            <CalendarIcon size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold">{ru.duty.swap.other}</span>
            <span className="mt-[2px] block text-[13px] text-muted">{ru.duty.swap.otherText}</span>
          </span>
          <ChevronRightIcon size={18} className="text-faint" strokeWidth={2} />
        </Link>
      </div>

      {chosen ? (
        <div data-testid="swap-summary" className="flex items-center gap-[10px] rounded-[20px] bg-bg p-[14px]">
          <Exchange day={chosen.day} from={chosen.user_id} to={me.id} view={view} />
          <span aria-hidden="true" className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-lime text-on-lime">
            <SwapIcon size={18} strokeWidth={2.2} />
          </span>
          <Exchange day={myDay} from={me.id} to={chosen.user_id} view={view} />
        </div>
      ) : null}

      <label className="flex flex-col gap-[6px] text-[13px] font-semibold text-muted">
        {ru.duty.swap.reason}
        <input
          type="text"
          value={reason}
          maxLength={SWAP_REASON_MAX}
          placeholder={ru.duty.swap.reasonPlaceholder}
          onChange={(e) => setReason(e.target.value)}
          data-testid="swap-reason"
          className="h-12 rounded-[16px] border border-hairline bg-card px-[14px] text-[15px] font-medium text-text outline-none transition-colors duration-200 ease-smooth placeholder:text-muted/60 focus:border-lime"
        />
      </label>
      {chosen ? (
        <p className="-mt-1 px-1 text-[13px] leading-[1.45] text-muted">
          {tooLate ? ru.duty.swap.tooLate : ru.duty.swap.note(view.nameOf(chosen.user_id), `${DOW_SHORT[isoDow(first)]} 10:00`)}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="px-1 text-label text-orange">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        data-testid="swap-send"
        disabled={!chosen || busy || tooLate}
        onClick={send}
        className="h-[54px] rounded-full bg-lime text-[17px] font-semibold text-on-lime shadow-[0_8px_22px_rgb(0_0_0/0.14)] transition-[transform,opacity] duration-200 ease-smooth active:scale-[0.98] disabled:opacity-40"
      >
        {busy ? ru.duty.swap.sending : ru.duty.swap.send}
      </button>
    </DutySheet>
  );
}
