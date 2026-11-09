# GAN spec: Slice 12, "Потом → 19:00 reminder, Telegram DM with buttons" (lean process)

**User requests (verbatim):**
- «если я нажимаю общее, потом приходит какое-то пуш-уведомление, убери второе. Пуш-уведомление должно проходить только потом… В 7»
- «да пуш и тг но давай тг пишет в лс с кнопками»

**Before you start:**
- Read `gan-harness/generator-state.md` (slices 0–11), migrations 0004/0005/0007/0008/0009, `src/lib/server/captureHandler.ts`, `/api/cron/daily`.
- Migrations 0001–0009 are LIVE. New SQL goes in `supabase/migrations/0010_slice12_tg_dm.sql`.
- Do not touch `.env.local`. Never write any token. Do not commit or stash. Do not apply anything to the live DB. No service-role key.

## A. Capture: no instant push for «Потом»

`parseChoice` returns `'later'` for `later` / `потом`.

| Capture | Push |
|---|---|
| explicit `later` | pending, **no push** |
| choice missing or unrecognised (old Shortcuts with no menu) | pending **with** the instant push, as today, so nothing is silently lost |
| `shared` / `personal` | no push, unchanged |

## B. Link Telegram to a profile

**Schema:**
- `profiles.telegram_user_id bigint unique null`. Private chat id = user id.
- `private.telegram_link_codes(code_hash text pk, user_id uuid, expires_at timestamptz)`.

**RPCs:**
- **`create_telegram_link_code()`** (authenticated)
  - Returns a random code (≥ 16 chars, url-safe).
  - Stores only its sha256, valid for 15 minutes.
  - Creating a new code deletes the user's previous codes.
- **`tg_link_account(p_secret text, p_code text, p_tg_user_id bigint)`**
  - Server-secret gated, same pattern as `run_daily_reminders`: `private.server_secrets` 'cron'.
  - Consumes the code and sets `telegram_user_id`.
  - If that tg id is already linked to another profile, move it.
  - Returns the display name.
- **`unlink_telegram()`** (authenticated).

**UI:** Квартира → Профиль → «Подключить Telegram» pill.
- It opens `https://t.me/obshagk_bot?start=<code>` (bot username from `NEXT_PUBLIC_TELEGRAM_BOT` env, default `obshagk_bot`).
- Once linked it shows «Telegram подключён · Отключить».
- Capsule kit, tokens only, copy in `ru.ts`.

## C. Bot webhook: `POST /api/telegram/webhook` (Node runtime)

**Verification:**
- Verify the `X-Telegram-Bot-Api-Secret-Token` header with a constant-time compare against env `TELEGRAM_WEBHOOK_SECRET`.
- On mismatch return 401 and do nothing.
- Body limit is 64 KB. Zod-parse only what we use.

**Messages and callbacks:**
- **`message` with text `/start <code>`** in a private chat: call `tg_link_account`, then reply «Готово, {name}! Буду писать сюда про покупки на «Потом».». A bad or expired code gets «Ссылка устарела — открой Общак → Профиль → Подключить Telegram ещё раз». Plain `/start` gets a short help text.
- **`callback_query` with data `s:<purchase_uuid>` or `p:<purchase_uuid>`**: call `tg_resolve_pending(p_secret, p_tg_user_id, p_purchase, p_shared bool)`.
  - The RPC is server-secret gated.
  - It checks that the tg user is linked to the purchase's **payer** and that the purchase is still `pending`.
  - Shared means an equal split among active not-away members, with description = merchant or «Покупка», exactly like `capture_purchase` shared. Reuse the helpers. The 0007 Telegram group trigger then posts to the group by itself.
  - Afterwards `answerCallbackQuery`, then `editMessageText` to «✓ Поделено на всех» / «✓ Моё» (or «Уже решено» if it was not pending).
- **Telegram API calls from the route** use env `TELEGRAM_BOT_TOKEN`:
  - small `fetch` wrapper;
  - 5 s timeout;
  - never log the token or bodies.
- Always return 200 quickly to Telegram after a valid secret, even on handled errors.

**Setup route:** `POST /api/telegram/setup`.
- Bearer `CRON_SECRET`, constant-time compare.
- Calls `setWebhook(url=<origin>/api/telegram/webhook, secret_token=TELEGRAM_WEBHOOK_SECRET, allowed_updates=["message","callback_query"])`.
- Returns `{ok}`.

**Note:** `getUpdates` stops working once the webhook is set. That is fine.

## D. 19:00 digest, in the existing daily cron

**`run_pending_digest(p_secret)`** (server-secret gated) returns, per payer with pending purchases older than 10 minutes:
- `user_id`;
- the push subscriptions;
- `telegram_user_id`;
- the purchases: `id`, `merchant`, `amount`, `created_at`.

**`/api/cron/daily` then sends:**
- **one push per user:** «Ждут решения: 2 покупки», body «Общее или моё? Открой Общак», which opens `/`. Use the sw.js generic path, or add a `type: "digest"` handler to sw.js that always shows a notification.
- **if `telegram_user_id` is set:** one DM per purchase (cap 10):
  ```
  🛒 Small · 3 780 ₸ · 8 нояб, 14:32
  Чья покупка?
  ```
  with the inline keyboard `[Общее s:<id>] [Моё p:<id>]`.

**Rules:**
- Never post pending purchases to the group.
- The digest doesn't repeat for the same purchase more than once per day. Track it in `private.pending_digest_log(purchase_id, sent_on date)`.

## Security

- **Anon surface:** grows by the new server-secret RPCs (`tg_link_account`, `tg_resolve_pending`, `run_pending_digest`). Update the anon-surface test to the exact new list and document why.
- All functions are security definer with `search_path=''`.
- Codes are stored hashed.
- The callback can only resolve purchases whose payer is the linked tg user.
- Purchase ids are UUIDs, validated.

## Env (document in README and `.env.example`, no values)

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `NEXT_PUBLIC_TELEGRAM_BOT`

## Tests (lean)

- **PGlite:**
  - link codes: hash only, expiry, single use, re-link moves the id;
  - `tg_resolve_pending` resolves only the payer's pending purchase, and a wrong tg user or an already-resolved purchase is refused;
  - shared creates the shares;
  - the digest excludes recent, non-pending and already-sent rows;
  - the anon surface.
- **Unit:**
  - webhook secret check (401);
  - `/start` code parsing;
  - callback data parsing;
  - `parseChoice('later')` → no push, missing → push.
- **E2E (once):** Профиль «Подключить Telegram» shows the link in mock mode.
- `npm run verify` is green, `npm run test:e2e` is green once, and nothing is committed.
- Append a "Slice 12" note to `generator-state.md`.
