"use client";

import { useState } from "react";
import { useRepo } from "@/components/RepoProvider";
import { cx } from "@/components/ui/cx";
import { Pill } from "@/components/ui/Pill";
import { TextField } from "@/components/ui/TextField";
import { RepoError } from "@/lib/data/repo";
import { MONTHS_NOM, monthOf } from "@/lib/domain/duty";
import { cooldownLeft, instrumental, sharePerPerson, waterMonth, waterPlan, type WaterMode } from "@/lib/domain/dutyEvents";
import { formatNumber, formatTenge } from "@/lib/format/money";
import { ru } from "@/lib/i18n/ru";
import { useAppActions } from "../AppDataProvider";
import { DutySheet } from "./DutySheet";
import { Dot } from "./parts";
import type { EventDutyView } from "./useEventDuty";

const btn =
  "inline-flex h-10 items-center rounded-[20px] px-4 text-[15px] font-semibold transition-[transform,opacity] duration-200 ease-smooth active:scale-[0.97] disabled:pointer-events-none disabled:opacity-60";

/** One bottle: a cap and a glass filled to the brim or empty. */
function Bottle({ full }: { full: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <span className="h-[7px] w-3 rounded-[2px] bg-aqua-fill" />
      <span className="relative block h-16 w-[30px] overflow-hidden rounded-[9px] bg-aqua-glass">
        <span className="absolute inset-x-0 bottom-0 bg-aqua-fill transition-[height] duration-300 ease-smooth" style={{ height: full ? "100%" : "0%" }} />
      </span>
    </div>
  );
}

function Glyphs({ filled, selected }: { filled: number; selected: boolean }) {
  return (
    <div className="flex gap-1" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className={cx("h-[22px] w-3 rounded-[4px]", i < filled ? (selected ? "bg-aqua-pick-fill" : "bg-aqua-fill") : "bg-bottle-empty")} />
      ))}
    </div>
  );
}

