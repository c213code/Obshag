"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { EyeIcon, EyeOffIcon } from "@/components/ui/icons";
import { Pill } from "@/components/ui/Pill";
import { Segmented } from "@/components/ui/Segmented";
import { TextField } from "@/components/ui/TextField";
import { useRepo } from "@/components/RepoProvider";
import { RepoError } from "@/lib/data/repo";
import { emailSchema, passwordSchema } from "@/lib/domain/schemas";
import { ease } from "@/lib/motion";
import { ru } from "@/lib/i18n/ru";
import { useAppActions } from "./AppDataProvider";
import { AuthFrame } from "./AuthFrame";
import { Guard } from "./Guard";
import { errorMessage } from "./messages";

type Mode = "login" | "signup";
type Errors = { email?: string; password?: string; repeat?: string };

/** The eye at the right end of a password capsule. */
function EyeToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={shown}
      aria-label={shown ? ru.auth.hidePassword : ru.auth.showPassword}
      className="-mr-2 grid size-10 shrink-0 place-items-center rounded-full text-muted transition-[transform,color] duration-200 ease-smooth active:scale-90"
    >
      {shown ? <EyeOffIcon size={22} /> : <EyeIcon size={22} />}
    </button>
  );
}

function LoginForm() {
  const repo = useRepo();
  const { refresh } = useAppActions();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [shown, setShown] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const signup = mode === "signup";

  const clear = (field: keyof Errors) => setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    const parsed = emailSchema.safeParse(email);
    const next: Errors = {};
    if (!parsed.success) next.email = ru.errors.email;
    if (signup) {
      if (!passwordSchema.safeParse(password).success) next.password = ru.auth.errors.weakPassword;
      else if (repeat !== password) next.repeat = ru.auth.errors.mismatch;
    } else if (!password) {
      next.password = ru.auth.errors.invalidCredentials;
    }
    if (!parsed.success || next.password || next.repeat) {
      setErrors(next);
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      if (signup) await repo.signUp(parsed.data, password);
      else await repo.signIn(parsed.data, password);
      await refresh(); // the guard then sends the user to the right onboarding step
    } catch (err) {
      const text = errorMessage(err);
      const code = err instanceof RepoError ? err.code : null;
      setErrors(code === "email_taken" || code === "invalid" ? { email: text } : { password: text });
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <AuthFrame
        eyebrow={ru.auth.eyebrow}
        title={signup ? ru.auth.signupTitle : ru.auth.loginTitle}
        footer={
          <Pill type="submit" variant="lime" size="lg" className="flex-1" disabled={busy}>
            {signup ? (busy ? ru.auth.busySignup : ru.auth.submitSignup) : busy ? ru.auth.busyLogin : ru.auth.submitLogin}
          </Pill>
        }
      >
        <Segmented
          label={ru.auth.tabsLabel}
          value={mode}
          onChange={(m) => {
            setMode(m);
            setErrors({});
          }}
          options={[
            { value: "login", label: ru.auth.tabLogin },
            { value: "signup", label: ru.auth.tabSignup },
          ]}
        />
        <TextField
          label={ru.auth.emailLabel}
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          placeholder={ru.auth.emailPlaceholder}
          value={email}
          error={errors.email}
          onChange={(ev) => {
            setEmail(ev.target.value);
            clear("email");
          }}
        />
        <TextField
          label={ru.auth.passwordLabel}
          type={shown ? "text" : "password"}
          autoComplete={signup ? "new-password" : "current-password"}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint={signup ? "next" : "go"}
          placeholder={signup ? ru.auth.passwordPlaceholder : undefined}
          value={password}
          error={errors.password}
          trailing={<EyeToggle shown={shown} onToggle={() => setShown((v) => !v)} />}
          onChange={(ev) => {
            setPassword(ev.target.value);
            clear("password");
          }}
        />
        {signup ? null : (
          <Link href="/forgot" className="-mt-2 self-start pl-[6px] text-caption !text-lime">
            {ru.auth.forgotLink}
          </Link>
        )}
        <AnimatePresence initial={false}>
          {signup ? (
            <motion.div
              key="repeat"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: ease.smooth }}
            >
              <TextField
                label={ru.auth.repeatLabel}
                type={shown ? "text" : "password"}
                autoComplete="new-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                value={repeat}
                error={errors.repeat}
                trailing={<EyeToggle shown={shown} onToggle={() => setShown((v) => !v)} />}
                onChange={(ev) => {
                  setRepeat(ev.target.value);
                  clear("repeat");
                }}
              />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </AuthFrame>
    </form>
  );
}

export function LoginScreen() {
  return (
    <Guard page="login">
      <LoginForm />
    </Guard>
  );
}
