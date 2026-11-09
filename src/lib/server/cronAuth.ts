import { createHash, timingSafeEqual } from "node:crypto";

const digest = (text: string) => createHash("sha256").update(text, "utf8").digest();

/** Minimum length of CRON_SECRET (the same floor as the server env schema). */
export const MIN_SECRET = 16;

/** The configured CRON_SECRET, or null when it is missing or too short (then every protected route stays closed). */
export function readCronSecret(env: Record<string, string | undefined> = process.env): string | null {
  const secret = env.CRON_SECRET?.trim();
  return secret && secret.length >= MIN_SECRET ? secret : null;
}

/** Constant-time string compare (both sides hashed first, so length and prefixes do not leak). */
export function secretsMatch(given: string | null | undefined, expected: string | null | undefined): boolean {
  if (!given || !expected) return false;
  return timingSafeEqual(digest(given), digest(expected));
}

/**
 * `Authorization: Bearer <CRON_SECRET>` in constant time: both sides are hashed first, so the comparison always sees
 * 32 bytes and neither the length nor any prefix of the secret leaks through timing.
 */
export function bearerMatches(header: string | null, secret: string | null): boolean {
  if (!secret || !header) return false;
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return false;
  return timingSafeEqual(digest(match[1]), digest(secret));
}
