/** The legacy path: a hidden textarea + execCommand. Synchronous, so it still counts as part of the tap (iOS needs that). */
function copyWithTextarea(text: string): boolean {
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Copies text. The textarea path runs first and synchronously, inside the user's gesture; the async Clipboard API is
 * the fallback. Resolves false when both fail; never throws.
 */
export function copyText(text: string): Promise<boolean> {
  if (copyWithTextarea(text)) return Promise.resolve(true);
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text).then(
        () => true,
        () => false,
      );
    }
  } catch {
    // fall through
  }
  return Promise.resolve(false);
}

/** The only Kaspi URL we open: verified on iPhone to land on the Transfers screen of the Kaspi app. No query params. */
export const KASPI_TRANSFERS_URL = "https://kaspi.kz/transfers";
