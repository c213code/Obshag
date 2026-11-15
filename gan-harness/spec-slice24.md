# Slice 24 — the cooking queue shifts past an away member; the author can delete a paid purchase

User: «он вчера делал, но сегодня сообщение пришло, что он опять делает… Должен быть тот, который будет делать завтра»
and «чтобы каждый автор платежа мог удалять свой платеж. И платежи, которые были отправлены после ошибочного платежа,
должны быть рекалькулированы».

One migration: `supabase/migrations/0022_slice24_queue_shift_delete_paid.sql`. Never edit 0001–0021 (live). Do NOT apply
remotely; no Supabase MCP tools; PGlite tests only. Every replaced function: copy its LATEST definition (highest-numbered
migration) and change only what is described. Keep grants.

## A. Queue shift (cooking, and every duty that uses the same day rotation)

### The bug (live data)
Cooking, start 2026-11-10, rotation: 0 Nurdaulet, 1 Nurbol, 2 Ерасыл, 3 Парасат. Nurdaulet `away_until = 2026-11-16`.
Today's rule (duty.ts `assignee`, SQL `private.duty_assignee` 0012/0014): day d → plain = rotation[(d-start) mod n]; if
plain is away, the NEXT available member in rotation order takes the day. So 14 (Nurdaulet's) → Nurbol, and 15 (Nurbol's
own plain day) → Nurbol again. Twice in a row.

### New rule: the queue walks
The queue is a chain: each day's cook is the next available member AFTER the previous day's chain cook.
- `chain(d) = next member after chain(d-1) in rotation order (wrapping) who is active and not away on d`
  (away on d = `away_until >= d`; everybody unavailable → plain rotation[(d-start) mod n]).
- Base: days with a stored chain row (below) are fixed. Before the first stored row: `chain(d) = plain(d)`.
- Overrides (swap/admin replace) and «приготовил» records still win for DISPLAY of that day exactly as now, but do NOT
  move the chain (the chain follows chain(d-1), not the override) — swaps keep working as two fixed days.
- With nobody away the chain equals the plain rotation (must stay identical to today's behaviour — test it).
- Water/trash queues that already «walk from the actor» (0014) keep their own rule — only change duties that use the
  day rotation; check which kinds use `duty_assignee`.

### Persisting the past (so a later away change never rewrites history)
- New table `public.duty_chain (duty_id uuid references duties on delete cascade, day date, user_id uuid references
  profiles, primary key (duty_id, day))`, RLS on, select policy for household members (same as duty_done's), no writes
  from clients.
- `private.duty_chain_lock(p_duty uuid, p_through date)`: writes chain rows for every missing day from (last stored
  day + 1, or start) through p_through, walking with the CURRENT away data. Idempotent. Called:
  - by the morning duty job (the one producing «🍳 Сегодня готовит @x · завтра @y»; server side is
    src/lib/server/dutyHandler.ts, find its SQL RPC) with p_through = today, BEFORE it computes today/tomorrow;
  - by marking «Приготовил» (lock through that day);
  - by set_away / set_member_away (lock through yesterday, so history before the change is frozen).
- `private.duty_assignee(duty, day)` (and anything else that computes the cook: week/calendar data, morning RPC, swap
  validation) uses: override → done → stored chain row → walk from the last stored row (or plain) to `day`.
- Backfill in the migration for every existing duty: plain rotation stored for days < yesterday (Asia/Almaty), then
  lock yesterday and today with the walk. For the live data that gives 14 → Nurbol (Nurdaulet away), 15 → Ерасыл,
  16 → Парасат, 17 → Nurdaulet, 18 → Nurbol. Don't touch duty_done (Nurbol's «приготовил» row for the 15th stays).
  The migration runs on 2026-11-15 or later — compute «today» at run time, don't hardcode.

### App (src/lib/domain/duty.ts + the week/calendar UI)
- The client computes the week from the same data: load the chain rows (repo + mock + types) and port the same walk to
  `duty.ts` (pure, unit-tested; keep the old function signature where possible). Past days without a chain row →
  plain; today/future → walk from the last chain row.
- The «Порядок» card's «завтра / пн, 16» labels follow the new walk.
- Mock repo: store chain rows and lock the same way (on mark done / away change / morning job in mock).

## B. The author can delete their purchase even after people paid

Today `public.delete_purchase` (0009) raises `has_payments` if any non-payer share is settled or in a settlement.
New: the payer (author) — and an admin, as today — may delete a SHARED purchase even when it has payments:
- Unsettled shares just disappear with the purchase (as now).
- Every non-payer share already settled (settled_at not null) means that debtor paid money for nothing → create ONE
  compensating purchase per such debtor, so the payer owes it back: `purchases(household_id, payer_id = <that debtor>,
  amount = <settled share amount>, description = '↩︎ Возврат: ' || <old title>, source = 'manual', status = 'shared')`
  with a single share `(debtor_id = <old payer>, amount)` (+ the payer's own zero/settled share only if the schema
  requires one — follow how other explicit-share inserts do it). Insert `private.telegram_sent ('purchase', id)` first
  so tg_on_purchase posts nothing for the refund. Netting then recalculates by itself (pair_net).
- `settlement_shares` rows that reference the deleted purchase: if FKs cascade, fine; if they block, delete those rows
  (the settlement row itself stays as history).
- One Telegram group post (private.tg_send, never breaking the delete):
  `'🗑 ' || tg_tag(actor) || ' удалил «' || tg_esc(title) || '» — ' || tg_money(amount)` and, if refunds were created,
  `E'\nВернётся: ' || string_agg(tg_tag(debtor) || ' ' || tg_money(x), ', ')`.
- Pending/personal purchases: unchanged rules.
- App: the delete action on the purchase screen is available to the payer even when the purchase has payments (find
  the `has_payments` handling in UI/i18n and drop the block). Confirm text when there are payments:
  «За неё уже платили — эти деньги вернутся им в долгах.» Mock repo follows the same rule.

## Tests
- `tests/db/slice24.test.ts` (PGlite; Telegram fake as in slice21–23):
  A1. no one away → chain == plain rotation for 30 days.
  A2. live scenario (4 members, start 2026-11-10, member0 away until 16, run on 15) → 14 m1, 15 m2, 16 m3, 17 m0,
      18 m1; nobody twice in a row.
  A3. changing away later does not change locked past days.
  A4. a swap override shows on its day and does not move the chain.
  A5. morning RPC returns today/tomorrow from the chain.
  B1. delete with unpaid shares → gone, no refund.
  B2. delete after a debtor paid (confirmed settlement) → purchase gone, one «↩︎ Возврат» purchase debtor→payer,
      pair_net reversed, no purchase post for the refund, one 🗑 post.
  B3. a stranger cannot delete; admin still can; anon function count stays 13.
- duty.ts unit tests for the walk (A1–A4); update existing duty unit/e2e tests only where they asserted the old rule.
- e2e: week with an away member shows nobody twice in a row; deleting a paid purchase shows a «Возврат» purchase.
Run `npx tsc --noEmit`, `npx vitest run`, the duty + purchase e2e specs (whole files).
