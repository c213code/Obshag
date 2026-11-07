# GAN spec: Slices 5 + 2 combined, "Reminders + purchase detail" (lean process)

Read `docs/SDD.md` §5.3 (screens 1 and 3), §6.3, §6.5, §8 and §9, and `gan-harness/generator-state.md` for slices 0–4. Reuse everything that already exists.

**Visual truth:** `docs/design/Purchase.dc.html`, `docs/design/AddPurchase.dc.html` (the «Свои суммы» mode) and `docs/design/Main.dc.html`. The user rejects drift, so compare your screens side by side against them.

**Database:** 0001–0004 are LIVE; never edit them. All new SQL goes in `supabase/migrations/0005_slice5_2.sql`, and the PGlite tests apply all migrations in order. Do not touch `.env.local`. Never use a service-role key.

## A. Server secret, so the server never needs a service-role key

- Create the table `private.server_secrets(name text primary key, hash text not null)`. RLS is on, there are no grants, and the migration inserts NO rows: the orchestrator inserts the hash of `CRON_SECRET` directly.
- Create `private.server_secret_ok(p_secret text) returns boolean`. It compares `sha256(p_secret)` hex with the stored hash for the name `'cron'`.
- Every RPC below that returns push subscriptions or touches other users requires `p_secret`, so it is useless when called directly from a browser.

## B. Reminders (slice 5)

**`run_daily_reminders(p_secret text)`**
- Security definer, executable by anon (it is called by the cron route with the anon client).
- It raises 28000 unless the server secret matches.
- For every pair of active members in every household where the debtor's pairwise net (use `private.pair_net` from 0003) has been greater than 0 for more than 24h, it selects the debtor. "Older than 24h" means the oldest open share in that pair was created more than 24h ago.
- A pair is skipped when either of these holds:
  - The debtor has `members.reminders_enabled = false` (a new column, default true).
  - The pair already got a reminder in the last 6h, according to `reminder_log`.
- It writes a `reminder_log` row for each reminder it sends.
- It returns jsonb `[{to_user, from_name_dative, amount, subscriptions:[{endpoint,p256dh,auth}]}]`.

**`remind(p_secret text, p_household uuid, p_debtor uuid)`**
- Authenticated. The actor must be a creditor: `pair_net(debtor → actor) > 0`.
- 6h cooldown per pair (`from = actor`, `to = debtor`) through `reminder_log`.
- It logs the reminder and returns the debtor's subscriptions plus the text data.
- It requires the server secret, so the browser can't call it usefully.

**`set_reminders_enabled(p_household uuid, p_enabled bool)`**: self only.

**Routes**
- `GET /api/cron/daily` is Vercel Cron. It checks `Authorization: Bearer ${CRON_SECRET}` in constant time and returns 401 otherwise. It calls `run_daily_reminders(CRON_SECRET)` and sends pushes with the existing `PushSender` and allowlist. The push body is «Ты должен Айдосу 200 ₸ · Рассчитаться», and tapping it opens `/settle/<creditorId>`.
- `POST /api/remind {household_id, debtor_id}` uses the user's session (server Supabase client with cookies). It calls `remind(CRON_SECRET, …)` and sends the push.
  - Responses: 200, 401, 403, 429 (cooldown, returning `retry_after`) and 400.
- Add the cron schedule `0 14 * * *` (19:00 Asia/Almaty, UTC+5) to `vercel.json`, or to `vercel.ts` if that is already used.

**UI**
- The «Напомнить» quick action on Главная opens `/settle`, a list with a «Напомнить» pill per person who owes you.
- The «Напомнить» button on `/settle/[userId]` (when they owe you) and on the purchase detail is enabled. Its states are sending, «Напомнили» and «Можно через 5 ч».
- Квартира gets a «Напоминания» toggle, per Invite.dc.html. It maps to `reminders_enabled` for yourself.
- Remove every «скоро» badge that this pass makes obsolete.

## C. Purchase detail and the Покупки tab (slice 2)

- `/purchases` (the Покупки tab) lists all visible purchases grouped by day, as pill rows (description, merchant, payer, time, amount, and «N из M» or «моё»). Filter pills «Все / Мои / Должен я».
- `/purchases/[id]`, exactly per `Purchase.dc.html`:
  - a lime card with the description, merchant, time, payer, amount, «на N человек» and «по X ₸»
  - a «Кто скинул» list (received ✓ / waiting + «Напомнить»)
  - an «Изменить» header button that lets the payer edit the description
  - a red-outline «Удалить покупку» pill
- **Свои суммы**, in the Новая покупка «Как делить» segment (now enabled). Each selected person gets an amount input. The bottom bar shows the remaining amount, and ✓ is disabled until the inputs sum exactly to the total.
  - New RPC `create_purchase_custom(p_household, p_amount, p_description, p_merchant, p_shares jsonb [{user_id, amount}])` for the payer, the actor.
  - Validation: every entry is an active member, no duplicates, every amount is an integer ≥ 0, the amounts sum to the total, at least one entry is not the payer, and there are at most 50 entries.
  - The payer's own entry is settled immediately.
- **Delete.** The new RPC `delete_purchase(p_id)` lets the payer delete only. It raises 23514 `has_payments` if any share is settled or appears in any `settlement_shares` row of a non-cancelled settlement.
  - Revoke the direct client `delete` on purchases.
  - Optimistic delete with rollback. A confirmation is built into the page (no `confirm()`): the pill turns into «Точно удалить?» + «Удалить» / «Отмена».
- **Edit description.** The RPC `update_purchase_description(p_id, p_text)` is payer only, 1..200 characters.
  - Revoke the direct client `update` on purchases.

## Tests (TDD, lean)

- **PGlite:**
  - server secret gating (wrong or missing secret → 28000)
  - `run_daily_reminders` selection (net > 0 and older than 24h; disabled; cooldown; each pair once)
  - `remind` permissions and cooldown
  - `create_purchase_custom` validation and sums
  - `delete_purchase` blocked after payment
  - revoked direct `update`/`delete`
  - anon can execute only `capture_purchase`, `prune_push_subscription` and `run_daily_reminders`
- **Unit:** cron auth (constant time), the remind route mapping, and the custom split form math.
- **E2E (run once):**
  - custom split 6000 = 3000/2000/1000 → shares are correct
  - detail screen and delete before payment works / is blocked after payment
  - edit description
  - Покупки tab filters
  - the remind button shows its cooldown state (uses the fake push sender)

## Done when

- `npm run verify` is green and `npm run test:e2e` is green once.
- There is one side-by-side comparison, `gan-harness/screenshots/s52-cmp-purchase.png`, against `Purchase.dc.html`.
- Russian copy goes through `ru.ts`, there is no raw hex outside the tokens, and animation uses only transform/opacity.
- Nothing is committed.
