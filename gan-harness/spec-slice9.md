# GAN spec: Slice 9, "Telegram group notifications" (lean process)

**User request (verbatim):** «Я добавил в гр, нужно каждый платеж отправлять сюда через бота также отмечатьб каждого».

**Bot:** @obshagk_bot on the Telegram Bot API, with privacy mode on.

**Token:**
- It lives ONLY in Supabase Vault (secret name `telegram_bot_token`) and in the gitignored `.env.local`.
- Never put it in code, tests, logs or commits.
- Do not read or touch `.env.local`.

**Before you start:**
- Read `gan-harness/generator-state.md`, migrations 0001–0006 (LIVE, never edit) and `docs/SDD.md` §7–§8.
- New SQL goes in `supabase/migrations/0007_slice9_telegram.sql`.
- No service-role key.

## Why this lives in the database

Purchases are created from three places: client-side RPCs, Apple Pay capture and the monthly cron. One deferred trigger catches all of them.

**Sending:**
- Use `pg_net` (`net.http_post`) to call `https://api.telegram.org/bot<token>/sendMessage`.
- The extension is enabled on live separately, NOT in the migration. PGlite has neither pg_net nor vault.
- All code must do nothing, cleanly, when `net.http_post` or the vault secret is missing, so the PGlite tests run. Guard with `to_regproc`/`to_regclass` plus dynamic `EXECUTE`.

## Schema (0007)

- **`profiles.telegram_username text null`:**
  - check `^[A-Za-z0-9_]{5,32}$`
  - store it without the `@`
- **`households.telegram_chat_id bigint null`:** the operator sets it with SQL for now. No client RPC.
- **`private.telegram_sent(kind text, ref uuid, sent_at timestamptz default now(), primary key(kind, ref))`:** idempotency. Send only if this insert succeeded.
- **RPC `set_telegram_username(p_username text)`:**
  - security definer, `search_path=''`
  - the actor is `auth.uid()`
  - accepts `@name` or `name`; empty or null clears the field
  - validates the value
  - granted to `authenticated` only

## Messages

Use HTML parse_mode. Escape `&`, `<` and `>` in every user-supplied string.

The builders are pure SQL functions in `private`, so they can be unit-tested.

### `private.tg_purchase_message(p_purchase uuid) returns text`

For a shared purchase:

```
🛒 Хлеб, картошка — 6 000 ₸
Платил: Ерасыл
Должны:
@aidos — 2 000 ₸
Дана — 2 000 ₸
```

**Rules:**
- **Title:** the description, else the merchant, else «Покупка».
- **Monthly bills:** use the 🏠 icon, as in «🏠 Квартплата — …».
- **Debtor lines:** one line per share whose debtor is not the payer. Tag the person with `@username` when set, otherwise use their display name.
- **Amounts:** a space as the thousands separator plus ` ₸`. Do not use the locale-dependent `to_char` `G`.

### `private.tg_settlement_message(p_settlement uuid) returns text`

Sent when a settlement is confirmed. Tag both people, using the arrow form:

`✅ @aidos → @erasyl · 200 ₸ · рассчитались`

## Sending

**`private.tg_send(p_chat bigint, p_text text)`:**
- Read the token from `vault.decrypted_secrets` where name = 'telegram_bot_token'.
- If the token or pg_net is missing, return without sending.
- Body: `{chat_id, text, parse_mode:'HTML', disable_web_page_preview:true}`.

**Purchases trigger:** a deferred constraint trigger on `purchases` (`after insert or update ... deferrable initially deferred`).
- **When it fires:** the row is shared on insert, or moves from pending to shared. Use the real status values from 0001–0006.
- **Group check:** the household has a `telegram_chat_id`.
- **Idempotency:** `insert into telegram_sent('purchase', id) on conflict do nothing`. Send only if the row was inserted.
- Personal and pending purchases are never posted.

**Settlements trigger:** on `settlements` moving to confirmed, with the same idempotency (`'settlement'`).

**Failure safety:** a trigger failure must never break the user's transaction. Wrap the send in `begin … exception when others then null; end`.

**Permissions:**
- `anon` and `authenticated` cannot execute any of the private functions.
- The anon surface stays exactly the same 4 functions.

## UI

**Профиль sheet in Квартира:**
- Field «Telegram» (`@username`), placeholder `@username`.
- Hint: «Чтобы бот отмечал тебя в группе».
- Saves through `set_telegram_username`, with an inline error when the value is invalid.
- The mock repo supports it.
- Use the capsule kit, copy in `ru.ts`, tokens only.

**README:** a short "Telegram" section covering the Vault secret name, `telegram_chat_id` and pg_net. No token.

## Tests (lean)

**PGlite:**
- Builder output:
  - tags vs names
  - the payer excluded
  - HTML escaping
  - thousands format
  - the monthly icon
- `set_telegram_username` validation and clearing.
- Triggers do nothing without pg_net and don't break inserts.
- The idempotency row is written once.
- The anon surface is still 4 functions.
- `authenticated` cannot execute the private functions.

**E2E:** the Профиль Telegram field saves in mock mode. Run the suite once.

## Done when

`npm run verify` is green, `npm run test:e2e` is green once, and nothing is committed.
