import { RepoError } from "@/lib/data/repo";
import { ru } from "@/lib/i18n/ru";

/** User-facing Russian text for a repo failure. The repo's own messages are English and for logs only. */
export function errorMessage(e: unknown, fallbacks: Partial<Record<RepoError["code"], string>> = {}): string {
  if (e instanceof RepoError) {
    const specific = fallbacks[e.code];
    if (specific) return specific;
    if (e.code === "join_failed") return ru.errors.joinFailed;
    if (e.code === "invalid_credentials") return ru.auth.errors.invalidCredentials;
    if (e.code === "email_taken") return ru.auth.errors.emailTaken;
    if (e.code === "weak_password") return ru.auth.errors.weakPassword;
    if (e.code === "signup_unavailable") return ru.auth.errors.signupUnavailable;
    if (e.code === "invalid_link") return ru.auth.errors.invalidLink;
    if (e.code === "rate_limited") return ru.auth.errors.rateLimited;
  }
  return ru.errors.generic;
}
