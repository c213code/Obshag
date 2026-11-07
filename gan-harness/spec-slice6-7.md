# GAN spec: Slices 6 + 7, "Monthly bills + Квартира" (lean process)

Read `docs/SDD.md` §5.3 (screens 6 and 7), §6.6 and §8, and `gan-harness/generator-state.md` (slices 0–5). Reuse everything that already exists.

**Visual truth:** `docs/design/Bills.dc.html` and `docs/design/Invite.dc.html`. Also reuse the capsule kit and the Fab menu: «Ежемесячный платёж» must stop being «скоро». The user rejects drift.

**Database:** 0001–0005 are LIVE; never edit them. Put new SQL in `supabase/migrations/0006_slice6_7.sql`. Do not touch `.env.local`. No service-role key. The server-secret pattern from 0005 is available.

## A. Monthly bills (slice 6)

**`/monthly` (the Ежемесячно tab), per `Bills.dc.html`:**
- A month pill, with arrows for the previous and next month.
- A bar with «Всего» and «Твоя доля» in lime.
- One card per bill: icon, title, «N числа · платит X», amount, and progress for the month's generated purchase («все скинули» / «N из M»).
  - A variable bill without an amount is shown in orange: «нужна сумма» with an «Ввести» pill.
- A bottom bar plus a «+» fab to add a bill.

**Bill form** (a sheet or page):
- title
- icon choice: home / drop / wifi / bolt / other
- fixed amount, or a «Переменная сумма» toggle
- `day_of_month` 1–28
- payer, any active member (default: me)
- participants, all active members by default

Admins create and edit bills.

**RPCs:**
- `upsert_bill(p_household, p_id nullable, p_title, p_icon, p_amount nullable, p_variable, p_day, p_payer, p_participants uuid[])`
  - admin only
  - the payer and every participant must be active members
  - add a `bills.participants uuid[]` column
- `delete_bill`, admin only
- `set_bill_amount(p_bill, p_month 'YYYY-MM', p_amount)`
  - allowed for the payer or an admin
  - for a variable bill, this creates that month's purchase if it is due and was not created yet

**Generation.** Make it idempotent and run it from the existing daily cron:
- `run_monthly_bills(p_secret)`, anon-executable and server-secret gated.
- In Asia/Almaty time, for each bill with `day_of_month <= today's day` and `last_generated_month < current month`:
  - **Fixed amount:** create a shared purchase (source `monthly`, payer = bill payer, description = title, equal split among the participants using the existing helpers) and set `last_generated_month`.
  - **Variable without an amount:** create nothing, and return «нужна сумма» notices for the payer: the push «Коммуналка: введи сумму за ноябрь».
- A second run in the same month creates nothing.
- February: day ≤ 28 is guaranteed.
- Extend `/api/cron/daily` to call it after the reminders, and push the notices.

**Bill payments** use the normal purchase and netting flow: a bill purchase is just a purchase.

## B. Квартира tab (slice 7), per `Invite.dc.html`

- The lime invite card shows the code in `XXXX-XXXX-XXXX` format.
  - «Поделиться» uses the Web Share API with the deep link `https://<origin>/join/<code>`; without Web Share it falls back to copy.
  - «QR» opens a sheet with a QR code. Use a tiny dependency-free QR generator, or the `qrcode` npm package rendered to SVG with token colors.
- Members are pill rows: avatar, name, a «(ты)» marker, «админ»; a missing Kaspi number in orange; «в отъезде до DD.MM».
- **Меня нет дома:** an «Я уезжаю» date picker sets my own `away_until`. While away, I am excluded from the default participants (the slice 2 rule already exists).
- **Admin actions**, from a sheet on a member row:
  - «Сделать админом» / «Убрать из админов». The last admin is protected by the existing trigger.
  - «Удалить из квартиры». This is blocked while the member has a non-zero net with anyone, and then shows «Сначала рассчитайтесь».
- **Покинуть квартиру** for myself, with the same zero-net rule.
- **Сменить код:** admin only, generates a new invite code.
- **Профиль** row: edit name and Kaspi phone (`upsert_profile` exists).
- **Переключение квартир:** when I belong to several households, the CardStack switches the active one. Persist it with `set_default_household`, so capture uses it too.
- **Keep:** the «Apple Pay → Общак» row and the «Напоминания» toggle.

**RPCs:** `set_member_role`, `remove_member`, `leave_household`, `rotate_invite_code`, `set_away`. All are security definer with `search_path=''`, taking the actor from `auth.uid()`. Their zero-net checks use `private.pair_net` over all pairs.

## Tests (lean)

- **PGlite**:
  - bill generation idempotency, the Almaty date boundary, variable without amount → notice and no purchase, `set_bill_amount` then the purchase is created
  - admin-only checks
  - remove/leave blocked with a non-zero net
  - role changes respect the last-admin guard
  - away exclusion
  - the anon surface is exactly the 4 functions: `capture_purchase`, `prune_push_subscription`, `run_daily_reminders`, `run_monthly_bills`
- **Unit:** the QR encoding sanity check and the code format helper.
- **E2E (once):**
  - add a fixed bill, then trigger the mock cron, and the purchase appears with the shares
  - a variable bill shows «нужна сумма», then «Ввести» creates the purchase
  - invite share falls back to copy
  - set away, then away members are excluded in a new purchase
  - leave is blocked with a debt

## Done when

- `npm run verify` is green and `npm run test:e2e` is green once.
- Side-by-side screenshots `gan-harness/screenshots/s67-cmp-bills.png` and `s67-cmp-flat.png` exist.
- Russian copy goes through `ru.ts`, there is no raw hex outside tokens, and animation uses only transform/opacity.
- Nothing is committed.
