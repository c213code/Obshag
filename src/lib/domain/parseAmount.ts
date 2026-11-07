import { MAX_AMOUNT } from "./schemas";

export { MAX_AMOUNT };

/**
 * Lenient amount parser for what an iOS Shortcut sends: "6 000,00 ₸", "₸6,000.00", "KZT 6,000.00", 6000, "6000.5".
 * Returns whole tenge (half up) in 1..MAX_AMOUNT, or null for garbage, zero, negatives and too large values.
 */
export function parseAmount(input: unknown): number | null {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    return finish(input);
  }
  if (typeof input !== "string") return null;
  if (input.length > 64) return null;
  // drop currency marks, then every kind of space (NBSP, thin, narrow NBSP)
  const s = input
    .replace(/kzt|тг|тенге|₸/gi, "")
    .replace(/[\s   ]/g, "");
  if (s === "" || s.startsWith("-") || s.startsWith("−")) return null;
  if (!/^[0-9.,]+$/.test(s)) return null;

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  const last = Math.max(lastDot, lastComma);
  if (last === -1) return finish(Number(s));

  const sep = s[last];
  const other = sep === "." ? "," : ".";
  const head = s.slice(0, last);
  const tail = s.slice(last + 1);
  const mixed = head.includes(other);
  const repeated = head.includes(sep);
  // "1,234" / "1.234": exactly three digits after the only separator and a non-zero head = grouping
  const grouping = !mixed && !repeated && tail.length === 3 && head !== "" && head !== "0";

  if (repeated && !mixed) {
    // "1.234.567": the separator only groups thousands
    if (!s.split(sep).slice(1).every((g) => g.length === 3)) return null;
    return finish(Number(s.split(sep).join("")));
  }
  if (grouping) return finish(Number(head + tail));
  if (head.includes(sep) || tail.includes(other) || tail.includes(sep)) return null;
  const intPart = head.split(other).join("");
  if (intPart === "" && tail === "") return null;
  return finish(Number(`${intPart || "0"}.${tail || "0"}`));
}

function finish(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.floor(value + 0.5);
  return rounded >= 1 && rounded <= MAX_AMOUNT ? rounded : null;
}
