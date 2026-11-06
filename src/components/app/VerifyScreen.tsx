"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Header } from "@/components/ui/Header";
import { Pill } from "@/components/ui/Pill";
import { useRepo } from "@/components/RepoProvider";
import { getPublicEnv } from "@/lib/env/public";
import { emailSchema, otpSchema } from "@/lib/domain/schemas";
import { ru } from "@/lib/i18n/ru";
import { useAppActions } from "./AppDataProvider";
import { AuthFrame } from "./AuthFrame";
import { CodeInput } from "./CodeInput";
import { Guard } from "./Guard";
import { errorMessage } from "./messages";

export function VerifyScreen() {
  const repo = useRepo();
  const router = useRouter();
  const { refresh } = useAppActions();
  const params = useSearchParams();
  const emailParam = params.get("email") ?? "";
  const email = useMemo(() => emailSchema.safeParse(emailParam), [emailParam]);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);
  const inFlight = useRef(false);
  const mock = getPublicEnv().NEXT_PUBLIC_DATA_MODE === "mock";

  useEffect(() => {
    if (!email.success) router.replace("/login");
  }, [email.success, router]);

  const verify = useCallback(
    async (value: string) => {
      if (!email.success || inFlight.current || !otpSchema.safeParse(value).success) return;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      try {
        await repo.verifyOtp(email.data, value);
        await refresh(); // the guard then sends the user to the right onboarding step
      } catch (err) {
        setError(errorMessage(err));
        setShake((n) => n + 1);
        setCode("");
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [email, repo, refresh],
  );

  const onChange = (next: string) => {
    setCode(next);
    setError(null);
    if (next.length === 6) void verify(next);
  };

  if (!email.success) return null;

  return (
    <Guard page="login">
      <AuthFrame
        header={
          <div className="self-start">
            <Header title={ru.auth.otherEmail} onBack={() => router.back()} />
          </div>
        }
        title={ru.auth.verifyTitle}
        subtitle={ru.auth.sentTo(email.data)}
        footer={
          <Pill
            variant="lime"
            size="lg"
            className="flex-1"
            disabled={busy || code.length !== 6}
            onClick={() => void verify(code)}
          >
            {busy ? ru.auth.checking : ru.onboarding.next}
          </Pill>
        }
      >
        <div className="flex flex-col gap-3">
          <CodeInput value={code} onChange={onChange} label={ru.auth.codeLabel} disabled={busy} invalid={!!error} shake={shake} />
          {error ? (
            <p role="alert" className="pl-[6px] text-label text-orange">
              {error}
            </p>
          ) : null}
          {mock ? <p className="pl-[6px] text-caption text-balance">{ru.auth.mockHint}</p> : null}
        </div>
      </AuthFrame>
    </Guard>
  );
}
