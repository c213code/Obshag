/** "7KQ29PXA4M1C" -> "7KQ2-9PXA-4M1C": groups of four are easier to read out loud. Display only; the stored code has no dashes. */
export function formatInviteCode(code: string): string {
  const clean = code.replace(/[\s-]/g, "").toUpperCase();
  return clean.match(/.{1,4}/g)?.join("-") ?? "";
}
