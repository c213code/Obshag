# Slice 20 — Apple Pay: no menu in the Shortcut, the bot asks right away

## Problem
The iOS Shortcut «общак» shows a menu «Общее / Моё / Потом» right after Apple Pay. People lock the phone at once,
iOS cancels the Shortcut, `/api/capture` is never called and the purchase is lost (only 1 apple_pay purchase live).

## Decision (user picked option 1)
The Shortcut has NO menu: it always POSTs `{token, amount, merchant}` silently (no `choice`). The purchase lands as
`pending`, and immediately:
- the existing web push «Magnum · 3 000 ₸ / Что купил? Общее или моё» (already works for `choice = null`);
- NEW: a Telegram DM from the bot to the payer (if their Telegram is linked):
  ```
  🛒 Magnum · 3 000 ₸
  Чья покупка?
  [Общее] [Моё]
  [Разобрать в приложении]      ← url button → app_url()||'/pending/'||id
  ```
  «Общее» / «Моё» use the existing callback data `s:<id>` / `p:<id>` (same as the 19:00 digest), so the webhook
  handler already resolves them (`tgResolvePending`, rewrites the message, drops the buttons). No webhook change needed.
Both survive a locked phone. The 19:00 digest stays as a fallback for anything still pending.

## A. Database — `supabase/migrations/0018_slice20_capture_dm.sql`
Never edit 0001–0017 (live). New migration only.
- `create or replace function public.capture_purchase(p_token text, p_amount integer, p_merchant text, p_choice text default null)`
  — SAME signature, same body as 0008 (copy it exactly), plus:
  - `v_choice = 'later'` / `'потом'` → status `pending`, NO DM (explicit «decide later», old Shortcuts with the menu).
  - When a NEW row is inserted with `v_status = 'pending'` and the choice is not later: if
    `profiles.telegram_user_id` of the payer is not null, call
    `private.tg_send_markup(<tg id>, <text>, <inline_keyboard jsonb>)` (from 0017; it uses pg_net + Vault and is a
    no-op when pg_net / the token is missing). The deduped early return (Shortcut retry within 60 s) sends nothing.
  - Text: `'🛒 ' || coalesce(v_merchant,'Покупка') || ' · ' || <amount with space thousands> || ' ₸' || E'\nЧья покупка?'`.
    Reuse an existing SQL money formatter if one exists in earlier migrations (grep `₸` in supabase/migrations), else
    format inline (`3 000 ₸`, regular spaces are fine).
  - Keyboard: `{"inline_keyboard":[[{"text":"Общее","callback_data":"s:<id>"},{"text":"Моё","callback_data":"p:<id>"}],[{"text":"Разобрать в приложении","url":"<app_url()>/pending/<id>"}]]}`
    — check the exact jsonb shape `tg_send_markup` expects in 0017 (`remind` uses it) and match it.
  - A failure in sending must never fail the capture (wrap in `begin … exception when others then null; end`).
  - Keep `revoke all … from public, anon, authenticated; grant execute … to anon;` exactly as 0008.
- Anon surface stays 13 functions.

## B. App
- `captureHandler.ts`: pass `"later"` through to the repo instead of mapping it to null, so the DB can tell
  «later» (no DM) from «no choice» (DM). Push behaviour unchanged (later → no push; null → push).
  Update `Repo.capture` type (`CaptureChoice | "later" | null`), `supabaseRepo` (`p_choice: "later"`), mockRepo
  (treat "later" as pending), and tests.
- Mock mode: no Telegram exists in mock; nothing to record. A vitest on the handler/repo is enough, no new e2e.
- `src/lib/i18n/ru.ts` `shortcut.*` — new wording, no menu:
  - `intro`: «После оплаты Apple Pay покупка сама попадёт в Общак, а бот спросит в Telegram: общее или моё. Можно
    сразу заблокировать телефон — вопрос никуда не денется.»
  - add `quick.five`: «Если в команде «общак» есть шаг «Выбрать из меню» — удали его: Общак сам спросит в Telegram.»
    and render it in `ShortcutScreen.tsx` after `quick.four` (same markup as the other items).
  - add a short note that Telegram must be linked (Профиль → Подключить Telegram) to get the question there;
    otherwise only the push comes. Reuse an existing note style on that screen.
  - Update the `SHORTCUT_ICLOUD_URL` doc comment (no menu). Do NOT change the URL itself (the user will publish a
    new iCloud link by hand).
- Do not touch `public/sw.js` (push for pending already has Общее / Моё actions).

## C. Tests
- `tests/db/slice20.test.ts` (PGlite, follow tests/db/slice19.test.ts setup; observe Telegram sends the same way
  slice 17/19 db tests do):
  1. choice null + linked Telegram → one send with the text and both callback buttons + url button.
  2. choice null + no Telegram → no send, capture still ok.
  3. choice 'later' → pending, no send.
  4. choice 'shared' / 'personal' → no send.
  5. retry within 60 s (deduped) → no second send.
  6. a failing send does not fail the capture.
  7. anon can still execute `capture_purchase(text,integer,text,text)`; anon function count still 13.
- Update `captureHandler` / `supabaseRepo` unit tests for the "later" pass-through.
- Run: `npx tsc --noEmit`, `npx vitest run` (all), and the existing capture e2e spec(s) (grep `api/capture` in tests/e2e) — must pass.

## Out of scope
Merchant-based auto-guessing (option 2), changing the digest, sw.js, the webhook.
