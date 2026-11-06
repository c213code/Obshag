const NBSP = " ";
const MINUS = "−";

export type FormatTengeOptions = {
  /** Prefix positive amounts with "+". Negative amounts always carry "−". */
  sign?: boolean;
};

/** Formats integer tenge as "6 000 ₸" (non-breaking spaces). */
export function formatTenge(value: number, options: FormatTengeOptions = {}): string {
  const rounded = Math.round(value);
  const abs = Math.abs(rounded);
  const digits = String(abs).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const prefix = rounded < 0 ? MINUS : options.sign && rounded > 0 ? "+" : "";
  return `${prefix}${digits}${NBSP}₸`;
}
