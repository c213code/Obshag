/** Browser side of «Открыть Kaspi»: POST /api/settle/opened records the prompt (the server asks «ты перевёл?» later). Never throws. */

/**
 * Fire-and-forget. `keepalive` lets the request finish while the browser is already switching to Kaspi.
 * A failure only means the question is not asked; the debtor can still be asked in the app.
 */
export async function postPaidOpened(
  body: { household_id: string; to_user: string },
  headers: Record<string, string> = {},
  doFetch: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await doFetch("/api/settle/opened", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      credentials: "same-origin",
      keepalive: true,
    });
    return res.status === 200;
  } catch {
    return false;
  }
}
