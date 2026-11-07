"use client";

import { useMemo, useState } from "react";
import { useRepo } from "@/components/RepoProvider";
import { Bar } from "@/components/ui/Bar";
import { CardStack } from "@/components/ui/CardStack";
import { CalendarIcon, EditIcon, KeyIcon, UsersIcon } from "@/components/ui/icons";
import { ListRow } from "@/components/ui/ListRow";
import { Pill, PillLink } from "@/components/ui/Pill";
import { Switch } from "@/components/ui/Switch";
import { RepoError } from "@/lib/data/repo";
import { almatyDay } from "@/lib/domain/almaty";
import { isAway } from "@/lib/domain/away";
import { ru } from "@/lib/i18n/ru";
import { useAppActions, useAppData } from "../AppDataProvider";
import { Screen } from "../Screen";
import { avatarColorFor } from "../avatars";
import { useHouseholdCards } from "../home/useHouseholdCards";
import { ActionRow } from "./ActionRow";
import { AwaySheet } from "./AwaySheet";
import { InviteCard } from "./InviteCard";
import { MemberSheet, type MemberAction } from "./MemberSheet";
import { ProfileSheet } from "./ProfileSheet";
import { formatAway } from "./dates";

const writeError = (e: unknown, fallback: string): string => {
  if (e instanceof RepoError) {
    if (e.code === "not_settled") return ru.flat.errors.settleFirst;
    if (e.code === "forbidden") return ru.flat.adminOnly;
  }
  return fallback;
};

