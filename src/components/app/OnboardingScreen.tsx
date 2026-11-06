"use client";

import { useState, type FormEvent } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Pill } from "@/components/ui/Pill";
import { TextField } from "@/components/ui/TextField";
import { useRepo } from "@/components/RepoProvider";
import { formatLocalPhone } from "@/lib/domain/phoneFormat";
import { profileSchema } from "@/lib/domain/schemas";
import { ru } from "@/lib/i18n/ru";
import { useAppActions } from "./AppDataProvider";
import { AuthFrame } from "./AuthFrame";
import { Guard } from "./Guard";
import { errorMessage } from "./messages";

type Errors = { name?: string; phone?: string; form?: string };

export function OnboardingScreen() {
  const repo = useRepo();
  const { refresh } = useAppActions();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const parsed = profileSchema.safeParse({ display_name: name, kaspi_phone: `+7${phone}` });
    if (!parsed.success) {
      const fields = new Set(parsed.error.issues.map((i) => i.path[0]));
      setErrors({
        name: fields.has("display_name") ? ru.errors.name : undefined,
        phone: fields.has("kaspi_phone") ? ru.errors.phone : undefined,
      });
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      await repo.upsertProfile(parsed.data);
      await refresh(); // the guard moves on to the household step
    } catch (err) {
      setErrors({ form: errorMessage(err) });
      setBusy(false);
    }
  };

  return (
    <Guard page="onboarding">
      <form onSubmit={submit} noValidate>
        <AuthFrame
          title={ru.onboarding.title}
          subtitle={ru.onboarding.subtitle}
          footer={
            <Pill type="submit" variant="lime" size="lg" className="flex-1" disabled={busy}>
              {busy ? ru.onboarding.saving : ru.onboarding.next}
            </Pill>
          }
        >
          <div className="flex items-center gap-3 self-start rounded-pill border border-card-2 bg-card py-[6px] pr-5 pl-[6px]">
            <Avatar name={name || "?"} color="me" size={44} decorative />
            <span className="text-caption">{ru.onboarding.avatarNote}</span>
          </div>
          <TextField
            label={ru.onboarding.nameLabel}
            autoComplete="given-name"
            autoCapitalize="words"
            enterKeyHint="next"
            maxLength={40}
            placeholder={ru.onboarding.namePlaceholder}
            value={name}
            error={errors.name}
            onChange={(ev) => {
              setName(ev.target.value);
              setErrors((s) => ({ ...s, name: undefined }));
            }}
          />
          <TextField
            label={ru.onboarding.phoneLabel}
            prefix="+7"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            enterKeyHint="done"
            placeholder={ru.onboarding.phonePlaceholder}
            value={phone}
            error={errors.phone}
            onChange={(ev) => {
              setPhone(formatLocalPhone(ev.target.value));
              setErrors((s) => ({ ...s, phone: undefined }));
            }}
          />
          {errors.form ? (
            <p role="alert" className="pl-[6px] text-label text-orange">
              {errors.form}
            </p>
          ) : null}
        </AuthFrame>
      </form>
    </Guard>
  );
}
