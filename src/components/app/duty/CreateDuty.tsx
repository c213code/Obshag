"use client";

import { useState } from "react";
import { useRepo } from "@/components/RepoProvider";
import { Pill } from "@/components/ui/Pill";
import { TextField } from "@/components/ui/TextField";
import { RepoError } from "@/lib/data/repo";
import type { DutyKind } from "@/lib/data/types";
import { ru } from "@/lib/i18n/ru";
import { OrderEditor } from "./OrderEditor";
import type { DutyView } from "./useDuty";

/** No duty yet, and I am an admin: name, order (up / down) and the first day. The first one in the order cooks on that day. */
export function CreateDuty({ view, kind = "cooking" }: { view: DutyView; kind?: DutyKind }) {
  const repo = useRepo();
  const { roster, me, householdId, today } = view;
  const event = kind === "trash" || kind === "water";
  const defaultTitle = kind === "trash" ? ru.duty.event.trashDefault : kind === "water" ? ru.duty.event.waterDefault : ru.duty.create.titleDefault;
  const copy = kind === "trash" ? ru.duty.event.createTrash : kind === "water" ? ru.duty.event.createWater : ru.duty.create;
  const [title, setTitle] = useState<string>(defaultTitle);
  const [order, setOrder] = useState<string[]>(() =>
    roster
      .filter((m) => m.active)
      .sort((a, b) => a.joined_at.localeCompare(b.joined_at) || a.user_id.localeCompare(b.user_id))
      .map((m) => m.user_id),
  );
  const [start, setStart] = useState<string>(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!householdId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await repo.createDuty({ household_id: householdId, kind, title: title.trim() || defaultTitle, start_date: start || today, order });
      await view.reload();
    } catch (e) {
      setError(e instanceof RepoError && e.code === "invalid" ? ru.duty.create.exists : ru.duty.create.failed);
      setBusy(false);
    }
  };

  return (
    <section data-testid="duty-create" className="flex flex-col gap-4 rounded-[24px] bg-card p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-[17px] font-bold">{copy.title}</h2>
        <p className="text-body text-muted">{copy.text}</p>
      </div>
      <TextField label={ru.duty.create.titleLabel} value={title} maxLength={40} onChange={(e) => setTitle(e.target.value)} />
      <div className="flex flex-col gap-2">
        <span className="pl-[6px] text-caption">{ru.duty.create.orderLabel}</span>
        <OrderEditor order={order} onChange={setOrder} roster={roster} meId={me?.id ?? null} />
      </div>
      {event ? null : <TextField label={ru.duty.create.startLabel} type="date" value={start} onChange={(e) => setStart(e.target.value)} error={error} />}
      {event && error ? (
        <p role="alert" className="text-body text-orange">
          {error}
        </p>
      ) : null}
      <Pill variant="lime" size="lg" disabled={busy || order.length === 0} onClick={submit} data-testid="duty-create-submit" className="w-full">
        {ru.duty.create.submit}
      </Pill>
    </section>
  );
}
