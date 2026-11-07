"use client";

import { useEffect, useRef, useState } from "react";
import { Bar } from "@/components/ui/Bar";
import Link from "next/link";
import { ChevronRightIcon, KeyIcon, UsersIcon } from "@/components/ui/icons";
import { ListRow } from "@/components/ui/ListRow";
import { Pill, PillLink } from "@/components/ui/Pill";
import { ru } from "@/lib/i18n/ru";
import { formatInviteCode } from "@/lib/domain/inviteCode";
import { useAppActions, useAppData } from "../AppDataProvider";
import { Screen } from "../Screen";
import { avatarColorFor } from "../avatars";

const formatAway = (iso: string) => new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit" }).format(new Date(iso));

/** Квартира tab (slice 1 placeholder, styled after Invite.dc.html): invite code, housemates, sign out. */
export function FlatScreen() {
  const { me, households, members, activeId } = useAppData();
  const { signOut, setRemindersEnabled } = useAppActions();
  const [copied, setCopied] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);
  const household = households.find((h) => h.id === activeId);
  if (!me || !household) return null;

  const code = household.invite_code.toUpperCase();
  const roster = members[household.id] ?? [];
  const remindersOn = roster.find((m) => m.user_id === me.id)?.reminders_enabled !== false;

  const share = async () => {
    const url = `${window.location.origin}/join/${encodeURIComponent(code)}`;
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: household.name, text: ru.flat.shareText(household.name), url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // the share sheet was dismissed, nothing to do
    }
  };

  const leave = async () => {
    if (leaving) return;
    setLeaving(true);
    try {
      await signOut(); // on success the guard sends the user to /login; on failure a notice explains
    } finally {
      setLeaving(false);
    }
  };

  return (
    <Screen topOffset={54} className="!gap-[14px]">
      <Bar className="self-start pr-5">
        <span className="grid size-[44px] shrink-0 place-items-center rounded-full bg-card-2 text-text">
          <UsersIcon />
        </span>
        <h1 className="text-headline">{household.name}</h1>
      </Bar>

      <section aria-label={ru.flat.inviteCode} className="relative flex flex-col gap-3 overflow-hidden rounded-lg bg-lime p-5 text-on-lime">
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 170 170"
          className="pointer-events-none absolute -top-10 -right-10 size-[170px]"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.08"
        >
          <circle cx="85" cy="85" r="76" strokeWidth="20" />
        </svg>
        <span className="relative text-label">{ru.flat.inviteCode}</span>
        <p
          data-testid="invite-code"
          aria-label={code}
          className="relative font-rounded text-[30px] leading-[1.1] font-bold tracking-[0.02em] whitespace-nowrap tabular-nums"
        >
          {formatInviteCode(code)}
        </p>
        <div className="relative flex gap-2 rounded-pill bg-on-lime/[0.08] p-[5px]">
          <button
            type="button"
            onClick={share}
            className="flex-1 rounded-pill bg-on-lime p-3 text-[15px] font-semibold text-lime transition-transform duration-200 ease-smooth active:scale-[0.97]"
          >
            {copied ? ru.flat.copied : ru.flat.share}
          </button>
        </div>
      </section>

      <h2 className="px-[6px] pt-1 text-headline">{ru.flat.neighbors}</h2>
      <ul className="flex flex-col gap-2">
        {roster.map((m) => {
          const isMe = m.user_id === me.id;
          const caption = m.away_until
            ? ru.flat.awayUntil(formatAway(m.away_until))
            : !m.profile.kaspi_phone
              ? ru.flat.noKaspi
              : m.role === "admin"
                ? ru.flat.admin
                : ru.flat.hasKaspi;
          return (
            <li key={m.user_id}>
              <ListRow
                name={m.profile.display_name}
                avatarColor={avatarColorFor(m.profile, me.id)}
                title={isMe ? `${m.profile.display_name} (${ru.flat.you})` : m.profile.display_name}
                caption={caption}
                captionTone={!m.profile.kaspi_phone && !m.away_until ? "orange" : "muted"}
              />
            </li>
          );
        })}
      </ul>

      <div className="flex items-center gap-3 rounded-pill border border-hairline bg-card py-[6px] pr-[6px] pl-5">
        <div className="min-w-0 flex-1">
          <p id="reminders-label" className="text-body">
            {ru.flat.reminders}
          </p>
          <p className="text-caption">{ru.flat.remindersCaption}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={remindersOn}
          aria-labelledby="reminders-label"
          onClick={() => void setRemindersEnabled(household.id, !remindersOn)}
          className={`relative mr-[14px] h-[30px] w-[50px] shrink-0 rounded-[15px] transition-colors duration-200 ease-smooth ${remindersOn ? "bg-lime" : "bg-card-2"}`}
        >
          <span
            aria-hidden="true"
            className={`absolute top-[3px] left-[3px] size-[24px] rounded-full transition-transform duration-200 ease-smooth ${remindersOn ? "translate-x-[20px] bg-on-lime" : "translate-x-0 bg-muted"}`}
          />
        </button>
      </div>

      <h2 className="px-[6px] pt-1 text-headline">{ru.flat.sectionApps}</h2>
      <Link
        href="/settings/shortcut"
        data-testid="shortcut-row"
        className="flex items-center gap-3 rounded-pill border border-hairline bg-card p-[6px] transition-transform duration-200 ease-smooth active:scale-[0.98]"
      >
        <span aria-hidden="true" className="grid size-[44px] shrink-0 place-items-center rounded-full bg-lime-soft text-lime">
          <KeyIcon size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-headline">{ru.shortcut.row}</p>
          <p className="truncate text-caption">{ru.shortcut.rowCaption}</p>
        </div>
        <ChevronRightIcon size={20} className="mr-2 shrink-0 text-muted" />
      </Link>

      <div className="flex flex-col gap-2 pt-2">
        <PillLink href="/household" variant="on" size="lg" className="w-full">
          {ru.flat.addAnother}
        </PillLink>
        <Pill variant="ghost" size="lg" className="w-full border border-orange/50 !text-orange" onClick={leave} disabled={leaving}>
          {leaving ? ru.flat.signingOut : ru.flat.signOut}
        </Pill>
      </div>
    </Screen>
  );
}
