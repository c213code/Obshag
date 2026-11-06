/** Formats the local part of a Kazakh number while typing: "7001234567" -> "700 123 45 67". */
export function formatLocalPhone(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.length > 10 && (digits.startsWith("7") || digits.startsWith("8"))) digits = digits.slice(1);
  digits = digits.slice(0, 10);
  const parts = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 8), digits.slice(8, 10)];
  return parts.filter(Boolean).join(" ");
}
