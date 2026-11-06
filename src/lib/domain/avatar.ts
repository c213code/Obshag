export const AVATAR_COLORS = ["blue", "brown", "purple"] as const;
export type PersonColor = (typeof AVATAR_COLORS)[number];

/**
 * Deterministic automatic avatar color for the mock backend. Same palette as the SQL `upsert_profile`, but a different
 * hash (SQL uses md5 of the id, here a tiny string hash), so a given id can get different colors in mock and Supabase mode.
 */
export function pickAvatarColor(seed: string): PersonColor {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
