/** Away until a date (inclusive): still away on that day, back the day after. `today` is 'YYYY-MM-DD' (Asia/Almaty). */
export const isAway = (awayUntil: string | null | undefined, today: string): boolean => !!awayUntil && awayUntil >= today;

/**
 * Who a new purchase is split between by default: everyone who is home. If that leaves nobody, everyone (the user can
 * still pick by hand; a purchase must have participants).
 */
export function defaultParticipants(roster: ReadonlyArray<{ user_id: string; away_until: string | null }>, today: string): string[] {
  const home = roster.filter((m) => !isAway(m.away_until, today)).map((m) => m.user_id);
  return home.length > 0 ? home : roster.map((m) => m.user_id);
}
