/** The code from /join/[code]: URL-decoded when possible (a malformed %-sequence is kept as typed), capped at 64 chars. */
export function codeFromPath(raw: string): string {
  let code = raw;
  try {
    code = decodeURIComponent(raw);
  } catch {
    // malformed escape such as "%E0%A4%A": use the raw text, the join form treats it like any wrong code
  }
  return code.slice(0, 64);
}
