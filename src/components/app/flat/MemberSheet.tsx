"use client";

import { useState } from "react";
import { Avatar, type AvatarColor } from "@/components/ui/Avatar";
import { ActionRow } from "./ActionRow";
import { CalendarIcon } from "@/components/ui/icons";
import { Pill } from "@/components/ui/Pill";
import { Sheet } from "@/components/ui/Sheet";
import { ru } from "@/lib/i18n/ru";

export type MemberAction = "make_admin" | "remove_admin" | "remove";

/** Admin actions on a neighbour: role change and removal (the second is a two-step tap). */
export function MemberSheet({
  open,
  onClose,
  name,
  color,
  isAdmin,
  canManage,
  error,
  busy,
  onAction,
  onAway,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  color: AvatarColor;
  isAdmin: boolean;
  /** I am an admin: role change and removal are shown. «В отъезде…» is for every member. */
  canManage: boolean;
  error: string | null;
  busy: boolean;
  onAction: (action: MemberAction) => void;
  onAway: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const close = () => {
    setConfirm(false);
    onClose();
  };
  return (
    <Sheet open={open} onClose={close} label={name} expandedClassName="max-w-[358px] p-4">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3 px-1">
          <Avatar name={name} color={color} size={44} decorative />
          <h2 className="text-headline">{name}</h2>
        </div>
        <ActionRow testId="member-away" icon={<CalendarIcon size={20} />} title={ru.flat.awayFor.action} caption={ru.flat.awayFor.actionCaption} onClick={onAway} />
        {canManage ? (
          <>
        <Pill variant="on" size="lg" disabled={busy} onClick={() => onAction(isAdmin ? "remove_admin" : "make_admin")} className="w-full" data-testid="member-role">
          {isAdmin ? ru.flat.member.removeAdmin : ru.flat.member.makeAdmin}
        </Pill>
        {confirm ? (
          <div className="flex items-center gap-3 rounded-pill border border-danger-line bg-card p-[6px] pl-5">
            <span className="flex-1 text-body !text-danger">{ru.flat.removeConfirm}</span>
            <Pill variant="ghost" size="row" disabled={busy} onClick={() => onAction("remove")} className="!bg-danger !text-bg" data-testid="member-remove-confirm">
              {ru.detail.deleteConfirm}
            </Pill>
            <Pill variant="on" size="row" onClick={() => setConfirm(false)}>
              {ru.detail.deleteCancel}
            </Pill>
          </div>
        ) : (
          <Pill variant="ghost" size="lg" disabled={busy} onClick={() => setConfirm(true)} className="w-full border border-danger-line !text-danger" data-testid="member-remove">
            {ru.flat.member.remove}
          </Pill>
        )}
          </>
        ) : null}
        {error ? (
          <p role="alert" data-testid="member-error" className="px-1 text-label text-orange">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
