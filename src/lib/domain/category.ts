export type Category = "bread" | "carrot" | "drop" | "milk" | "meat" | "store" | "home" | "cart";

const RULES: ReadonlyArray<{ category: Category; exact: ReadonlyArray<string>; prefix: ReadonlyArray<string> }> = [
  { category: "bread", exact: ["нан", "лепешка"], prefix: ["хлеб", "булк", "батон"] },
  { category: "carrot", exact: [], prefix: ["овощ", "пияз", "сабиз", "морков", "картош", "помидор"] },
  { category: "drop", exact: ["вода", "воду", "воды", "воде", "су"], prefix: [] },
  { category: "milk", exact: [], prefix: ["молок", "кефир", "сүт", "йогурт"] },
  { category: "meat", exact: ["ет"], prefix: ["мяс", "колбас", "куриц", "говядин", "баранин"] },
  { category: "store", exact: [], prefix: ["магазин", "magnum", "small", "супермаркет", "продукт", "рынок", "базар"] },
];

/** Category of a purchase for its tile icon: monthly bills are «home», otherwise a keyword in the description or merchant, else a cart. */
export function categoryFor(p: { description: string; merchant?: string | null; bill_id?: string | null }): Category {
  if (p.bill_id) return "home";
  const words = `${p.description} ${p.merchant ?? ""}`.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (const rule of RULES) {
    if (words.some((w) => rule.exact.includes(w) || rule.prefix.some((x) => w.startsWith(x)))) return rule.category;
  }
  return "cart";
}
