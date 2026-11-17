# Slice 26 — one receipt, part shared and part mine («Из них моё»)

User: «я когда купил что-то на общак, потом себе что-то — я не могу это поделить».
One Apple Pay / one receipt often has shared items AND the payer's own items. Today a shared purchase splits the WHOLE
amount; «+ Заказ» exists for other people's orders, but the payer is explicitly blocked («Плательщик не заказывает: это
его деньги», `private.check_orders` in 0016).

## Rule
A shared purchase may carry a «моё» amount for the payer: it is taken out BEFORE the equal split, exactly like an order
for the payer. Example: 3 000 ₸ total, моё 1 000 ₸, 4 people → 2 000 / 4 = 500 each; the payer's own share is
500 + 1 000 = 1 500 (settled, as payer shares always are); each other person owes 500.

## A. Database — `supabase/migrations/0024_slice26_payer_part.sql`
Never edit 0001–0023 (live). PGlite tests only; do NOT apply remotely (the orchestrator applies it).
Copy LATEST definitions, change only what is described, keep grants.
- `private.check_orders` (0016): allow an order whose user_id = the payer (at most one such entry; amount ≥ 1; the
  rest after all orders must still be enough for the participants, as today). Keep every other check.
- `private.insert_shares_with_orders` already handles any order user (full join on user) — verify the payer's order
  lands in the payer's own (settled) share and is NOT owed by anyone. Fix only if needed.
- `private.tg_purchase_message` (latest 0016): a payer's order is not a «+ заказ» line; append it to the «Платил»
  line instead: `Платил: @x (себе 1 000 ₸)`. Other orders unchanged.
- Everything that validates/creates/resolves/edits with orders (create_purchase_with_orders, the pending resolve with
  orders, update_purchase) goes through check_orders — confirm no other place rejects payer orders.

## B. App
- Wherever orders are entered (purchase form, the pending «Разобрать» sheet, the edit sheet — find the shared orders UI
  component): add above the orders list a single optional field «Из них моё» (amount, ₸) shown when the purchase is
  «Общее». It maps to an order with user_id = payer (note null). The orders list itself keeps excluding the payer from
  its person picker (so there is exactly one way to enter «моё»).
- Remove/adjust the client validation and the ru string `orders.payer` («Плательщик не заказывает…»).
- Live preview of the split (if the form shows per-person amounts) must reflect the «моё» part.
- Purchase detail: show «Моё: 1 000 ₸» (payer's part) in the orders block caption style, separate from «+ заказ» rows.
- Mock repo + domain (any TS split preview / mirror of check_orders): same rule.
- ru: `orders.mine` = «Из них моё», `orders.mineHint` = «Эта часть не делится — только твоё», detail label «Моё».
- No redesign: reuse the existing amount input and caption styles.

## Tests
- `tests/db/slice26.test.ts`: 3 000 / моё 1 000 / 4 people → 500×3 owed + payer 1 500 settled; pair_net correct;
  two payer orders → error; моё leaving too little for the others → error; Telegram text has «(себе 1 000 ₸)»;
  pending resolve and update_purchase accept the payer part; anon count 13.
- Unit tests for the TS mirror; e2e (mock): add a shared purchase with «Из них моё» → detail shows «Моё», each other
  person owes the right amount.
Run `npx tsc --noEmit`, `npx vitest run`, the purchase/orders e2e specs (whole files, `--workers=1`).
