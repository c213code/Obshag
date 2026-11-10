# GAN spec — Slice 17: «Ты перевёл?» instead of «Я оплатил»

User: «можно убрать "я оплатил", они все забывают … когда переходят по ссылке пусть бот спрашивает в личке "ты оплатил?" да/нет, через 2–3 мин после того как перешёл на Kaspi».

Read generator-state.md (slice 3 settlements/mark_settlement, slice 12 TG DM + webhook callbacks, slice 13 min 100 ₸). Migrations 0001–0014 are LIVE — new SQL only in `supabase/migrations/0015_slice17_paid_prompt.sql`. No commit, no live apply, never touch .env.local.

## Flow
1. Settle screen: remove the «Я оплатил / Я перевёл» button. «Открыть Kaspi» (copy number → kaspi.kz/transfers) stays the main action. Tap → `POST /api/settle/opened {household_id, to_user}` (auth = session) → RPC `open_paid_prompt(household, to)` records `public.paid_prompts(id, household_id, from_user, to_user, amount, opened_at, status pending|yes|no|expired, asked_at)`; one pending per pair, re-open refreshes opened_at/amount. RLS: rows visible to from_user only.
2. Back in the PWA (visibilitychange → visible) with own pending prompt < 30 min old: Sheet «Ты перевёл Айдосу 200 ₸?» [Да, перевёл] [Ещё нет]. «Да» → existing mark_settlement path (creditor confirms as today) + prompt status yes. «Ещё нет» → status no.
3. Route uses `after()`: wait ~150 s (cap 170 s, check maxDuration), re-read prompt; if still pending and asked_at null: if from_user has telegram_user_id → bot DM «Ты перевёл @aidos 200 ₸ через Kaspi?» with inline buttons `pp:y:<id>` / `pp:n:<id>`; else web push «Перевёл Айдосу 200 ₸?» opening `/settle/<to_user>?ask=1` (shows the same sheet). Set asked_at.
4. Webhook: `pp:` callbacks → server-secret RPC `tg_answer_paid(secret, tg_user, prompt, yes)` — linked tg user must be from_user; yes → mark the settlement (same checks as mark_settlement incl. min 100 ₸) ; no → status no. Edit the DM text: «✓ Отметил, ждём подтверждения от Айдоса» / «Ок, напомню позже». Answer callback query.
5. Pending older than 30 min → expired (lazy, on read).

## Rules
Security definer + `search_path=''` + actor checks; anon surface +1 (tg_answer_paid) → 10, update that test. Net below 100 ₸ (too_small) → no prompt, existing «копится» UI. Tokens only, copy in ru.ts, both themes, existing Sheet component. Tests: PGlite (prompt lifecycle, tg_answer_paid auth + min 100), unit (route body schema, webhook pp: parsing), e2e (open Kaspi → return → sheet → Да → settlement pending confirmation). `npm run verify` green. Append «Slice 17» to generator-state.md.
