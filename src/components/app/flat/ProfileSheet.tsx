"use client";

import { useState, type FormEvent } from "react";
import { Pill } from "@/components/ui/Pill";
import { Sheet } from "@/components/ui/Sheet";
import { TextField } from "@/components/ui/TextField";
import { formatLocalPhone } from "@/lib/domain/phoneFormat";
import { profileSchema } from "@/lib/domain/schemas";
import { ru } from "@/lib/i18n/ru";

/** Профиль: my name and Kaspi number (the same two fields as onboarding). */
export function ProfileSheet({
  open,
  onClose,
  initialName,
  initialPhone,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  initialName: string;
  /** '+7XXXXXXXXXX' or null. */
  initialPhone: string | null;
  /** Resolves null on success, or a message. */
  onSave: (input: { display_name: string; kaspi_phone: string }) => Promise<string | null>;
}) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone ? formatLocalPhone(initialPhone.replace(/^\+7/, "")) : "");
  const [errors, setErrors] = useState<{ name?: string; phone?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const parsed = profileSchema.safeParse({ display_name: name, kaspi_phone: `+7${phone}` });
    if (!parsed.success) {
      const fields = new Set(parsed.error.issues.map((i) => i.path[0]));
      setErrors({ name: fields.has("display_name") ? ru.errors.name : undefined, phone: fields.has("kaspi_phone") ? ru.errors.phone : undefined });
      return;
    }
    setBusy(true);
    setErrors({});
    const message = await onSave(parsed.data);
    setBusy(false);
    if (message) setErrors({ form: message });
  };

  return (
    <Sheet open={open} onClose={onClose} label={ru.flat.profile.title} expandedClassName="max-w-[358px] p-4">
      <form onSubmit={submit} noValidate className="flex flex-col gap-3">
        <h2 className="px-1 text-headline">{ru.flat.profile.title}</h2>
        <TextField
          label={ru.flat.profile.name}
          autoComplete="given-name"
          maxLength={40}
          value={name}
          error={errors.name}
          onChange={(e) => {
            setName(e.target.value);
            setErrors((s) => ({ ...s, name: undefined }));
          }}
        />
        <TextField
          label={ru.flat.profile.phone}
          prefix="+7"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder={ru.onboarding.phonePlaceholder}
          value={phone}
          error={errors.phone}
          onChange={(e) => {
            setPhone(formatLocalPhone(e.target.value));
            setErrors((s) => ({ ...s, phone: undefined }));
          }}
        />
        {errors.form ? (
          <p role="alert" className="px-1 text-label text-orange">
            {errors.form}
          </p>
        ) : null}
        <Pill type="submit" variant="lime" size="lg" disabled={busy} className="w-full">
          {ru.flat.profile.save}
        </Pill>
      </form>
    </Sheet>
  );
}
