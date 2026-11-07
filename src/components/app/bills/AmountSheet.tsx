"use client";

import { useState, type FormEvent } from "react";
import { Pill } from "@/components/ui/Pill";
import { Sheet } from "@/components/ui/Sheet";
import { TextField } from "@/components/ui/TextField";
import { MAX_AMOUNT } from "@/lib/domain/schemas";
import { ru } from "@/lib/i18n/ru";

/** «Ввести»: the payer types this month's amount of a variable bill; the purchase is created on save. */
export function AmountSheet({
  open,
  title,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  /** Resolves null on success, or the message to show. */
  onSubmit: (amount: number) => Promise<string | null>;
}) {
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = raw === "" ? null : Number(raw);
  const valid = amount !== null && Number.isInteger(amount) && amount >= 1 && amount <= MAX_AMOUNT;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy || amount === null) return;
    setBusy(true);
    setError(null);
    const message = await onSubmit(amount);
    setBusy(false);
    if (message) setError(message);
    else setRaw("");
  };

  return (
    <Sheet open={open} onClose={onClose} label={title} expandedClassName="max-w-[358px] p-4" focusFirst>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <h2 className="px-1 text-headline">{title}</h2>
        <TextField
          label={ru.bills.amountSheet.label}
          inputMode="numeric"
          autoComplete="off"
          prefix="₸"
          value={raw}
          onChange={(e) => setRaw(e.target.value.replace(/\D/g, "").slice(0, 8))}
          error={error}
        />
        <Pill type="submit" variant="lime" size="lg" disabled={!valid || busy} className="w-full">
          {busy ? ru.bills.amountSheet.submitting : ru.bills.amountSheet.submit}
        </Pill>
      </form>
    </Sheet>
  );
}
