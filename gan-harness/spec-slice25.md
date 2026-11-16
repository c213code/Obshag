# Slice 25 — delete = just remove; the creditor marks «X перевёл»; the «Ты перевёл?» DM after 20 s

User: «я когда удалял ненужные через свайп, то у меня неправильно всё показывает, на самом деле просто с сервиса эти
покупки должны были удалиться», «добавь возможность покупателю мануально менять, типа Нурбол отправил, а не только когда
он подтвердил», «сообщение, которое отправляется после 2,5 мин, уменьши на после 20 сек».

One migration: `supabase/migrations/0023_slice25_plain_delete_received.sql`. Never edit 0001–0022 (live). Do NOT apply
remotely; no Supabase MCP tools; PGlite tests only. Replaced functions: copy the LATEST definition, change only what is
described, keep grants.

## A. Delete just removes (no automatic «↩︎ Возврат»)
Slice 24 made `public.delete_purchase(uuid)` (0022) create one «↩︎ Возврат: <title>» purchase per debtor whose share was
already settled. The user does not want that: a deleted purchase must simply disappear.
- `public.delete_purchase(p_id uuid)` (0022): keep everything (permissions, pair locks, the settlement_shares cleanup /
  re-total of marked settlements, the 🗑 Telegram post) EXCEPT the refund loop — remove it, and the «Вернётся: …» part
  of the post. Settled shares just go away with the purchase; confirmed settlements stay as history.
- Data step at the end of the migration: delete the automatic refund purchases created by slice 24, i.e. purchases with
  `source = 'manual' and description like '↩︎ Возврат: %'` whose shares are exactly (old payer: unsettled, refund payer:
  0 settled) — and only if none of their shares is settled with amount > 0 and none is referenced by settlement_shares.
  (Live there are exactly 4, created 2026-11-16 09:01: «↩︎ Возврат: Хлеб» ×2, «↩︎ Возврат: Су» ×2.) Delete their
  `private.telegram_sent` rows too. No Telegram post for this cleanup.
- App: PurchaseDetailScreen's delete confirm — drop the slice-24 «За неё уже платили — эти деньги вернутся им в
  долгах.» caption; when something was already paid show instead «Покупка удалится полностью, долги пересчитаются.»
  Swipe-to-delete in the purchases list must use the same RPC (check it does). Mock repo: same rule (no refunds).
  Update slice 24 tests (db/unit/e2e) that asserted refunds → assert plain removal.

## B. The creditor marks «X перевёл мне»
Today only the debtor marks a transfer. Add: the person who is owed (creditor) can record that the debtor sent money.
- New `public.mark_received(p_household uuid, p_from uuid) returns public.settlements`, security definer,
  `search_path = ''`, grant to authenticated only: caller = creditor (auth.uid()); p_from an active member ≠ caller;
  requires `private.pair_net(p_household, p_from, caller) > 0` (p_from owes caller) else 23514 `nothing_owed`;
  same min-transfer rule as marking (< min_transfer → 'too_small' P0001 — the existing write-off covers small debts).
  It reuses `private.mark_settlement_for(p_from, p_household, caller)` (0020: creates the settlement and finalizes it,
  so shares get settled and the «рассчитались» post fires). Rate limiting: whatever mark_settlement_for already does.
  Anon surface stays 13.
- App: on `/settle/<userId>` when THEY owe ME (direction they_pay / «тебе должны»), add a secondary action next to
  «Напомнить»: «{Имя} перевёл мне» (use the declension helpers already used on that screen). Tap → confirm sheet
  «{Имя} перевёл тебе {сумма}?» with «Да, получил» / «Отмена» (reuse the existing confirm / PaidPromptSheet style — no
  new design). On success the debt closes (toast «Готово ✓ — долг закрыт»). Repo method `markReceived` in repo.ts /
  supabaseRepo / mockRepo (same rules) + contract tests. Error mapping: nothing_owed / too_small → short ru messages.

## C. The «Ты перевёл?» DM after 20 s instead of ~150 s
- `src/lib/server/paidHandler.ts` `ASK_DELAY_MS = 150_000` → `20_000`. The routes `src/app/api/settle/opened/route.ts`
  and `src/app/api/k/[code]/open/route.ts` have `maxDuration = 170` — lower to 40 (literal) and keep the mirror constant
  consistent. Fix comments that say «~150 s» / «2,5 мин».
- The DB side may also gate the notice by the prompt's age (grep `paid_prompt_notice` and any `interval` near
  `opened_at` in 0015/0017): if it requires the prompt to be older than ~2 min, lower that to 15 seconds in the new
  migration (copy the latest definition). Keep the 30-minute expiry as is.
- Any ru text promising «через пару минут» etc. → adjust.

## Tests
- `tests/db/slice25.test.ts` (PGlite): A1 delete with settled shares → no refund purchases, 🗑 post without «Вернётся»;
  A2 the cleanup removes exactly the slice-24 refund shape and leaves a manual purchase with a similar name but a
  different shape; B1 creditor marks received → settlement confirmed, shares settled, pair_net 0, one «рассчитались»
  post; B2 not owed / small / stranger / self → errors; anon count 13; C1 notice works for a 20-s-old prompt (if the
  gate exists).
- Unit tests for ASK_DELAY_MS and the repo method; e2e (mock): creditor opens a «тебе должны» pair → «… перевёл мне» →
  «Да, получил» → debt closed. Update slice 24 refund e2e to plain removal.
Run `npx tsc --noEmit`, `npx vitest run`, the settle/paid/purchase e2e specs (whole files).
