import { cx } from "./cx";

export type AvatarColor = "blue" | "brown" | "purple" | "me";
export type AvatarSize = 26 | 32 | 40 | 44 | 52;

const colorClass: Record<AvatarColor, string> = {
  blue: "bg-person-blue text-on-person",
  brown: "bg-person-brown text-on-person",
  purple: "bg-person-purple text-on-person",
  me: "bg-lime text-on-lime",
};

const sizeClass: Record<AvatarSize, string> = {
  26: "size-[26px] text-[12px]",
  32: "size-[32px] text-[13px]",
  40: "size-[40px] text-[15px]",
  44: "size-[44px] text-[17px]",
  52: "size-[52px] text-[20px]",
};

export function Avatar({
  name,
  color = "blue",
  size = 40,
  className,
  decorative = false,
}: {
  /** Hide from assistive tech when the name is already announced next to it. */
  decorative?: boolean;
  name: string;
  color?: AvatarColor;
  size?: AvatarSize;
  className?: string;
}) {
  return (
    <span
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": name })}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full font-rounded font-bold",
        colorClass[color],
        sizeClass[size],
        className,
      )}
    >
      {Array.from(name.trim())[0]?.toUpperCase() ?? ""}
    </span>
  );
}