/** Квартира tab, per Invite.dc.html: invite card, neighbours, away, profile, reminders, automation, leaving. */
export function FlatScreen() {
  const repo = useRepo();
  const { me, households, members, purchases, activeId } = useAppData();
  const { signOut, setRemindersEnabled, refresh, refreshMembers, switchHousehold, showNotice } = useAppActions();
  const cards = useHouseholdCards(me, households, members, purchases);
  const today = useMemo(() => almatyDay(new Date()).date, []);

  const [leaving, setLeaving] = useState(false);
  const [leaveAsk, setLeaveAsk] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [sheet, setSheet] = useState<"away" | "profile" | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [memberOpen, setMemberOpen] = useState(false);
  const [memberBusy, setMemberBusy] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [awayError, setAwayError] = useState<string | null>(null);
  const [rotateAsk, setRotateAsk] = useState(false);

  const household = households.find((h) => h.id === activeId);
  if (!me || !household) return null;

  const roster = members[household.id] ?? [];
  const mine = roster.find((m) => m.user_id === me.id);
  const iAmAdmin = mine?.role === "admin";
  const remindersOn = mine?.reminders_enabled !== false;
  const away = mine?.away_until && isAway(mine.away_until, today) ? mine.away_until : null;
  const code = household.invite_code.toUpperCase();
  const picked = roster.find((m) => m.user_id === memberId) ?? null;

  const doSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut(); // on success the guard sends the user to /login; on failure a notice explains
    } finally {
      setSigningOut(false);
    }
  };

  const doLeave = async () => {
    if (leaving) return;
    setLeaving(true);
    setLeaveError(null);
    try {
      await repo.leaveHousehold(household.id);
      await refresh({ silent: true }); // the guard moves on when no household is left
    } catch (e) {
      setLeaveAsk(false);
      setLeaveError(e instanceof RepoError && e.code === "invalid" ? ru.flat.errors.lastAdmin : writeError(e, ru.flat.errors.generic));
    } finally {
      setLeaving(false);
    }
  };

  const doMemberAction = async (action: MemberAction) => {
    if (!picked || memberBusy) return;
    setMemberBusy(true);
    setMemberError(null);
    try {
      if (action === "remove") await repo.removeMember(household.id, picked.user_id);
      else await repo.setMemberRole(household.id, picked.user_id, action === "make_admin" ? "admin" : "member");
      await refreshMembers(household.id);
      void refresh({ silent: true });
      setMemberOpen(false);
    } catch (e) {
      setMemberError(e instanceof RepoError && e.code === "invalid" ? ru.flat.errors.lastAdmin : writeError(e, ru.flat.errors.generic));
    } finally {
      setMemberBusy(false);
    }
  };

  const saveAway = async (until: string | null) => {
    setBusy(true);
    setAwayError(null);
    try {
      await repo.setAway(household.id, until);
      await refreshMembers(household.id);
      setSheet(null);
    } catch (e) {
      setAwayError(e instanceof RepoError && e.code === "invalid" ? ru.flat.away.invalid : ru.flat.errors.generic);
    } finally {
      setBusy(false);
    }
  };

  const saveProfile = async (input: { display_name: string; kaspi_phone: string }): Promise<string | null> => {
    try {
      await repo.upsertProfile(input);
    } catch {
      return ru.flat.errors.profileFailed;
    }
    await refresh({ silent: true });
    setSheet(null);
    showNotice(ru.flat.profile.saved);
    return null;
  };

  const rotate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await repo.rotateInviteCode(household.id);
      await refresh({ silent: true });
      setRotateAsk(false);
    } catch {
      setRotateAsk(false);
      showNotice(ru.flat.errors.rotateFailed);
    } finally {
      setBusy(false);
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

      {cards.length >= 2 ? (
        <div aria-label={ru.flat.households} className="-mt-1">
          <CardStack cards={cards} frontId={household.id} onFrontChange={(id) => id !== activeId && void switchHousehold(id)} />
        </div>
      ) : null}

      <InviteCard code={code} householdName={household.name} />

      <h2 className="px-[6px] pt-1 text-headline">{ru.flat.neighbors}</h2>
      <ul className="flex flex-col gap-2">
        {roster.map((m) => {
          const isMe = m.user_id === me.id;
          const memberAway = m.away_until && isAway(m.away_until, today) ? m.away_until : null;
          const admin = m.role === "admin";
          const noKaspi = !m.profile.kaspi_phone;
          const caption = noKaspi
            ? ru.flat.noKaspi
            : memberAway
              ? `${admin ? `${ru.flat.admin} · ` : ""}${ru.flat.awayUntil(formatAway(memberAway))}`
              : admin
                ? ru.flat.admin
                : ru.flat.hasKaspi;
          const row = (
            <ListRow
              name={m.profile.display_name}
              avatarColor={avatarColorFor(m.profile, me.id)}
              title={isMe ? `${m.profile.display_name} (${ru.flat.you})` : m.profile.display_name}
              caption={caption}
              captionTone={noKaspi ? "orange" : "muted"}
              className={noKaspi ? "!border-wait-line" : undefined}
            />
          );
          return (
            <li key={m.user_id} data-testid={`member-${m.profile.display_name}`}>
              {iAmAdmin && !isMe ? (
                <button
                  type="button"
                  aria-label={`${m.profile.display_name}: ${ru.flat.member.rowHint}`}
                  onClick={() => {
                    setMemberId(m.user_id);
                    setMemberError(null);
                    setMemberOpen(true);
                  }}
                  className="block w-full text-left transition-transform duration-200 ease-smooth active:scale-[0.98]"
                >
                  {row}
                </button>
              ) : (
                row
              )}
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
        <Switch checked={remindersOn} onChange={(next) => void setRemindersEnabled(household.id, next)} labelledBy="reminders-label" className="mr-[14px]" />
      </div>

      <ActionRow
        testId="away-row"
        icon={<CalendarIcon size={20} />}
        title={ru.flat.away.button}
        caption={away ? ru.flat.awayUntil(formatAway(away)) : ru.flat.away.hint}
        onClick={() => {
          setAwayError(null);
          setSheet("away");
        }}
      />
      <ActionRow testId="profile-row" icon={<EditIcon size={20} />} title={ru.flat.profile.row} caption={me.display_name} onClick={() => setSheet("profile")} />

      <h2 className="px-[6px] pt-1 text-headline">{ru.flat.sectionApps}</h2>
      <ActionRow testId="shortcut-row" href="/settings/shortcut" icon={<KeyIcon size={20} />} title={ru.shortcut.row} caption={ru.shortcut.rowCaption} />

      <div className="flex flex-col gap-2 pt-2">
        {iAmAdmin ? (
          rotateAsk ? (
            <div className="flex items-center gap-3 rounded-pill border border-hairline bg-card p-[6px] pl-5">
              <span className="flex-1 text-body">{ru.flat.rotateConfirm}</span>
              <Pill variant="lime" size="row" onClick={rotate} disabled={busy} data-testid="rotate-confirm">
                {busy ? ru.flat.rotating : ru.flat.rotate}
              </Pill>
              <Pill variant="on" size="row" onClick={() => setRotateAsk(false)}>
                {ru.detail.deleteCancel}
              </Pill>
            </div>
          ) : (
            <Pill variant="on" size="lg" className="w-full" onClick={() => setRotateAsk(true)} data-testid="rotate-code">
              {ru.flat.rotate}
            </Pill>
          )
        ) : null}
        <PillLink href="/household" variant="on" size="lg" className="w-full">
          {ru.flat.addAnother}
        </PillLink>
        {leaveAsk ? (
          <div className="flex items-center gap-3 rounded-pill border border-danger-line bg-card p-[6px] pl-5">
            <span className="flex-1 text-body !text-danger">{ru.flat.leaveConfirm}</span>
            <Pill variant="ghost" size="row" onClick={doLeave} disabled={leaving} className="!bg-danger !text-bg" data-testid="leave-confirm">
              {leaving ? ru.flat.leaving : ru.flat.leave}
            </Pill>
            <Pill variant="on" size="row" onClick={() => setLeaveAsk(false)}>
              {ru.detail.deleteCancel}
            </Pill>
          </div>
        ) : (
          <Pill variant="ghost" size="lg" className="w-full border border-danger-line !text-danger" onClick={() => setLeaveAsk(true)} data-testid="leave-household">
            {ru.flat.leave}
          </Pill>
        )}
        {leaveError ? (
          <p role="alert" data-testid="leave-error" className="px-[6px] text-label text-orange">
            {leaveError}
          </p>
        ) : null}
        <Pill variant="ghost" size="lg" className="w-full border border-orange/50 !text-orange" onClick={doSignOut} disabled={signingOut}>
          {signingOut ? ru.flat.signingOut : ru.flat.signOut}
        </Pill>
      </div>

      <MemberSheet
        open={memberOpen}
        onClose={() => setMemberOpen(false)}
        name={picked?.profile.display_name ?? ""}
        color={picked ? avatarColorFor(picked.profile, me.id) : "blue"}
        isAdmin={picked?.role === "admin"}
        error={memberError}
        busy={memberBusy}
        onAction={(a) => void doMemberAction(a)}
      />
      <AwaySheet open={sheet === "away"} onClose={() => setSheet(null)} today={today} current={away} busy={busy} error={awayError} onSave={(u) => void saveAway(u)} />
      <ProfileSheet open={sheet === "profile"} onClose={() => setSheet(null)} initialName={me.display_name} initialPhone={me.kaspi_phone} onSave={saveProfile} />
    </Screen>
  );
}
