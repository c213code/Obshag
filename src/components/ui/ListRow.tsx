import type { ReactNode } from "react";
import { Avatar, type AvatarColor } from "./Avatar";
import { cx } from "./cx";

export function ListRow({
  name,
  avatarColor,
  title,
  caption,
  captionTone = "muted",
  trailing,
  className,
}: {
  name: string;
  avatarColor: AvatarColor;
  title: string;
  caption?: string;
  captionTone?: "muted" | "orange" | "lime";
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex items-center gap-3 rounded-pill border border-hairline bg-card p-[6px]",
        className,
      )}
    >
      <Avatar name={name} color={avatarColor} size={44} decorative />
      <div className="min-w-0 flex-1">
        <p className="truncate text-headline">{title}</p>
        {caption ? (
          <p className={cx("truncate text-caption", captionTone === "orange" && "!text-orange", captionTone === "lime" && "!text-lime")}>{caption}</p>
        ) : null}
      </div>
      {trailing ? <div className="flex shrink-0 items-center pr-1">{trailing}</div> : null}
    </div>
  );
}
