import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import { cx } from "./cx";

export type PillVariant = "ghost" | "on" | "lime";
export type PillSize = "sm" | "md" | "lg" | "bar";

export const pillVariantClass: Record<PillVariant, string> = {
  ghost: "text-muted",
  on: "bg-card-2 text-text",
  // disabled lime is a flat, translucent lime with its own on-lime text (not a whole-element fade, which turns muddy olive)
  lime: "bg-lime text-on-lime disabled:bg-lime/35 disabled:text-on-lime",
};

export const pillSizeClass: Record<PillSize, string> = {
  sm: "h-8 px-3 text-label",
  md: "h-11 px-4 text-headline",
  lg: "h-12 px-6 text-headline",
  /** Pill inside a Bar (Segmented): 42px tall, 15/600, per AddPurchase.dc.html. */
  bar: "h-[42px] px-4 text-[15px] font-semibold",
};

export function pillClass(variant: PillVariant, size: PillSize, extra?: string) {
  return cx(
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-pill whitespace-nowrap",
    "transition-[transform,opacity] duration-200 ease-smooth active:scale-[0.97]",
    "disabled:pointer-events-none",
    variant !== "lime" && "disabled:opacity-40",
    pillSizeClass[size],
    pillVariantClass[variant],
    extra,
  );
}

type CommonProps = { variant?: PillVariant; size?: PillSize; className?: string };

export type PillProps = CommonProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className">;

export function Pill({ variant = "ghost", size = "md", className, type = "button", ...rest }: PillProps) {
  return <button type={type} className={pillClass(variant, size, className)} {...rest} />;
}

export type PillLinkProps = CommonProps &
  Omit<ComponentProps<typeof Link>, "className"> & { children: ReactNode };

/** Link-rendered Pill. */
export function PillLink({ variant = "ghost", size = "md", className, ...rest }: PillLinkProps) {
  return <Link className={pillClass(variant, size, className)} {...rest} />;
}
