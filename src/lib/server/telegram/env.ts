import "server-only";
import { createTelegramApi, type TelegramApi } from "./api";

/** Env values count only when non-empty; the bot token is only ever read here. */
const envValue = (name: string): string | null => {
  const v = process.env[name]?.trim();
  return v ? v : null;
};

export function getTelegramApi(): TelegramApi | null {
  const token = envValue("TELEGRAM_BOT_TOKEN");
  return token ? createTelegramApi(token) : null;
}

export function readWebhookSecret(): string | null {
  const s = envValue("TELEGRAM_WEBHOOK_SECRET");
  return s && s.length >= 16 ? s : null;
}
