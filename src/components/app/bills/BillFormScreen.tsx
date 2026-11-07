"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useRepo } from "@/components/RepoProvider";
import { cx } from "@/components/ui/cx";
import { Header } from "@/components/ui/Header";
import { Pill } from "@/components/ui/Pill";
import { Switch } from "@/components/ui/Switch";
import { TextField } from "@/components/ui/TextField";
import type { BillIcon as BillIconName } from "@/lib/data/types";
import { BILL_ICONS, MAX_AMOUNT, billSchema } from "@/lib/domain/schemas";
import { ru } from "@/lib/i18n/ru";
import { useAppActions, useAppData } from "../AppDataProvider";
import { Screen } from "../Screen";
import { avatarColorFor } from "../avatars";
import { PersonChip } from "../purchase/PersonChip";
import { BillIcon } from "./BillIcon";

/** Add or edit a monthly bill (admins). Mirrors the Новая покупка form language: capsule fields, person chips, one lime action. */
export function BillFormScreen({ billId }: { billId: string | null }) {
  const router = useRouter();
  const repo = useRepo();
  const { me, members, bills, activeId, status } = useAppData();
  const { refresh } = useAppActions();
  const existing = activeId && billId ? (bills[activeId] ?? []).find((b) => b.id === billId) : undefined;
  const roster = useMemo(() => (activeId ? (members[activeId] ?? []) : []), [members, activeId]);

  const [title, setTitle] = useState(existing?.title ?? "");
  const [icon, setIcon] = useState<BillIconName>((existing?.icon as BillIconName | undefined) ?? "home");
  const [variable, setVariable] = useState(existing?.variable ?? false);
  const [amountText, setAmountText] = useState(existing?.amount ? String(existing.amount) : "");
  const [dayText, setDayText] = useState(String(existing?.day_of_month ?? 1));
  const [payer, setPayer] = useState<string | null>(existing?.payer_id ?? null);
  const [picked, setPicked] = useState<Set<string> | null>(existing ? new Set(existing.participants) : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [touched, setTouched] = useState(false);

  if (!me || !activeId) return null;
  const isAdmin = roster.some((m) => m.user_id === me.id && m.role === "admin");
  // an unknown id (after the data loaded): nothing to edit
  const missing = billId !== null && status === "ready" && !existing;

  const everyone = roster.map((m) => m.user_id);
  const payerId = payer ?? me.id;
  const selected = picked ?? new Set(everyone);
  const participants = everyone.filter((id) => selected.has(id));
  const amount = amountText === "" ? null : Number(amountText);
  const day = Number(dayText);

  const parsed = billSchema.safeParse({
    id: billId,
    household_id: activeId,
    title,
    icon,
    amount: variable ? null : amount,
    variable,
    day_of_month: day,
    payer_id: payerId,
    participants,
  });

  const fieldErrors = {
    title: title.trim() === "" ? ru.bills.form.errors.title : null,
    amount: variable ? null : amount === null || amount < 1 ? ru.bills.form.errors.amount : amount > MAX_AMOUNT ? ru.purchase.overLimit(`${MAX_AMOUNT}`) : participants.length > 0 && amount < participants.length ? ru.bills.form.errors.tooSmall : null,
    participants: participants.length === 0 ? ru.bills.form.errors.participants : null,
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!parsed.success || busy) return;
    setBusy(true);
    setError(null);
    try {
      await repo.upsertBill({ ...parsed.data, id: billId });
      await refresh({ silent: true });
      router.replace("/monthly");
    } catch {
      setBusy(false);
      setError(ru.bills.form.errors.saveFailed);
    }
  };

  const remove = async () => {
    if (!billId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await repo.deleteBill(billId);
      await refresh({ silent: true });
      router.replace("/monthly");
    } catch {
      setBusy(false);
      setConfirmDelete(false);
      setError(ru.bills.form.errors.deleteFailed);
    }
  };

  const back = () => router.replace("/monthly");

  if (!isAdmin || missing) {
    return (
      <Screen topOffset={54}>
        <div className="self-start">
          <Header title={ru.bills.form.editTitle} onBack={back} />
        </div>
        <p className="rounded-lg border border-hairline bg-card p-5 text-body text-muted">{missing ? ru.bills.loadFailed : ru.bills.form.adminOnly}</p>
      </Screen>
    );
  }

  return (
    <form onSubmit={save} noValidate>
      <Screen topOffset={54} gap={4}>
        <div className="self-start">
          <Header title={billId ? ru.bills.form.editTitle : ru.bills.form.newTitle} leading="close" onBack={back} />
        </div>

        <TextField
          label={ru.bills.form.titleLabel}
          value={title}
          maxLength={60}
          placeholder={ru.bills.form.titlePlaceholder}
          onChange={(e) => setTitle(e.target.value)}
          error={touched ? fieldErrors.title : null}
        />

        <fieldset className="flex flex-col gap-2">
          <legend className="pl-[6px] text-caption">{ru.bills.form.icon}</legend>
          <div className="flex gap-2" role="radiogroup" aria-label={ru.bills.form.icon}>
            {BILL_ICONS.map((name) => (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={icon === name}
                aria-label={ru.bills.form.icons[name]}
                onClick={() => setIcon(name)}
                className={cx(
                  "rounded-full border p-[3px] transition-[transform,border-color,opacity] duration-200 ease-smooth active:scale-[0.94]",
                  icon === name ? "border-lime" : "border-transparent opacity-60",
                )}
              >
                <BillIcon icon={name} />
              </button>
            ))}
          </div>
        </fieldset>

        <div className="flex items-center gap-3 rounded-pill border border-hairline bg-card py-[6px] pr-[6px] pl-5">
          <div className="min-w-0 flex-1">
            <p id="bill-variable" className="text-body">
              {ru.bills.form.variable}
            </p>
            <p className="text-caption">{ru.bills.form.variableCaption}</p>
          </div>
          <Switch checked={variable} onChange={setVariable} labelledBy="bill-variable" className="mr-[14px]" />
        </div>

        {variable ? null : (
          <TextField
            label={ru.bills.form.amount}
            inputMode="numeric"
            autoComplete="off"
            prefix="₸"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value.replace(/\D/g, "").slice(0, 8))}
            error={touched || amountText !== "" ? fieldErrors.amount : null}
          />
        )}

        <TextField
          label={`${ru.bills.form.day} · ${ru.bills.form.dayCaption}`}
          inputMode="numeric"
          autoComplete="off"
          value={dayText}
          onChange={(e) => setDayText(e.target.value.replace(/\D/g, "").slice(0, 2))}
          error={touched && !(day >= 1 && day <= 28) ? ru.bills.form.dayCaption : null}
        />

        <fieldset className="flex flex-col gap-2">
          <legend className="pl-[6px] text-caption">{ru.bills.form.payer}</legend>
          <div className="flex flex-wrap gap-2">
            {roster.map((m) => (
              <PersonChip
                key={m.user_id}
                name={m.user_id === me.id ? ru.purchase.me : m.profile.display_name}
                initialsOf={m.profile.display_name}
                color={avatarColorFor(m.profile, me.id)}
                selected={payerId === m.user_id}
                onToggle={() => setPayer(m.user_id)}
              />
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="pl-[6px] text-caption">{ru.bills.form.participants}</legend>
          <div className="flex flex-wrap gap-2">
            {roster.map((m) => (
              <PersonChip
                key={m.user_id}
                name={m.user_id === me.id ? ru.purchase.me : m.profile.display_name}
                initialsOf={m.profile.display_name}
                color={avatarColorFor(m.profile, me.id)}
                selected={selected.has(m.user_id)}
                onToggle={() => toggle(m.user_id)}
              />
            ))}
          </div>
          {touched && fieldErrors.participants ? (
            <p role="alert" className="pl-[6px] text-label text-orange">
              {fieldErrors.participants}
            </p>
          ) : null}
        </fieldset>

        {error ? (
          <p role="alert" className="pl-[6px] text-label text-orange">
            {error}
          </p>
        ) : null}

        <div className="flex flex-col gap-2 pt-2">
          <Pill type="submit" variant="lime" size="lg" disabled={busy} className="w-full">
            {busy ? ru.bills.form.saving : ru.bills.form.save}
          </Pill>
          {billId ? (
            confirmDelete ? (
              <div className="flex items-center gap-3 rounded-pill border border-danger-line bg-card p-[6px] pl-5">
                <span className="flex-1 text-body !text-danger">{ru.bills.form.deleteConfirm}</span>
                <Pill variant="ghost" size="row" onClick={remove} disabled={busy} className="!bg-danger !text-bg" data-testid="bill-delete-confirm">
                  {busy ? ru.bills.form.deleting : ru.detail.deleteConfirm}
                </Pill>
                <Pill variant="on" size="row" onClick={() => setConfirmDelete(false)}>
                  {ru.detail.deleteCancel}
                </Pill>
              </div>
            ) : (
              <Pill variant="ghost" size="lg" onClick={() => setConfirmDelete(true)} className="w-full border border-danger-line !text-danger" data-testid="bill-delete">
                {ru.bills.form.delete}
              </Pill>
            )
          ) : null}
        </div>
      </Screen>
    </form>
  );
}
