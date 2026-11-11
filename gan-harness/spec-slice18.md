# GAN spec — Slice 18: заказы внутри общей покупки + «кто платил» + админ-правка покупки

User chose: «A + плательщик».
Case: one person buys shared groceries (e.g. 3000 ₸) and someone asks to also buy something personal (energy drink 500 ₸). Also: when the water was brought, the person who pressed «Принёс» became the payer although someone else paid (we had to fix it by hand in SQL).

Read generator-state.md first (slice 2/5 purchases + custom split, slice 4/10 capture + resolve_pending «Общее/Моё/Потом», slice 9/12 Telegram group post `private.tg_purchase_message` + DM resolve, slice 11 admin delete, slice 13 min 100, slice 15 water `water_brought`, slice 17 paid prompts). Migrations 0001–0015 are LIVE — new SQL only in `supabase/migrations/0016_slice18_orders_payer.sql`. No commit, no stash, no live apply, never touch .env.local, never print secrets.

## A. «+ Заказ» (personal orders inside a shared purchase)
- Data: `public.purchase_orders(purchase_id, household_id, user_id, amount int > 0, note text ≤ 60)`; RLS read = household members (same as purchases); writes only via RPCs. Shares stay the single source of truth for balances.
- Math: `rest = total − Σorders` (must be ≥ number of participants, error otherwise); rest is split equally among participants with the existing rounding helper (`private.insert_equal_shares` logic); each person's share = equal part + own orders. A person who ordered need not be in the shared participants (then share = only the order). The payer's own part is auto-settled as today. Orders by the payer himself are not allowed (it's just his money).
- Example to test: total 3000, participants 4 (payer А + Б, В, Г), order Г 500 → А 625✓, Б 625, В 625, Г 1125.
- Where: (1) the manual purchase form; (2) resolving a pending Apple Pay capture as «Общее» in the app sheet. Add a «+ Заказ» row button under participants → inline row: person picker (chips) + amount + optional note; several orders allowed; live preview «Каждому 625 ₸ · Нурдаулет 1125 ₸». Telegram DM «Общее» button keeps old behaviour (no orders) — orders are added in the app.
- RPCs: extend via NEW functions (do not change live signatures): `create_purchase_with_orders(household, amount, description, merchant, participant_ids, orders jsonb)` and `resolve_pending_with_orders(purchase, description, participant_ids, orders jsonb)`; validate orders (members, amounts, sum, not payer, ≤ 20 rows); security definer, search_path='', actor checks, min/max amounts same as existing.
- Group message: `tg_purchase_message` gets order lines: «+ заказ: @nurdaulet 500 ₸ (энергетик)» and per-person totals stay correct. Replace the function with create or replace (same signature).
- Purchase detail screen shows an «Заказы» block.

## B. «Кто платил?» for water
- «Принёс» flow (water card): after picking the partner, a segmented choice «Кто платил?»: Я / <partner> (and «Другой» → member picker). Default «Я».
- SQL: drop + recreate `public.water_brought(p_duty uuid, p_partner uuid, p_payer uuid default null)` — old 2-arg calls must keep working (null → actor). The payer must be an active household member. Purchase payer_id = payer; queue logic (duty_events.user_id/partner_id = who went) unchanged. Re-grant execute to authenticated exactly like before; anon surface stays 10.

## C. Admin edits a purchase
- On the purchase detail (admin, or the payer himself): «Изменить» → sheet with amount, description, payer, participants, orders (reuse the form components). Saves via `update_purchase(p_id, amount, description, payer, participant_ids, orders jsonb)`: allowed only while no share of that purchase is in a settlement (`settlement_id is not null`) or settled by anyone except the payer's auto-settle; otherwise error «already paid — cannot edit». Rebuild shares + orders in one transaction. Bill purchases (bill_id not null) and pending captures: not editable here.
- After an edit the bot posts to the group: «✏️ Исправлено: <old line> → <new line>» (via the same tg_send path with telegram_sent dedupe keyed by a new kind, e.g. 'purchase_edit' + a new uuid per edit; never break the transaction).

## Rules
Tokens only, both themes, copy in ru.ts, existing Sheet/chips/amount components — match the existing purchase form look exactly (docs/design/AddPurchase.dc.html and Purchase.dc.html are visual truth). Tests: PGlite (orders math incl. the 3000/500 example, rest < participants error, order by payer rejected, resolve with orders, water payer default + explicit + non-member rejected, update_purchase allowed/blocked, tg message contains order line, anon surface 10), unit (preview math shared with SQL rules), e2e (form with «+ Заказ» → detail shows orders and balances; water «Кто платил» → partner is payer; admin edit changes payer). `npm run verify` green. Append «Slice 18» to generator-state.md. Final report: short, list gaps honestly.
