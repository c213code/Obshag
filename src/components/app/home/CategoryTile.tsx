import type { ReactNode } from "react";
import { BreadIcon, CarrotIcon, CartIcon, DropIcon, HomeIcon, MeatIcon, MilkIcon, StoreIcon } from "@/components/ui/icons";
import { cx } from "@/components/ui/cx";
import type { Category } from "@/lib/domain/category";

const GLYPH: Record<Category, ReactNode> = {
  bread: <BreadIcon size={20} />,
  carrot: <CarrotIcon size={20} />,
  drop: <DropIcon size={20} />,
  milk: <MilkIcon size={20} />,
  meat: <MeatIcon size={20} />,
  store: <StoreIcon size={20} />,
  home: <HomeIcon size={20} />,
  cart: <CartIcon size={20} />,
};

const TONE: Record<Category, string> = {
  bread: "bg-tile-sand text-on-tile-sand",
  carrot: "bg-orange-soft text-orange",
  drop: "bg-blue-soft text-blue",
  milk: "bg-tile-violet text-on-tile-violet",
  meat: "bg-tile-rose text-on-tile-rose",
  store: "bg-tile-green text-on-tile-green",
  home: "bg-lime-soft text-lime",
  cart: "bg-lime-soft text-lime",
};

/** Coloured rounded tile with the category glyph of a purchase. */
export function CategoryTile({ category }: { category: Category }) {
  return (
    <span aria-hidden="true" data-category={category} className={cx("grid size-[44px] shrink-0 place-items-center rounded-[14px]", TONE[category])}>
      {GLYPH[category]}
    </span>
  );
}
