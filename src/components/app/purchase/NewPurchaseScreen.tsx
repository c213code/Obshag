"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { BottomActions } from "@/components/ui/BottomActions";
import { Fab } from "@/components/ui/Fab";
import { Header } from "@/components/ui/Header";
import { CheckIcon } from "@/components/ui/icons";
import { Segmented } from "@/components/ui/Segmented";
import { MAX_AMOUNT, createPurchaseSchema } from "@/lib/domain/schemas";
import { perPersonRange } from "@/lib/domain/split";
import { formatNumber, formatTenge } from "@/lib/format/money";
import { ru } from "@/lib/i18n/ru";
import { useAppActions, useAppData } from "../AppDataProvider";
import { Screen } from "../Screen";
import { avatarColorFor } from "../avatars";
import { AmountInput } from "./AmountInput";
import { PersonChip } from "./PersonChip";

const label = "pl-[6px] text-caption";

/** Новая покупка, per AddPurchase.dc.html. Slice 1: payer = me, equal split only. */
export function NewPurchaseScreen() {
  const router = useRouter();
  const { me, members, activeId } = useAppData();
  const { addPurchase, refreshMembers } = useAppActions();
  const roster = useMemo(() => (activeId ? (members[activeId] ?? []) : []), [members, activeId]);

  const [amount, setAmount] = useState<number | null>(null);
  const [what, setWhat] = useState("");
  // null = everyone (the default), otherwise the explicit set of chosen ids
  const [picked, setPicked] = useState<ReadonlySet<string> | null>(null);
  const [sent, setSent] = useState(false);

  // A neighbour may have joined since Главная loaded: fetch the roster again whenever this screen opens.
  useEffect(() => {
    if (activeId) void refreshMembers(activeId);
  }, [activeId, refreshMembers]);

  if (!me || !activeId) return null;

  const everyone = roster.map((m) => m.user_id);
  const selected = picked ?? new Set(everyone);
  const participantIds = everyone.filter((id) => selected.has(id));
  const n = participantIds.length;
  const range = perPersonRange(amount ?? 0, n);

  const parsed = createPurchaseSchema.safeParse({
    household_id: activeId,
    amount: amount ?? 0,
    description: what,
    participant_ids: participantIds,
  });
  // someone other than the payer must owe something, otherwise the purchase changes no balance
  const debtors = participantIds.filter((id) => id !== me.id).length;
  const amountError =
    amount !== null && amount > MAX_AMOUNT
      ? ru.purchase.overLimit(formatTenge(MAX_AMOUNT))
      : amount !== null && n > 0 && amount < n
        ? ru.purchase.tooSmall
        : null;
  const canSubmit = parsed.success && !sent && debtors > 0 && !amountError;

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!parsed.success || sent || debtors === 0 || amountError) return;
    setSent(true);
    addPurchase({ ...parsed.data, merchant: null }); // optimistic: the list shows it at once, rollback with a notice on failure
    router.push("/");
  };

  const hint =
    n === 0
      ? ru.purchase.pickSomeone
      : amountError
        ? ru.purchase.fixAmount
        : !amount
          ? ru.purchase.enterAmount
          : !what.trim()
            ? ru.purchase.enterWhat
            : null;
  const per =
    !amount || n === 0 || amountError
      ? "—"
      : range.min === range.max
        ? formatTenge(range.min)
        : `${formatNumber(range.min)}–${formatTenge(range.max)}`;

  const others = roster.filter((m) => m.user_id !== me.id);
  const payers = [
    { value: "me", label: ru.purchase.me },
    // paying on behalf of someone else arrives with a later slice
    ...others.map((m) => ({ value: m.user_id, label: m.profile.display_name, disabled: true })),
  ];

  return (
    <form onSubmit={submit} noValidate>
      <Screen topOffset={54}>
        <div className="self-start">
          <Header title={ru.purchase.title} leading="close" onBack={() => router.replace("/")} />
        </div>

        <div className="flex flex-col items-center gap-2 py-2">
          <AmountInput value={amount} onChange={setAmount} label={ru.purchase.amountLabel} autoFocus invalid={!!amountError} />
          <input
            aria-label={ru.purchase.whatLabel}
            value={what}
            maxLength={200}
            placeholder={ru.purchase.whatPlaceholder}
            enterKeyHint="done"
            autoComplete="off"
            onChange={(e) => setWhat(e.target.value)}
            className="w-full border-0 bg-transparent p-0 text-center text-[16px] leading-[19px] text-muted outline-none placeholder:text-muted/50"
          />
          {amountError ? (
            <p role="alert" className="text-label text-orange">
              {amountError}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between pr-[6px]">
            <span className={label}>{ru.purchase.payer}</span>
            {others.length > 0 ? <span className="text-[12px] text-muted/60">{ru.main.quick.soon}</span> : null}
          </div>
          <Segmented label={ru.purchase.payer} options={payers} value="me" onChange={() => undefined} activeVariant="lime" />
        </div>

        <div className="flex flex-col gap-2">
          <span className={label}>{ru.purchase.split}</span>
          <Segmented
            label={ru.purchase.split}
            options={[
              { value: "equal", label: ru.purchase.equal },
              { value: "custom", label: ru.purchase.custom, disabled: true, soon: ru.main.quick.soon },
            ]}
            value="equal"
            onChange={() => undefined}
          />
        </div>

        <div className="flex flex-col gap-[10px]">
          <span className={label}>{ru.purchase.whom}</span>
          <div className="flex flex-wrap gap-2">
            {roster.map((m) => {
              const isMe = m.user_id === me.id;
              return (
                <PersonChip
                  key={m.user_id}
                  name={isMe ? ru.purchase.me : m.profile.display_name}
                  initialsOf={m.profile.display_name}
                  color={avatarColorFor(m.profile, me.id)}
                  selected={selected.has(m.user_id)}
                  onToggle={() => toggle(m.user_id)}
                />
              );
            })}
          </div>
          {debtors === 0 ? (
            <p role="status" className="pl-[6px] text-label text-orange">
              {others.length === 0 ? ru.purchase.aloneInFlat : ru.purchase.pickDebtor}
            </p>
          ) : null}
        </div>
      </Screen>

      <BottomActions
        barClassName="h-[58px] flex-1 !pl-5"
        trailing={
          <Fab type="submit" aria-label={ru.purchase.submit} disabled={!canSubmit}>
            <CheckIcon size={26} strokeWidth={2.6} />
          </Fab>
        }
      >
        <div aria-live="polite" className="flex flex-1 flex-col">
          <span className={hint ? "text-headline text-muted" : "text-headline"}>{ru.purchase.per(per)}</span>
          <span className="text-caption">{hint ?? ru.purchase.people(n)}</span>
        </div>
      </BottomActions>
    </form>
  );
}
