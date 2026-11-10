"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AnimatePresence, m } from "motion/react";
import { Pill } from "@/components/ui/Pill";
import { TextField } from "@/components/ui/TextField";
import { useRepo } from "@/components/RepoProvider";
import { RepoError } from "@/lib/data/repo";
import { emailSchema } from "@/lib/domain/schemas";
import { ease } from "@/lib/motion";
import { ru } from "@/lib/i18n/ru";
import { AuthFrame } from "./AuthFrame";
import { errorMessage } from "./messages";

/** /forgot: email in, the same neutral message out, whether the account exists or not. */
export function ForgotScreen() {
  const repo = useRepo();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setError(ru.errors.email);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await repo.requestPasswordReset(parsed.data, `${window.location.origin}/reset`);
      setSent(true);
    } catch (err) {
      setError(err instanceof RepoError && err.code === "rate_limited" ? errorMessage(err) : ru.errors.generic);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <AuthFrame
        eyebrow={ru.auth.forgot.eyebrow}
        title={ru.auth.forgot.title}
        subtitle={ru.auth.forgot.subtitle}
        footer={
          <Pill type="submit" variant="lime" size="lg" className="flex-1" disabled={busy || sent}>
            {busy ? ru.auth.forgot.busy : ru.auth.forgot.submit}
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
        <AnimatePresence>
          {sent ? (
            <m.p
              role="status"
              data-testid="forgot-sent"
              className="rounded-lg border border-hairline bg-card p-4 text-body"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: ease.smooth }}
            >
              {ru.auth.forgot.sent}
            </m.p>
          ) : null}
        </AnimatePresence>
        <Link href="/login" className="self-start pl-[6px] text-caption !text-lime">
          {ru.auth.forgot.back}
        </Link>
      </AuthFrame>
    </form>
  );
}
