/** Russian cases the app needs for a housemate's first name. */
export type NameCase = "instr" | "dat" | "gen";

/** с кем / кому / кого: «Расчёт с Айдосом», «Ты → Айдосу», «Kaspi Айдоса». */

/** Names ending in a consonant that belong to women: they do not decline in Russian. */
const INDECLINABLE = new Set(["айгерим", "салтанат", "гульнар", "мариям", "асем", "томирис"]);

const CYRILLIC_NAME = /^[А-ЯЁа-яё]+$/;
const VOWELS = "аеёиоуыэюя";
const HUSHING = "жчшщц";
const VELAR_HUSHING = "гкхжчшщ";

const swap = (name: string, cut: number, tail: string) => name.slice(0, name.length - cut) + tail;

/**
 * Declines a first name. Rules (no gender data, so masculine is assumed for a consonant ending):
 * consonant +ом/+у/+а, -й/-ь -ем/-ю/-я, -а -ой/-е/-ы, -я -ей/-е/-и, -ия -ией/-ии/-ии. Anything else
 * (Latin letters, hyphens, vowel endings like -о, -и) comes back unchanged.
 */
export function decline(raw: string, nameCase: NameCase): string {
  const name = raw.trim();
  if (!CYRILLIC_NAME.test(name) || INDECLINABLE.has(name.toLowerCase())) return name;
  const last = name.slice(-1).toLowerCase();
  const pick = <T,>(a: T, b: T, c: T): T => (nameCase === "instr" ? a : nameCase === "dat" ? b : c);

  if (last === "й" || last === "ь") return swap(name, 1, pick("ем", "ю", "я"));
  if (last === "я") {
    if (name.slice(-2).toLowerCase() === "ия") return swap(name, 1, pick("ей", "и", "и"));
    return swap(name, 1, pick("ей", "е", "и"));
  }
  if (last === "а") {
    const before = name.slice(-2, -1).toLowerCase();
    return swap(name, 1, pick("ой", "е", VELAR_HUSHING.includes(before) ? "и" : "ы"));
  }
  if (VOWELS.includes(last) || last === "ъ") return name;
  return name + pick(HUSHING.includes(last) ? "ем" : "ом", "у", "а");
}
