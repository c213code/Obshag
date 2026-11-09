export const DEFAULT_BOT = "obshagk_bot";

/** `https://t.me/<bot>?start=<code>`. A bot name that is not a valid username falls back to the default. */
export function telegramLink(code: string, bot: string | undefined | null = DEFAULT_BOT): string {
  const name = bot && /^[A-Za-z0-9_]{5,32}$/.test(bot) ? bot : DEFAULT_BOT;
  return `https://t.me/${name}?start=${encodeURIComponent(code)}`;
}
