"use client";

import { useMemo, useState } from "react";
import { useRepo } from "@/components/RepoProvider";
import { RepoError } from "@/lib/data/repo";
import { almatyDay } from "@/lib/domain/almaty";
import { isAway } from "@/lib/domain/away";
import { ru } from "@/lib/i18n/ru";
import { useAppActions, useAppData } from "../AppDataProvider";
import { AwaySheet } from "./AwaySheet";

/**
 * «{Имя} в отъезде»: any housemate sets the day another housemate is back (or marks them home). Saves through
 * setMemberAway, refreshes the roster, then calls `onSaved` so the screen can reload what depends on it (the duty plan).
 */
export function MemberAwaySheet({
  member,
  open,
  onClose,
  onSaved,
}: {
  member: { id: string; name: string; away_until: string | null } | null;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
}) {
  const repo = useRepo();
  const { activeId } = useAppData();
  const { refreshMembers } = useAppActions();
  const today = useMemo(() => almatyDay(new Date()).date, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!member || !activeId) return null;
  const current = isAway(member.away_until, today) ? member.away_until : null;

  const save = async (until: string | null) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await repo.setMemberAway(activeId, member.id, until);
      await refreshMembers(activeId);
      await onSaved?.();
      onClose();
    } catch (e) {
      setError(e instanceof RepoError && e.code === "invalid" ? ru.flat.away.invalid : ru.flat.errors.generic);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AwaySheet
      key={`${member.id}:${current ?? ""}`}
      open={open}
      onClose={() => {
        setError(null);
        onClose();
      }}
      today={today}
      current={current}
      busy={busy}
      error={error}
      onSave={(u) => void save(u)}
      target={{ id: member.id, name: member.name }}
    />
  );
}
