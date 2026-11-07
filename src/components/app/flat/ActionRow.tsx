import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRightIcon } from "@/components/ui/icons";
import { cx } from "@/components/ui/cx";

const base =
  "flex w-full items-center gap-3 rounded-pill border border-hairline bg-card p-[6px] pr-5 text-left transition-transform duration-200 ease-smooth active:scale-[0.98]";

/** A capsule row with a round icon, title + caption and a chevron (Invite.dc.html .prow). A button, or a link with `href`. */
export function ActionRow({
  icon,
  title,
  caption,
  href,
  onClick,
  testId,
  tone = "lime",
}: {
  icon: ReactNode;
  title: string;
  caption?: string;
  href?: string;
  onClick?: () => void;
  testId?: string;
  tone?: "lime" | "plain";
}) {
  const inner = (
    <>
      <span aria-hidden="true" className={cx("grid size-[44px] shrink-0 place-items-center rounded-full", tone === "lime" ? "bg-lime-soft text-lime" : "bg-card-2 text-text")}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-headline">{title}</p>
        {caption ? <p className="truncate text-caption">{caption}</p> : null}
      </div>
      <ChevronRightIcon size={20} className="shrink-0 text-muted" />
    </>
  );
  return href ? (
    <Link href={href} data-testid={testId} className={base}>
      {inner}
    </Link>
  ) : (
    <button type="button" data-testid={testId} onClick={onClick} className={base}>
      {inner}
    </button>
  );
}
