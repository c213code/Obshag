"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/ui/Header";
import { Pill } from "@/components/ui/Pill";
import { TextField } from "@/components/ui/TextField";
import { useRepo } from "@/components/RepoProvider";
import { inviteCodeSchema } from "@/lib/domain/schemas";
import { pendingJoin } from "@/lib/pendingJoin";
import { ru } from "@/lib/i18n/ru";
import { useAppActions, useAppData } from "./AppDataProvider";
import { AuthFrame } from "./AuthFrame";
import { Guard } from "./Guard";
import { errorMessage } from "./messages";

/** /join (type a code) and /join/[code] (deep link: the code is filled in, one tap to enter). */
export function JoinScreen({ initialCode = "" }: { initialCode?: string }) {
  const repo = useRepo();
  const router = useRouter();
  const { status, stage } = useAppData();
  const { refresh, setActiveId } = useAppActions();
  const [code, setCode] = useState(initialCode);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const deepLink = initialCode !== "";

  // Remember a deep link until the user has a profile (login and onboarding come first). Someone who already has a
  // household has nothing to resume, and must not leave a stale code behind for the next sign-in.
  useEffect(() => {
    if (status !== "ready") return;
    if (stage === 3) pendingJoin.clear();
    else if (initialCode) pendingJoin.set(initialCode);
  }, [initialCode, status, stage]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    // Anything that is not a plausible code gets the same answer as a wrong one.
    if (!inviteCodeSchema.safeParse(code).success) {
      setError(ru.errors.joinFailed);
      return;
    }
    setBusy(true);
    try {
      const household = await repo.joinHousehold(code);
      pendingJoin.clear();
      await refresh();
      setActiveId(household.id);
      router.replace("/");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Guard page="household">
      <form onSubmit={submit} noValidate>
        <AuthFrame
          header={
            <div className="self-start">
              <Header title={ru.household.join.title} onBack={() => router.back()} />
            </div>
          }
          title={deepLink ? ru.household.deepLinkTitle : ru.household.joinTitle}
          subtitle={deepLink ? ru.household.deepLinkCaption : undefined}
          footer={
            <Pill type="submit" variant="lime" size="lg" className="flex-1" disabled={busy}>
              {busy ? ru.household.joining : ru.household.joinSubmit}
            </Pill>
          }
        >
          <TextField
            label={ru.household.codeLabel}
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            maxLength={40}
            placeholder={ru.household.codePlaceholder}
            value={code}
            error={error}
            onChange={(ev) => {
              setCode(ev.target.value.toUpperCase());
              setError(null);
            }}
          />
        </AuthFrame>
      </form>
    </Guard>
  );
}