/** «Вода»: bottles left, who brings next, «Кто идёт» (alone / two), the month and who carried how often. */
export function WaterPanel({ ev }: { ev: EventDutyView }) {
  const repo = useRepo();
  const { showNotice, refresh } = useAppActions();
  const { duty, me, current, events, today, nowMs } = ev;
  const price = duty.price_per_liter ?? 20;
  const liters = duty.bottle_liters ?? 5;
  const total = duty.bottles_total ?? 4;
  const full = Math.min(duty.bottles_full ?? 0, total);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<WaterMode>("pair");
  const [pickedPartner, setPartner] = useState<string | null>(null);
  const [payerChoice, setPayerChoice] = useState<"me" | "partner" | "other">("me");
  const [pickedOther, setPickedOther] = useState<string | null>(null);
  const [priceOpen, setPriceOpen] = useState(false);
  const [priceText, setPriceText] = useState("");

  const others = ev.roster.filter((m) => m.active && me && m.user_id !== me.id);
  const partner = others.some((m) => m.user_id === pickedPartner) ? pickedPartner : (others.find((m) => m.user_id === ev.queue.find((q) => q !== me?.id))?.user_id ?? others[0]?.user_id ?? null);
  const effective: WaterMode = mode === "pair" && partner ? "pair" : "alone";
  const alone = waterPlan("alone", liters, price);
  const pair = waterPlan("pair", liters, price);
  const plan = effective === "pair" ? pair : alone;
  // «Кто платил?»: me (default) / the partner / somebody else. The queue still records who went, only the purchase payer changes.
  const strangers = others.filter((m) => m.user_id !== (effective === "pair" ? partner : null));
  const otherPayer = strangers.some((m) => m.user_id === pickedOther) ? pickedOther : (strangers[0]?.user_id ?? null);
  const payerKind = payerChoice === "partner" && effective !== "pair" ? "me" : payerChoice === "other" && !otherPayer ? "me" : payerChoice;
  const payerId = payerKind === "partner" ? partner : payerKind === "other" ? otherPayer : (me?.id ?? null);
  const homeCount = Math.max(1, ev.roster.filter((m) => m.active && !(m.away_until && m.away_until >= today)).length);
  const each = sharePerPerson(plan.amount, homeCount);
  const eachText = each.min === each.max ? formatTenge(each.min) : `${formatNumber(each.min)}–${formatTenge(each.max)}`;

  const month = monthOf(today);
  const stats = waterMonth(events, month, price, duty.order);
  const monthName = MONTHS_NOM[Number(month.slice(5, 7)) - 1].toLowerCase();
  const curWeek = Math.min(3, Math.floor((Number(today.slice(8, 10)) - 1) / 7));
  const name = (id: string | null) => (id && me && id === me.id ? ru.duty.water.you : ev.nameOf(id));

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      showNotice(e instanceof RepoError && e.code === "rate_limited" ? ru.duty.water.emptyCooldown : ru.duty.event.failed);
    } finally {
      setBusy(false);
    }
  };
  const brought = () =>
    run(async () => {
      await repo.waterBrought(duty.id, effective === "pair" ? partner : null, payerId && payerId !== me?.id ? payerId : null);
      await ev.reload();
      void refresh({ silent: true });
      showNotice(ru.duty.water.broughtOk(formatTenge(plan.amount)));
    });
  const empty = () =>
    run(async () => {
      if (cooldownLeft(events, "empty", nowMs) > 0) {
        showNotice(ru.duty.water.emptyCooldown);
        return;
      }
      const e = await repo.waterEmpty(duty.id);
      await ev.reload();
      showNotice(ru.duty.water.emptyOk);
      void ev.notify(e.id);
    });
  const used = () =>
    run(async () => {
      await repo.waterBottleUsed(duty.id);
      await ev.reload();
    });
  const savePrice = () =>
    run(async () => {
      try {
        await repo.setWaterPrice(duty.id, Number(priceText));
        await ev.reload();
        setPriceOpen(false);
      } catch {
        showNotice(ru.duty.water.priceFailed);
      }
    });

  return (
    <>
      <section aria-label={ru.duty.water.bottlesLabel(full, total)} data-testid="water-card" className="relative flex h-[196px] flex-col justify-between overflow-hidden rounded-[28px] bg-aqua px-5 py-[18px] text-aqua-text">
        <div className="absolute right-4 bottom-4 flex items-end gap-[6px]" data-testid="water-bottles" role="img" aria-label={ru.duty.water.bottlesLabel(full, total)}>
          {Array.from({ length: total }, (_, i) => (
            <Bottle key={i} full={i < full} />
          ))}
        </div>
        <div className="relative flex items-center gap-2 text-[13px] font-medium text-aqua-muted">
          <span aria-hidden="true" className={cx("size-2 rounded-full", full <= 1 ? "bg-duty-orange" : "bg-aqua-fill")} />
          <span data-testid="water-left">{full === 0 ? ru.duty.water.none(total) : ru.duty.water.left(full, total, full * liters)}</span>
          {full > 0 ? (
            <button type="button" data-testid="water-used" disabled={busy} onClick={used} className="ml-1 rounded-full bg-aqua-glass px-[10px] py-[3px] text-[12px] font-semibold text-aqua-text transition-transform active:scale-[0.96]">
              −1
              <span className="sr-only"> {ru.duty.water.used}</span>
            </button>
          ) : null}
        </div>
        <div className="relative">
          <div className="text-[14px] text-aqua-muted">{ru.duty.water.next}</div>
          <div data-testid="water-current" className="truncate text-[26px] leading-[1.15] font-extrabold tracking-[-0.5px]">
            {current ? name(current) : "—"}
          </div>
        </div>
        <div className="relative flex gap-2">
          <button type="button" data-testid="water-empty" disabled={busy} onClick={empty} className={cx(btn, "bg-aqua-text text-aqua")}>
            {ru.duty.water.empty}
          </button>
          <button type="button" data-testid="water-brought" disabled={busy} onClick={brought} className={cx(btn, "bg-aqua-btn text-aqua-text")}>
            {ru.duty.water.brought}
          </button>
        </div>
      </section>

      <section aria-labelledby="water-who-h" className="rounded-[24px] bg-card p-[14px]">
        <div className="flex items-baseline justify-between px-[2px] pb-[10px]">
          <h2 id="water-who-h" className="text-[17px] font-bold">
            {ru.duty.water.who}
          </h2>
          {ev.isAdmin ? (
            <button type="button" data-testid="water-price" onClick={() => { setPriceText(String(price)); setPriceOpen(true); }} className="text-[13px] text-muted underline decoration-dotted underline-offset-4">
              {ru.duty.water.price(price)}
            </button>
          ) : (
            <span className="text-[13px] text-muted">{ru.duty.water.price(price)}</span>
          )}
        </div>
        <div role="radiogroup" aria-label={ru.duty.water.who} className="grid grid-cols-2 gap-2">
          {(["alone", "pair"] as const).map((m) => {
            const p = m === "alone" ? alone : pair;
            const on = effective === m;
            const disabled = m === "pair" && !partner;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={disabled}
                data-testid={`water-mode-${m}`}
                onClick={() => setMode(m)}
                className={cx(
                  "rounded-[18px] text-left transition-[transform,background-color,border-color] duration-200 ease-smooth active:scale-[0.98] disabled:opacity-50",
                  on ? "border-2 border-aqua-pick-line bg-aqua-pick p-[11px] text-aqua-pick-text" : "border border-outline bg-card p-3 text-text",
                )}
              >
                <Glyphs filled={p.bottles} selected={on} />
                <div className="mt-2 text-[15px] font-bold">
                  {m === "alone" ? ru.duty.water.alone : ru.duty.water.pair} · {ru.duty.water.bottles(p.bottles)}
                </div>
                <div className={cx("mt-[2px] text-[13px]", on ? "text-aqua-pick-muted" : "text-muted")}>
                  {ru.duty.water.sub(p.liters, formatTenge(p.amount))}
                  {m === "pair" && partner ? ` · ${ru.duty.water.withName(instrumental(ev.nameOf(partner)))}` : ""}
                </div>
              </button>
            );
          })}
        </div>
        {mode === "pair" && others.length > 1 ? (
          <div role="radiogroup" aria-label={ru.duty.water.partner} data-testid="water-partners" className="mt-[10px] flex flex-wrap gap-2">
            {others.map((m) => (
              <button
                key={m.user_id}
                type="button"
                role="radio"
                aria-checked={partner === m.user_id}
                onClick={() => setPartner(m.user_id)}
                className={cx(
                  "inline-flex h-8 items-center gap-[6px] rounded-full border pr-3 pl-1 text-[13px] font-medium transition-transform active:scale-[0.97]",
                  partner === m.user_id ? "border-aqua-pick-line bg-aqua-pick text-aqua-pick-text" : "border-outline text-muted",
                )}
              >
                <Dot name={ev.nameOf(m.user_id)} tone={ev.toneOf(m.user_id)} size={24} fontSize={11} />
                {ev.nameOf(m.user_id)}
              </button>
            ))}
          </div>
        ) : null}
        <div className="mt-[10px] flex flex-col gap-2" data-testid="water-payer">
          <span className="px-[2px] text-[13px] text-muted">{ru.duty.water.payer}</span>
          <div role="radiogroup" aria-label={ru.duty.water.payer} className="flex flex-wrap gap-2">
            {([
              { k: "me", label: ru.duty.water.payerMe, show: true },
              { k: "partner", label: partner ? ev.nameOf(partner) : "", show: effective === "pair" && !!partner },
              { k: "other", label: ru.duty.water.payerOther, show: strangers.length > 0 },
            ] as const)
              .filter((o) => o.show)
              .map((o) => (
                <button
                  key={o.k}
                  type="button"
                  role="radio"
                  aria-checked={payerKind === o.k}
                  data-testid={`water-payer-${o.k}`}
                  onClick={() => setPayerChoice(o.k)}
                  className={cx(
                    "inline-flex h-8 items-center rounded-full border px-3 text-[13px] font-medium transition-[transform,background-color,border-color] duration-200 ease-smooth active:scale-[0.97]",
                    payerKind === o.k ? "border-aqua-pick-line bg-aqua-pick text-aqua-pick-text" : "border-outline text-muted",
                  )}
                >
                  {o.label}
                </button>
              ))}
          </div>
          {payerKind === "other" && strangers.length > 0 ? (
            <div role="radiogroup" aria-label={ru.duty.water.payerOtherLabel} data-testid="water-payer-others" className="flex flex-wrap gap-2">
              {strangers.map((m) => (
                <button
                  key={m.user_id}
                  type="button"
                  role="radio"
                  aria-checked={otherPayer === m.user_id}
                  onClick={() => setPickedOther(m.user_id)}
                  className={cx(
                    "inline-flex h-8 items-center gap-[6px] rounded-full border pr-3 pl-1 text-[13px] font-medium transition-transform active:scale-[0.97]",
                    otherPayer === m.user_id ? "border-aqua-pick-line bg-aqua-pick text-aqua-pick-text" : "border-outline text-muted",
                  )}
                >
                  <Dot name={ev.nameOf(m.user_id)} tone={ev.toneOf(m.user_id)} size={24} fontSize={11} />
                  {ev.nameOf(m.user_id)}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <p data-testid="water-hint" className="mt-[10px] px-[2px] text-[12px] text-muted">
          {ru.duty.water.hint(formatTenge(plan.amount), eachText)}
        </p>
      </section>

      <div className="grid grid-cols-2 gap-[10px]">
        <section className="rounded-[22px] bg-card p-[14px]">
          <div className="text-[12px] text-muted">{ru.duty.water.month(monthName)}</div>
          <div data-testid="water-month-liters" className="text-[22px] leading-[1.2] font-extrabold tracking-[-0.4px]">
            {ru.duty.water.liters(stats.liters)}
          </div>
          <div className="text-[12px] text-muted">{ru.duty.water.onAll(formatTenge(stats.amount))}</div>
          <div className="mt-2 flex h-[26px] items-end gap-[3px]" aria-hidden="true">
            {stats.weeks.map((w, i) => (
              <span key={i} className={cx("flex-1 rounded-[3px]", i === curWeek ? "bg-aqua-bar-on" : "bg-aqua-bar")} style={{ height: `${Math.max(w * 100, stats.liters ? 12 : 8)}%` }} />
            ))}
          </div>
        </section>
        <section className="rounded-[22px] bg-card p-[14px]">
          <div className="text-[12px] text-muted">{ru.duty.water.carried}</div>
          {stats.carried.length === 0 ? (
            <div className="mt-2 text-[13px] text-muted">{ru.duty.water.carriedNone}</div>
          ) : (
            <ul data-testid="water-carried" className="mt-2 flex flex-col gap-[6px] text-[13px]">
              {stats.carried.slice(0, 4).map((c) => (
                <li key={c.user_id} className="flex items-center gap-[6px]">
                  <Dot name={ev.nameOf(c.user_id)} tone={ev.toneOf(c.user_id)} size={20} fontSize={10} />
                  <span className="min-w-0 flex-1 truncate">{name(c.user_id)}</span>
                  <b className="font-bold">{c.count}</b>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <DutySheet open={priceOpen} onClose={() => setPriceOpen(false)} label={ru.duty.water.priceEdit} title={ru.duty.water.priceEdit} testId="water-price-sheet">
        <TextField label={ru.duty.water.priceEdit} inputMode="numeric" value={priceText} onChange={(e) => setPriceText(e.target.value.replace(/\D/g, "").slice(0, 4))} />
        <Pill variant="lime" size="lg" disabled={busy || !priceText || Number(priceText) < 1} onClick={savePrice} data-testid="water-price-save" className="w-full">
          {ru.duty.water.priceSave}
        </Pill>
      </DutySheet>
    </>
  );
}
