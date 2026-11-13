"use client";

import { useState } from "react";
import { Pill } from "@/components/ui/Pill";
import { Sheet } from "@/components/ui/Sheet";
import { ru } from "@/lib/i18n/ru";

/** «Я уезжаю»: pick the day I am back. Until then I am not selected by default in new purchases. */
export function AwaySheet({
  open,
  onClose,
  today,
  current,
  busy,
  error,
  onSave,
  target,
}: {
  open: boolean;
  onClose: () => void;
  /** 'YYYY-MM-DD' (Asia/Almaty): the earliest date to pick. */
  today: string;
  current: string | null;
  busy: boolean;
  error: string | null;
  onSave: (until: string | null) => void;
  /** Somebody else (a housemate who is out of town): their name is in the texts. Omitted = myself. */
  target?: { id: string; name: string };
}) {
  const t = target
    ? { title: ru.flat.awayFor.title(target.name), label: ru.flat.awayFor.label, hint: ru.flat.awayFor.hint, clear: ru.flat.awayFor.clear(target.name) }
    : { title: ru.flat.away.title, label: ru.flat.away.label, hint: ru.flat.away.hint, clear: ru.flat.away.clear };
  const [value, setValue] = useState(current && current >= today ? current : "");
  return (
    <Sheet open={open} onClose={onClose} label={t.title} expandedClassName="max-w-[358px] p-4">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (value && value >= today) onSave(value);
        }}
      >
        <h2 className="px-1 text-headline">{t.title}</h2>
        <label className="flex flex-col gap-2">
          <span className="pl-[6px] text-caption">{t.label}</span>
          <input
            type="date"
            name="away_until"
            min={today}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-[58px] rounded-pill border border-card-2 bg-card px-5 font-medium text-text outline-none focus:border-lime"
          />
        </label>
        <p className="px-1 text-caption">{error ?? t.hint}</p>
        <Pill type="submit" variant="lime" size="lg" disabled={busy || !value || value < today} className="w-full">
          {ru.flat.away.save}
        </Pill>
        {current ? (
          <Pill variant="on" size="lg" disabled={busy} onClick={() => onSave(null)} className="w-full">
            {t.clear}
          </Pill>
        ) : null}
      </form>
    </Sheet>
  );
}
