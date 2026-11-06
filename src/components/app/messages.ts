import { RepoError } from "@/lib/data/repo";
import { ru } from "@/lib/i18n/ru";

/** User-facing Russian text for a repo failure. The repo's own messages are English and for logs only. */
export function errorMessage(e: unknown, fallbacks: Partial<Record<RepoError["code"], string>> = {}): string {
  if (e instanceof RepoError) {
    const specific = fallbacks[e.code];
    if (specific) return specific;
    if (e.code === "otp_failed") return ru.errors.otp;
    if (e.code === "join_failed") return ru.errors.joinFailed;
  }
  return ru.errors.generic;
}
