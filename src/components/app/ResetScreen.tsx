"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { EyeIcon, EyeOffIcon } from "@/components/ui/icons";
import { Pill } from "@/components/ui/Pill";
import { TextField } from "@/components/ui/TextField";
import { useRepo } from "@/components/RepoProvider";
import { passwordSchema } from "@/lib/domain/schemas";
import { ru } from "@/lib/i18n/ru";
import { useAppActions } from "./AppDataProvider";
import { AuthFrame } from "./AuthFrame";
import { errorMessage } from "./messages";
import { ScreenSkeleton } from "./ScreenSkeleton";

type Phase = "checking" | "ready" | "invalid";

/**
 * /reset: the e-mail link lands here. A `?code=` (PKCE) or a `token_hash` (+ type=recovery) becomes a recovery session,
 * then the user picks a new password. `?mock=1` is the mock backend's stand-in for the e-mail.
 */
export function ResetScreen() {
  const repo = useRepo();
  const router = useRouter();
  const { refresh } = useAppActions();
  const [phase, setPhase] = useState<Phase>("checking");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [shown, setShown] = useState(false);
  const [errors, setErrors] = useState<{ password?: string; repeat?: string }>({});
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    // a one-time code must be exchanged exactly once (React strict mode runs effects twice in dev)
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    const type = params.get("type");
    const link = {
      code: params.get("code"),
      tokenHash: !type || type === "recovery" ? params.get("token_hash") : null,
      mock: params.get("mock") === "1",
      mockEmail: params.get("email"),
    };
    // drop the one-time secrets from the address bar and history
    window.history.replaceState(null, "", "/reset");
    repo.startPasswordRecovery(link).then(
      () => setPhase("ready"),
      () => setPhase("invalid"),
    );
  }, [repo]);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    const next: { password?: string; repeat?: string } = {};
    if (!passwordSchema.safeParse(password).success) next.password = ru.auth.errors.weakPassword;
    else if (repeat !== password) next.repeat = ru.auth.errors.mismatch;
    if (next.password || next.repeat) {
      setErrors(next);
      return;
    }
    setBusy(true);
    try {
      await repo.updatePassword(password);
      await refresh();
      router.replace("/");
    } catch (err) {
      setErrors({ password: errorMessage(err) });
      setBusy(false);
    }
  };

  if (phase === "checking") return <ScreenSkeleton />;
  if (phase === "invalid") {
    return (
      <AuthFrame
        eyebrow={ru.auth.reset.eyebrow}
        title={ru.auth.reset.title}
        subtitle={ru.auth.errors.invalidLink}
        footer={
          <Link href="/forgot" className="flex h-12 flex-1 items-center justify-center rounded-pill bg-lime px-6 text-headline text-on-lime">
            {ru.auth.reset.requestNew}
          </Link>
        }
      >
        {null}
      </AuthFrame>
    );
  }

  const eye = (
    <button
      type="button"
      onClick={() => setShown((v) => !v)}
      aria-pressed={shown}
      aria-label={shown ? ru.auth.hidePassword : ru.auth.showPassword}
      className="-mr-2 grid size-10 shrink-0 place-items-center rounded-full text-muted transition-[transform,color] duration-200 ease-smooth active:scale-90"
    >
      {shown ? <EyeOffIcon size={22} /> : <EyeIcon size={22} />}
    </button>
  );
  const common = { type: shown ? "text" : "password", autoComplete: "new-password", autoCapitalize: "none", autoCorrect: "off", spellCheck: false, trailing: eye } as const;

  return (
    <form onSubmit={submit} noValidate>
      <AuthFrame
        eyebrow={ru.auth.reset.eyebrow}
        title={ru.auth.reset.title}
        footer={
          <Pill type="submit" variant="lime" size="lg" className="flex-1" disabled={busy}>
            {busy ? ru.auth.reset.busy : ru.auth.reset.submit}
          </Pill>
        }
      >
        <TextField
          {...common}
          label={ru.auth.reset.newLabel}
          placeholder={ru.auth.passwordPlaceholder}
          enterKeyHint="next"
          value={password}
          error={errors.password}
          onChange={(ev) => {
            setPassword(ev.target.value);
            setErrors({});
          }}
        />
        <TextField
          {...common}
          label={ru.auth.reset.repeatLabel}
          enterKeyHint="go"
          value={repeat}
          error={errors.repeat}
          onChange={(ev) => {
            setRepeat(ev.target.value);
            setErrors({});
          }}
        />
      </AuthFrame>
    </form>
  );
}
