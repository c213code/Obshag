import "server-only";
import { z } from "zod";

const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);
const optional = <T extends z.ZodType>(s: T) => z.preprocess(emptyToUndefined, s.optional());

const schema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: optional(z.string().min(1)),
  VAPID_PRIVATE_KEY: optional(z.string().min(1)),
  VAPID_SUBJECT: optional(z.string().min(1)),
  CRON_SECRET: optional(z.string().min(16)),
  TELEGRAM_BOT_TOKEN: optional(z.string().min(1)),
  TELEGRAM_WEBHOOK_SECRET: optional(z.string().min(16)),
});

export type ServerEnv = z.infer<typeof schema>;

/** Secrets only. Importing this from a client component fails the build (`server-only`). */
export function parseServerEnv(source: Record<string, string | undefined>, opts: { requireServiceRole: boolean }): ServerEnv {
  const result = schema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid server environment:\n${lines.join("\n")}`);
  }
  if (opts.requireServiceRole && !result.data.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Invalid server environment:\n  SUPABASE_SERVICE_ROLE_KEY: required when NEXT_PUBLIC_DATA_MODE is not \"mock\"");
  }
  return result.data;
}

export function getServerEnv(): ServerEnv {
  return parseServerEnv(
    {
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
      VAPID_SUBJECT: process.env.VAPID_SUBJECT,
      CRON_SECRET: process.env.CRON_SECRET,
      TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
      TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET,
    },
    { requireServiceRole: process.env.NEXT_PUBLIC_DATA_MODE !== "mock" },
  );
}
