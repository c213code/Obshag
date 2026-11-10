/** Browser side of the swap notices: POST /api/duty/notify asks the server to push / DM the other side. Never throws. */

export type DutyNotifyEvent = "requested" | "declined";

/** Fire-and-forget: the swap itself is already saved, so a failing notice only means the other side finds out by opening the app. */
export async function postDutyNotify(
  body: { request_id: string; event: DutyNotifyEvent },
  headers: Record<string, string> = {},
  doFetch: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await doFetch("/api/duty/notify", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      credentials: "same-origin",
    });
    return res.status === 200;
  } catch {
    return false;
  }
}
