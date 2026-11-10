import { z } from "zod";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[A-Za-z0-9_-]{16,64}$/;

export type StartCommand = { code: string | null };

/**
 * `/start`, `/start@bot`, `/start <code>`. null = not a /start command. A malformed code gives `{ code: null }`
 * (answered with the help text, never sent to the database).
 */
export function parseStart(text: string | undefined): StartCommand | null {
  if (typeof text !== "string") return null;
  const m = /^\/start(?:@[A-Za-z0-9_]{1,64})?(?:\s+(\S+))?\s*$/.exec(text.trim());
  if (!m) return null;
  return { code: m[1] && CODE.test(m[1]) ? m[1] : null };
}

export type CallbackAction = { shared: boolean; purchaseId: string };

/** `s:<uuid>` = Общее, `p:<uuid>` = Моё. Anything else is ignored. */
export function parseCallbackData(data: string | undefined): CallbackAction | null {
  if (typeof data !== "string" || data.length !== 38) return null;
  const kind = data.slice(0, 2);
  const id = data.slice(2);
  if ((kind !== "s:" && kind !== "p:") || !UUID.test(id)) return null;
  return { shared: kind === "s:", purchaseId: id.toLowerCase() };
}

export type SwapCallback = { accept: boolean; requestId: string };

/** `sw:a:<uuid>` = Согласен, `sw:d:<uuid>` = Не могу. Anything else is null. */
export function parseSwapCallback(data: string | undefined): SwapCallback | null {
  if (typeof data !== "string" || data.length !== 41 || !data.startsWith("sw:")) return null;
  const kind = data.slice(3, 5);
  const id = data.slice(5);
  if ((kind !== "a:" && kind !== "d:") || !UUID.test(id)) return null;
  return { accept: kind === "a:", requestId: id.toLowerCase() };
}

/** Only what the bot uses; everything else in an update is dropped. */
export const updateSchema = z.object({
  message: z
    .object({
      text: z.string().max(4096).optional(),
      chat: z.object({ id: z.number(), type: z.string().max(20) }),
      from: z.object({ id: z.number().int().positive() }).optional(),
    })
    .optional(),
  callback_query: z
    .object({
      id: z.string().min(1).max(200),
      from: z.object({ id: z.number().int().positive() }),
      data: z.string().max(200).optional(),
      message: z
        .object({
          message_id: z.number().int(),
          text: z.string().max(4096).optional(),
          chat: z.object({ id: z.number(), type: z.string().max(20) }),
        })
        .optional(),
    })
    .optional(),
});
export type TelegramUpdate = z.infer<typeof updateSchema>;
