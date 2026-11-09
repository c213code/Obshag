import "server-only";
import { getServerRepo } from "../reminderDeps";
import { getTelegramApi, readWebhookSecret } from "./env";
import type { WebhookDeps } from "./webhookHandler";

/** The webhook shares the cron route's repo (anon key + CRON_SECRET-gated RPCs). null = not configured: the route answers 401. */
export function getWebhookDeps(): WebhookDeps | null {
  const server = getServerRepo();
  const webhookSecret = readWebhookSecret();
  if (!server || !webhookSecret) return null;
  return { repo: server.repo, api: getTelegramApi(), serverSecret: server.secret, webhookSecret };
}
