/**
 * Who may delete a purchase: the payer, or an active admin of its household when the purchase is shared.
 * Mirrors public.delete_purchase (0009); the server stays the authority.
 */
export function canDelete(
  purchase: { payer_id: string; status: string; household_id: string },
  meId: string,
  members: ReadonlyArray<{ user_id: string; role: string; active: boolean }> | undefined,
): boolean {
  if (purchase.payer_id === meId) return true;
  if (purchase.status !== "shared") return false;
  return (members ?? []).some((m) => m.user_id === meId && m.active && m.role === "admin");
}
