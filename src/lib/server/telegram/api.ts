const TIMEOUT_MS = 5000;

export type InlineKeyboard = Array<Array<{ text: string; callback_data: string }>>;

/** The few Bot API calls the app makes. Every call resolves true/false; nothing is thrown, logged or echoed. */
export interface TelegramApi {
  sendMessage(chatId: number, text: string, keyboard?: InlineKeyboard): Promise<boolean>;
  answerCallbackQuery(id: string, text?: string): Promise<boolean>;
  editMessageText(chatId: number, messageId: number, text: string): Promise<boolean>;
  setWebhook(url: string, secretToken: string): Promise<boolean>;
}

/** Real client. The token lives only in the request URL; it is never logged and errors carry no detail. */
export function createTelegramApi(token: string, fetchImpl: typeof fetch = fetch): TelegramApi {
  const call = async (method: string, body: Record<string, unknown>): Promise<boolean> => {
    try {
      const res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
      return res.ok;
    } catch {
      return false;
    }
  };
  return {
    sendMessage: (chat_id, text, keyboard) =>
      call("sendMessage", { chat_id, text, disable_web_page_preview: true, ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}) }),
    answerCallbackQuery: (callback_query_id, text) => call("answerCallbackQuery", { callback_query_id, ...(text ? { text } : {}) }),
    editMessageText: (chat_id, message_id, text) => call("editMessageText", { chat_id, message_id, text }),
    setWebhook: (url, secret_token) =>
      call("setWebhook", { url, secret_token, allowed_updates: ["message", "callback_query"], drop_pending_updates: false }),
  };
}

/** A recorder for tests: remembers calls, answers true (or false for methods listed in `failing`). */
export function createRecordingTelegram(failing: ReadonlyArray<string> = []): TelegramApi & { calls: Array<{ method: string; args: unknown[] }> } {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const rec = (method: string) => async (...args: unknown[]) => {
    calls.push({ method, args });
    return !failing.includes(method);
  };
  return {
    calls,
    sendMessage: rec("sendMessage") as TelegramApi["sendMessage"],
    answerCallbackQuery: rec("answerCallbackQuery") as TelegramApi["answerCallbackQuery"],
    editMessageText: rec("editMessageText") as TelegramApi["editMessageText"],
    setWebhook: rec("setWebhook") as TelegramApi["setWebhook"],
  };
}
