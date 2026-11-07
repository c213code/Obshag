/** Browser side of «Напомнить»: POST /api/remind and the cooldown wording. */

export type RemindResult =
  | { ok: true }
  | { ok: false; reason: "cooldown"; retryAfter: number }
  | { ok: false; reason: "forbidden" | "failed" };

export const COOLDOWN_SECONDS = 6 * 60 * 60;

/** Seconds -> {unit, n}: whole hours rounded up, minutes under an hour ("Можно через 5 ч" / "через 40 мин"). */
export function cooldownParts(seconds: number): { unit: "h" | "m"; n: number } {
  const s = Number.isFinite(seconds) && seconds > 0 ? seconds : COOLDOWN_SECONDS;
  return s > 3600 ? { unit: "h", n: Math.min(6, Math.ceil(s / 3600)) } : { unit: "m", n: Math.max(1, Math.ceil(s / 60)) };
}

/**
 * The route answers 200 / 401 / 403 / 400 / 429 {retry_after}. Anything else (network, a redirect to the login page,
 * a non-JSON body) is a plain failure; the body of a failure is never shown.
 */
export async function postRemind(
  body: { household_id: string; debtor_id: string },
  headers: Record<string, string> = {},
  doFetch: typeof fetch = fetch,
): Promise<RemindResult> {
  try {
    const res = await doFetch("/api/remind", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      credentials: "same-origin",
    });
    if (res.status === 429) {
      const json = (await res.json().catch(() => null)) as { retry_after?: unknown } | null;
      const fromHeader = Number(res.headers.get("retry-after"));
      const retry = typeof json?.retry_after === "number" ? json.retry_after : fromHeader;
      return { ok: false, reason: "cooldown", retryAfter: Number.isFinite(retry) && retry > 0 ? retry : COOLDOWN_SECONDS };
    }
    if (res.status === 403) return { ok: false, reason: "forbidden" };
    if (res.status !== 200) return { ok: false, reason: "failed" };
    const json = (await res.json().catch(() => null)) as { ok?: unknown } | null;
    return json?.ok === true ? { ok: true } : { ok: false, reason: "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
