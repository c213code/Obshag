/** Formats the local part of a Kazakh number while typing: "7001234567" -> "700 123 45 67". */
export function formatLocalPhone(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.length > 10 && (digits.startsWith("7") || digits.startsWith("8"))) digits = digits.slice(1);
  digits = digits.slice(0, 10);
  const parts = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 8), digits.slice(8, 10)];
  return parts.filter(Boolean).join(" ");
}

/** "+77010000002" -> "+7 7•• ••• 00 02" (Pay.dc.html): the area's first digit and the last four digits stay visible. */
export function maskKaspiPhone(phone: string | null): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  const local = digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8")) ? digits.slice(1) : digits;
  if (local.length !== 10) return null;
  return `+7 ${local[0]}•• ••• ${local.slice(6, 8)} ${local.slice(8, 10)}`;
}
