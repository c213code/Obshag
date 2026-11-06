"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Pill } from "@/components/ui/Pill";
import { TextField } from "@/components/ui/TextField";
import { useRepo } from "@/components/RepoProvider";
import { emailSchema } from "@/lib/domain/schemas";
import { ru } from "@/lib/i18n/ru";
import { AuthFrame } from "./AuthFrame";
import { Guard } from "./Guard";
import { errorMessage } from "./messages";

export function LoginScreen() {
  const repo = useRepo();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setError(ru.errors.email);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await repo.requestOtp(parsed.data);
      router.push(`/login/verify?email=${encodeURIComponent(parsed.data)}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Guard page="login">
      <form onSubmit={submit} noValidate>
        <AuthFrame
          eyebrow={ru.auth.eyebrow}
          title={ru.auth.loginTitle}
          footer={
            <Pill type="submit" variant="lime" size="lg" className="flex-1" disabled={busy}>
              {busy ? ru.auth.sending : ru.auth.getCode}
            </Pill>
          }
        >
          <TextField
            label={ru.auth.emailLabel}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            placeholder={ru.auth.emailPlaceholder}
            value={email}
            error={error}
            onChange={(ev) => {
              setEmail(ev.target.value);
              setError(null);
            }}
          />
        </AuthFrame>
      </form>
    </Guard>
  );
}
