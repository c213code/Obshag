"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/ui/Sheet";
import type { UiPurchase } from "@/lib/data/purchaseTracker";
import { perPersonRange } from "@/lib/domain/split";
import { ru } from "@/lib/i18n/ru";
import { useAppActions, useAppData } from "../AppDataProvider";
import { HomeScreen } from "../home/HomeScreen";
import { PendingCard, type Choice } from "./PendingCard";

/**
 * /pending/[id]: the island sheet over Главная (motion reference #2, ApplePay.dc.html). It grows from a black pill, the
 * content fades in late, and after «Общее» / «Моё» it collapses to a pill with ✓ «Поделено» / «Моё» and leaves.
 *
 * `choice` (from a notification action) only EMPHASISES the matching button: nothing is submitted without a tap.
 */
export function PendingScreen({ id, choice }: { id: string; choice: Choice | null }) {
  const router = useRouter();
  const { purchases, members, me, status } = useAppData();
  const { resolvePending, showNotice, refresh } = useAppActions();

  const found = useMemo(() => {
    for (const list of Object.values(purchases)) {
      const p = list.find((x) => x.id === id);
      if (p) return p;
    }
    return null;
  }, [purchases, id]);

  // keep what the sheet shows stable once it has opened (resolving flips the row under it)
  const [held, setHeld] = useState<UiPurchase | null>(null);
  if (!held && found && found.status === "pending") setHeld(found);

  // the island opens a frame or two after Главная has painted, so its first frame is not competing with the page's own
  const [homePainted, setHomePainted] = useState(false);
  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setHomePainted(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, []);

  const [open, setOpen] = useState(true);
  const [outcome, setOutcome] = useState<{ shared: boolean } | null>(null);
  const [category, setCategory] = useState<string | null>(ru.pending.categories[0]);
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const submittedRef = useRef(false); // the synchronous guard against a double tap; `submitted` is its renderable copy
  const left = useRef(false);

  const leave = () => {
    if (left.current) return;
    left.current = true;
    router.replace("/");
  };

  // A push for a purchase captured after this app instance loaded its data: reload once before deciding it is gone.
  const [reloaded, setReloaded] = useState(false);
  const missing = status === "ready" && !held && !submitted && !found;
  useEffect(() => {
    if (!missing || reloaded) return;
    let cancelled = false;
    void refresh({ silent: true }).finally(() => {
      if (!cancelled) setReloaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [missing, reloaded, refresh]);

  // an unknown, foreign or already resolved purchase (stale link, another device answered): say so and go home
  const gone = status === "ready" && !held && !submitted && (found ? found.status !== "pending" : reloaded);
  useEffect(() => {
    if (!gone || left.current) return;
    left.current = true;
    showNotice(ru.pending.errors.alreadyResolved);
    router.replace("/");
  }, [gone, showNotice, router]);

  const roster = held ? (members[held.household_id] ?? []) : [];
  const per = held ? perPersonRange(held.amount, roster.length).min : 0;

  const description = (writing ? text : (category ?? "")).trim();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // «Поделено ✓» appears only once the server has confirmed; a failure keeps the sheet open with an inline message
  const resolve = async (shared: boolean) => {
    if (!held || !me || submittedRef.current) return;
    if (shared && roster.length === 0) return;
    submittedRef.current = true;
    setSubmitted(true);
    setBusy(true);
    setError(null);
    const ok = await resolvePending(held.id, {
      shared,
      description: description || undefined,
      participant_ids: shared ? roster.map((m) => m.user_id) : undefined,
    });
    setBusy(false);
    if (ok) {
      setOutcome({ shared });
      setOpen(false);
    } else {
      submittedRef.current = false;
      setSubmitted(false);
      setError(ru.pending.errors.resolveInline);
    }
  };

  const dismiss = () => {
    if (submittedRef.current || busy) return;
    submittedRef.current = true; // a second Esc or backdrop tap during the collapse does nothing
    setSubmitted(true);
    setOpen(false);
  };

  return (
    <>
      <HomeScreen />
      {held && homePainted ? (
        <Sheet
          open={open}
          onClose={dismiss}
          onClosed={leave}
          label={ru.pending.sheetLabel}
          outcome={outcome ? "done" : "dismissed"}
          doneLabel={outcome?.shared === false ? ru.pending.doneMine : ru.pending.doneShared}
          radius={44}
          focusFirst={false}
          expandedClassName="max-w-[368px] p-4"
        >
          <PendingCard
            merchant={held.merchant ?? ru.pending.fallbackMerchant}
            amount={held.amount}
            perPerson={per}
            category={category}
            writing={writing}
            text={text}
            choice={choice ?? "shared"}
            onCategory={(name) => {
              setWriting(false);
              setCategory((cur) => (cur === name && !writing ? null : name));
            }}
            onWrite={() => {
              setWriting(true);
              setCategory(null);
            }}
            onText={setText}
            onCommitText={() => (document.activeElement as HTMLElement | null)?.blur()}
            onResolve={(shared) => void resolve(shared)}
            busy={busy}
            canShare={roster.length > 0}
            error={error}
          />
        </Sheet>
      ) : null}
    </>
  );
}
