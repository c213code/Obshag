# GAN spec: Slice 13, "Kaspi minimum 100 ₸" (lean process)

**User problem:** Kaspi can't transfer less than 100 ₸. A 350 ₸ loaf split by 4 is 75 ₸ each. Netting already accumulates debts per pair across purchases, so the only problem is when the **pair net is between 1 and 99 ₸**.

**User decision:** small debts can be written off by the creditor («Списать (Рекомендую)»).

**Before you start:**
- Read `gan-harness/generator-state.md`, migrations 0003 (settlements), 0005 (reminders, remind), 0007/0009 (Telegram), 0010.
- New SQL goes in `supabase/migrations/0011_slice13_min_transfer.sql`; 0001–0010 are LIVE.
- No commit or stash. Do not touch `.env.local`.
- The design must match the current theme tokens (light and dark).

## Rule

`MIN_TRANSFER = 100` ₸. Use one constant in TS (`src/lib/domain/…`) and one in SQL (a `private.min_transfer()` immutable function).

## SQL (0011)

1. **`run_daily_reminders`:** skip pairs whose net is below 100. Replace the function with the same signature.
2. **`remind`:**
   - Raise `too_small` (errcode `P0001`, a distinct message) when the net is below 100.
   - No reminder log entry and no Telegram post in that case.
   - Keep everything else, including the 0009 Telegram post.
3. **`mark_settlement`:** refuse when the net is below 100 (`too_small`), so nobody marks a transfer Kaspi can't do.
4. **Write-off:**
   - Add `settlements.kind text not null default 'transfer' check (kind in ('transfer','writeoff'))`.
   - New RPC `write_off_small(p_household uuid, p_debtor uuid)`, authenticated, actor = `auth.uid()` = the **creditor**.
   - It locks the pair (the existing `lock_pair` and lock order).
   - It requires `0 < net(debtor→me) < 100`.
   - It creates a settlement with `kind = 'writeoff'`, `status = 'confirmed'`, amount = net, `settlement_shares` = the covered open shares, and marks those shares settled. This is exactly the confirm path, so balances and netting stay correct; reuse the confirm helpers.
   - It returns the settlement.
5. **Telegram:**
   - The 0007 settlement trigger posts `🧾 @creditor списал(а) @debtor 75 ₸ (меньше 100 — Kaspi не переводит)` for a writeoff instead of «рассчитались».
   - Add a `tg_writeoff_message` builder.
6. **Anon surface:** unchanged.

## App

- **Settle screens** (list and pair):
  - When `0 < |net| < 100`, show a muted «копится» state: «75 ₸ — меньше 100 ₸, Kaspi не переведёт. Копится до следующих покупок».
  - There are no Kaspi, «Я перевёл» or «Напомнить» actions in that state.
  - The creditor sees a secondary pill «Списать 75 ₸» with a confirm sheet: «Списать 75 ₸ у Айдоса? Долг закроется без перевода.».
- **Главная:**
  - The bento «Тебе должны / ты должен» tile shows amounts below 100 per pair as «копится» (muted, not danger).
  - «Напомнить» is shown only if some pair is ≥ 100.
  - BadgeSync does not count people I owe less than 100.
- **Purchase detail:** when my share is below 100, show a note «Твоя доля 75 ₸ — добавится к следующему расчёту (Kaspi переводит от 100 ₸)».
- **Settlement history:** a writeoff shows as «Списано 75 ₸».
- **Mock repo:** supports all of this.
- Copy goes in `ru.ts`; colours are tokens only.

## Tests

- **PGlite:**
  - reminders skip below 100;
  - remind raises `too_small` and writes no log;
  - `mark_settlement` refuses below 100;
  - `write_off_small` works only for the creditor, only for 1–99, closes exactly the open shares (net becomes 0), and is refused at ≥ 100 or by the debtor;
  - the writeoff Telegram message builder;
  - the anon surface.
- **Unit:** the TS threshold helpers.
- **E2E (once):**
  - a 350 ₸ purchase split 4 ways shows «копится» and no Kaspi button;
  - the creditor writes it off and the debt disappears.
- `npm run verify` is green, touched e2e specs are green.
- Append «Slice 13» to `generator-state.md`.
