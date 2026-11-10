"use client";

import { useState } from "react";
import { useRepo } from "@/components/RepoProvider";
import { Pill } from "@/components/ui/Pill";
import { TextField } from "@/components/ui/TextField";
import { RepoError } from "@/lib/data/repo";
import { fullDay } from "@/lib/domain/duty";
import { ru } from "@/lib/i18n/ru";
import { useAppActions } from "../AppDataProvider";
import { DutySheet } from "./DutySheet";
import { OrderEditor } from "./OrderEditor";
import { Dot } from "./parts";
import { useOnOpen, type DutyView } from "./useDuty";

/** «Порядок и старт»: admins reorder the rotation and move the first day. */
export function OrderSheet({ open, onClose, view }: { open: boolean; onClose: () => void; view: DutyView }) {
  const repo = useRepo();
  const { showNotice } = useAppActions();
  const duty = view.duty;
  const [order, setOrder] = useState<string[]>([]);
  const [start, setStart] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useOnOpen(open, () => {
    setOrder(duty?.order ?? []);
    setStart(duty?.start_date ?? "");
    setError(null);
    setBusy(false);
  });

  const save = async () => {
    if (!duty || busy) return;
    setBusy(true);
    setError(null);
    try {
      await repo.setDutyOrder(duty.id, order, start || null);
      await view.reload();
      showNotice(ru.duty.settingsSheet.saved);
      onClose();
    } catch {
      setError(ru.duty.settingsSheet.failed);
      setBusy(false);
    }
  };

  return (
    <DutySheet open={open} onClose={onClose} label={ru.duty.settingsSheet.title} title={ru.duty.settingsSheet.title} testId="duty-order-sheet">
      <OrderEditor order={order} onChange={setOrder} roster={view.roster} meId={view.me?.id ?? null} />
      {duty?.kind === "trash" || duty?.kind === "water" ? (
        error ? <p role="alert" className="text-body text-orange">{error}</p> : null
      ) : (
        <TextField label={ru.duty.create.startLabel} type="date" value={start} onChange={(e) => setStart(e.target.value)} error={error} />
      )}
      <Pill variant="lime" size="lg" disabled={busy || order.length === 0} onClick={save} data-testid="duty-order-save" className="w-full">
        {ru.duty.settingsSheet.save}
      </Pill>
    </DutySheet>
  );
}

/** «Не могу сегодня»: an admin puts another member on today. */
export function ReplaceSheet({ open, onClose, view }: { open: boolean; onClose: () => void; view: DutyView }) {
  const repo = useRepo();
  const { showNotice } = useAppActions();
  const duty = view.duty;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const row = view.plan.find((d) => d.day === view.today);

  const assign = async (userId: string | null) => {
    if (!duty || busy) return;
    setBusy(true);
    setError(null);
    try {
      await repo.adminAssignDay(duty.id, view.today, userId);
      await view.reload();
      showNotice(ru.duty.replace.done);
      onClose();
    } catch (e) {
      setError(e instanceof RepoError && e.code === "locked" ? ru.duty.stove.locked : ru.duty.replace.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DutySheet open={open} onClose={onClose} label={ru.duty.replace.title} title={ru.duty.replace.title} subtitle={ru.duty.replace.text(fullDay(view.today))} testId="duty-replace-sheet">
      <div className="flex flex-col gap-2">
        {view.roster
          .filter((m) => m.active && m.user_id !== row?.user_id)
          .map((m) => (
            <button
              key={m.user_id}
              type="button"
              data-testid="replace-option"
              disabled={busy}
              onClick={() => assign(m.user_id)}
              className="flex items-center gap-3 rounded-[20px] border border-hairline bg-card p-3 text-left transition-transform duration-200 ease-smooth active:scale-[0.99] disabled:opacity-50"
            >
              <Dot name={m.profile.display_name} tone={view.toneOf(m.user_id)} size={44} />
              <span className="flex-1 text-[16px] font-semibold">{m.profile.display_name}</span>
            </button>
          ))}
        {row?.source === "admin" ? (
          <Pill variant="on" size="lg" disabled={busy} onClick={() => assign(null)} className="w-full">
            {ru.duty.replace.reset}
          </Pill>
        ) : null}
        {error ? (
          <p role="alert" className="pl-[6px] text-label text-orange">
            {error}
          </p>
        ) : null}
      </div>
    </DutySheet>
  );
}
