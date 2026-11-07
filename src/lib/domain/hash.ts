/** sha256 as lowercase hex of the UTF-8 text: the same value as SQL `encode(digest(text, 'sha256'), 'hex')`. */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 32 random bytes as 43 base64url characters (mock mode; the database does the same with gen_random_bytes). */
export function newCaptureToken(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
