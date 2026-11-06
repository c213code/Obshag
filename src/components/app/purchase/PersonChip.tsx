import { Avatar, type AvatarColor } from "@/components/ui/Avatar";
import { cx } from "@/components/ui/cx";

/** "На кого" pill (AddPurchase.dc.html .who): avatar + name, lime border when selected, muted when not. */
export function PersonChip({
  name,
  initialsOf,
  color,
  selected,
  onToggle,
}: {
  name: string;
  /** Name the avatar letter comes from (for "Я" it is the user's own name). */
  initialsOf: string;
  color: AvatarColor;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className={cx(
        "flex items-center gap-2 rounded-pill border bg-card py-[6px] pr-[14px] pl-[6px] text-[15px] font-medium",
        "transition-[transform,color,border-color] duration-200 ease-smooth active:scale-[0.97]",
        selected ? "border-lime text-text" : "border-card-2 text-muted",
      )}
    >
      <Avatar
        name={initialsOf}
        color={color}
        size={32}
        decorative
        className={cx("!font-semibold transition-colors duration-200", !selected && "!bg-card-2 !text-muted")}
      />
      {name}
    </button>
  );
}
