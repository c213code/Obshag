"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/ui/Header";
import { Pill } from "@/components/ui/Pill";
import { TextField } from "@/components/ui/TextField";
import { useRepo } from "@/components/RepoProvider";
import { householdNameSchema } from "@/lib/domain/schemas";
import { ru } from "@/lib/i18n/ru";
import { useAppActions } from "./AppDataProvider";
import { AuthFrame } from "./AuthFrame";
import { Guard } from "./Guard";
import { errorMessage } from "./messages";

export function CreateHouseholdScreen() {
  const repo = useRepo();
  const router = useRouter();
  const { refresh, setActiveId } = useAppActions();
  const [name, setName] = useState<string>(ru.household.defaultName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const parsed = householdNameSchema.safeParse(name);
    if (!parsed.success) {
      setError(ru.errors.householdName);
      return;
    }
    setBusy(true);
    try {
      const created = await repo.createHousehold(parsed.data);
      await refresh();
      setActiveId(created.id);
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
              <Header title={ru.household.create.title} onBack={() => router.back()} />
            </div>
          }
          title={ru.household.createTitle}
          footer={
            <Pill type="submit" variant="lime" size="lg" className="flex-1" disabled={busy}>
              {busy ? ru.household.creating : ru.household.createSubmit}
            </Pill>
          }
        >
          <TextField
            label={ru.household.nameLabel}
            maxLength={60}
            enterKeyHint="done"
            placeholder={ru.household.namePlaceholder}
            value={name}
            error={error}
            onChange={(ev) => {
              setName(ev.target.value);
              setError(null);
            }}
          />
        </AuthFrame>
      </form>
    </Guard>
  );
}
