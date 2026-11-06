# Общак — System Design Document (MVP)

Version 1.0 · 2026-11-06 · Owner: Ерасыл

## 1. Problem

Four students share an apartment in Kazakhstan. Almost every day one of them buys shared things (bread, potatoes, water, cleaning supplies). Today the buyer divides the amount by hand, posts "send me X" in a group chat, then tracks who paid and chases whoever forgot. There are also monthly costs (rent, utilities, internet). Everyone pays with **Kaspi** (Kaspi Gold card via Apple Pay), and everyone uses an **iPhone**.

## 2. Goal

A free **PWA** ("Общак") that:
1. captures a shared purchase with almost no typing (Apple Pay → iOS Shortcuts automation → our API),
2. splits it automatically,
3. tracks who paid and confirms receipt,
4. nets debts **pairwise** so people make fewer transfers,
5. reminds debtors automatically,
6. handles monthly bills.

## 3. Locked decisions (do not re-litigate)

| Area | Decision |
|---|---|
| Platform | PWA installed via Safari → "На экран Домой". No App Store, no TestFlight, no paid Apple account. |
| Stack | Next.js (App Router) + TypeScript + Tailwind CSS + `motion/react` |
| Backend | Supabase: Postgres + Auth (email OTP code) + Realtime. Row Level Security on every table. |
| Hosting | Vercel (Hobby). Vercel Cron for daily jobs (Hobby allows once a day). |
| Push | Web Push (VAPID) + Service Worker; iOS 16.4+ for home-screen PWAs. Badging API for the icon counter. |
| Payments | No payment API. Kaspi has no public P2P API. The "Pay" button copies the creditor's phone number to the clipboard and opens `https://kaspi.kz/transfers` (verified on iPhone: opens Kaspi on the Transfers screen; query params are ignored; `/transfers/phone` errors; custom schemes don't work). |
| Payment confirmation | Manual: the debtor taps "Я оплатил", then the creditor taps "Получил". |
| Receipts | **Out of scope entirely.** No receipt scanning, no receipt photos. Everything goes through Kaspi. |
| Currency | KZT only, whole tenge (integers). |
| Language | UI in Russian. |

## 4. Users and roles

- **Member**: belongs to one or more households ("Квартира 42", "Дача", "Поездка"). Has a display name, an avatar color and a Kaspi phone number.
- **Admin**: the creator of the household. Can edit monthly bills and remove members.
- **Away**: a member can be marked away until a date. Away members are excluded from new splits by default.

## 5. Design (approved: follow exactly)

Source of truth: the design canvas https://claude.ai/artifact/N3yzqjwmySBN4ZxT1eLtMx. It has 7 screens plus a "Токены дизайна" board.

### 5.1 Tokens

- **Colors:** `bg #0E0F13`, `card #1A1C22`, `card-2 #2C2F37`, `text #F2F3F5`, `muted #8B8F98`, `lime #C8F25A`, `on-lime #1A2300`, `lime-soft #2A2D1A`, `orange #FF8A5B` ("you owe"), `on-orange #2B0E02`. Dark theme only.
- **Font:** SF Pro (system stack `-apple-system, "SF Pro Text", system-ui`). Money amounts use SF Pro Rounded (`ui-rounded`) Bold with tabular numbers.
- **Type scale:**
  - display 40/700 Rounded
  - title 22/700
  - amount 20/700 Rounded
  - headline 17/600
  - body 15/400
  - caption 13/400 (muted color)
  - label 12/500
- **Spacing:** 4 / 8 / 12 / 16 / 24.
- **Radius:** 12 / 20 / 28 / pill (999).

### 5.2 Components

- **Capsule style, everywhere:**
  - `bar` is a capsule with a 94% card background, a 1px `card-2` border and 6px padding.
  - Inside it sit `pill` items: the active pill is `card-2`, the primary pill is `lime`.
  - `fab` is a 58px lime circle next to a bar.
  - Headers are a bar holding a circular back button and the title.
  - Segmented controls are a bar with pills.
  - Bottom actions are a floating bar plus a fab or primary pill.
  - List rows are pill-shaped with a round avatar.
- **Balance:** a stack of cards, one per household, with a lime front card showing the balance in display type.
- **Debts summary card:** an orange/lime split bar, the caption "ты должен X / тебе должны Y" and one "Рассчитаться" button.
- **Floating tab bar:** Главная · Покупки · Ежемесячно · Квартира, plus a lime "+" fab.

### 5.3 Screens

1. **Главная.** Greeting, card stack, quick actions (Покупка, Напомнить, Расчёт, Ежемесячно), debts summary card, recent purchases, tab bar.
2. **После оплаты Apple Pay.** The native app idea used a Dynamic Island; the PWA uses a **push notification** instead. It reads "Magnum · 6 000 ₸ — что купил?", its actions are "Общее" and "Моё", and long-pressing it gives a text reply for what was bought. Tapping it opens an in-app sheet with the same content (merchant, amount, category chips Продукты / Хлеб / Вода / Бытовое / Написать…, "Общее · по N ₸" / "Моё").
3. **Покупка.** A lime card (description, merchant, time, payer, amount, "на N человек", "по X ₸") and a list of "Кто скинул" rows (received ✓ / waiting + Напомнить). Delete.
4. **Расчёт с <person>** (netting).
   - Two avatars with opposite arrows: Ты → А 2 000 ₸ (orange) and А → Ты 1 800 ₸ (lime).
   - The equation `2 000 − 1 800 = 200 ₸` in a pill, with the caption "Один перевод вместо двух".
   - Two columns listing what each side owes for.
   - The creditor's Kaspi number shown as "скопирован".
   - Bottom bar: "Я оплатил" (on-pill) and "Перевести 200 ₸ ↗" (lime pill), which copies the number and opens Kaspi.
5. **Новая покупка.** Big amount input, a "what" input, a "Кто платил" segmented bar, a "Как делить" bar (Поровну / Свои суммы), "На кого" person pills, and a bottom bar "по X ₸ · на N человек" plus a lime ✓ fab.
6. **Ежемесячно.** A month pill, a bar with "Всего" and "Твоя доля" (lime), bill cards (Аренда / Коммуналка "нужна сумма" + Ввести / Интернет) with progress, and a bottom bar plus a "+" fab.
7. **Квартира.** A lime invite-code card (Поделиться / QR), member pill rows (Kaspi number missing is shown in orange, away until date), and a "Напоминания 19:00" toggle.

### 5.4 Motion (approved)

- **Curves:** `smooth` = cubic-bezier(.22,1,.36,1) is the default. `soft-spring` = cubic-bezier(.34,1.18,.64,1) is used only for success states and pop-ins.
- **Tab bar:** the active pill slides between tabs (shared layout animation).
- **"+" fab:** morphs into a menu (Покупка / Ежемесячный платёж). It must **not** rotate.
- **Purchase sheet:** grows from a small pill into the full sheet, the content fades in late, and it collapses back with a check "Поделено" (this was approved as the v1 "island" motion).
- **Netting:** the lime arrow slides onto the orange arrow and dissolves, leaving one arrow Ты → А, while the amount counts down 2000 → 200 and settles with a slight scale.
- **"Получил":** the button shrinks into a ✓ and the progress bar fills. No confetti.
- **Card stack:** the front card moves to the back and the next card comes forward.
- **Numbers:** they roll when they change.
- **Performance rules:**
  - Animate only `transform` and `opacity`; never animate width, height, shadows or blur during motion.
  - Ignore taps while an animation is running.
  - Respect `prefers-reduced-motion` by falling back to a fade.
- **No-lag checklist:**
  - Service Worker caching.
  - Prefetch screens.
  - Optimistic updates with rollback.
  - Skeletons instead of empty screens.
  - Remove the 300ms tap delay and tap highlight.
  - Disable overscroll bounce on body.
  - Inputs at ≥16px to prevent zoom.

### 5.5 Copy

UI copy is short ("Один перевод вместо двух", "нужна сумма").

## 6. Core flows

### 6.1 Onboarding

1. Open the link and enter an email to get a 6-digit code (Supabase OTP).
2. Enter a name and Kaspi phone.
3. Create a household or join one by invite code or link.
4. Prompt to "Add to Home Screen", then prompt to enable push.

### 6.2 Apple Pay capture (main flow)

1. A one-time setup screen gives each user a personal **Shortcut token** and step-by-step instructions to create an iOS Shortcuts automation:
   - Trigger: "When I tap Kaspi Gold" (Wallet transaction trigger).
   - Action: "Get contents of URL", a POST to `/api/capture` with JSON `{ token, amount, merchant }`, built from the Shortcut Input transaction fields.
2. The API stores a **pending** purchase and sends a push: "Magnum · 6 000 ₸ — что купил?" with actions "Общее" and "Моё".
3. On "Общее" or "Моё", or when the sheet is completed in the app, the purchase becomes **shared** or **personal**:
   - Shared: it is split equally among the active, non-away members, and every debtor gets a push "Ерасыл купил хлеб, картошку · с тебя 1 500 ₸".
   - Personal: nothing is shared. Personal purchases are not shown to others.
4. Pending purchases not answered within 24h stay in an "Ждут решения" section.

### 6.3 Manual purchase

Use the "+" fab and the Новая покупка screen. You can choose the payer (anyone in the household), equal split or custom amounts, and who is included.

### 6.4 Paying and confirming

1. A debtor opens Расчёт with the creditor and sees the pairwise netted amount.
2. "Перевести" copies the phone number and opens Kaspi. "Я оплатил" creates a settlement in the `marked` state, and the creditor gets a push.
3. The creditor taps "Получил", which confirms the settlement. All open shares between the pair, in both directions, that the settlement covers are marked settled.

### 6.5 Reminders (Cron, daily at 19:00 Asia/Almaty)

- A push goes to every member with an unpaid net debt older than 24h: "Ты должен Айдосу 200 ₸".
- A "Напомнить" button sends an immediate push to a person, with a cooldown of 1 per 6h per pair.

### 6.6 Monthly bills (Cron, daily)

- On a bill's `day_of_month`, create a shared purchase for that bill (source `monthly`), paid by the bill's payer.
- If the bill amount is variable and missing (utilities), mark it "нужна сумма" and notify the payer. The purchase is created when the amount is entered.

## 7. Netting rule (must be exact)

For a pair (A, B):
- `owes(A→B)` = the sum of open (unsettled) share amounts where A is the debtor and B is the payer.
- `net = owes(A→B) − owes(B→A)`.
  - If `net > 0`, A pays B `net`.
  - If `net < 0`, B pays A `−net`.
  - If `net = 0`, they are even.

Example: A owes B 2 000, B owes A 1 800, so A pays B 200.

Confirming a settlement of `net` closes **all** open shares in both directions between A and B that existed when the settlement was created.

There is no multi-party (graph) simplification in the MVP; netting is pairwise only.

The home "Баланс" is the sum over all pairs of the signed net from the user's point of view.

Splitting `amount` among N people:
- `base = floor(amount / N)`.
- The remainder `amount − base·N` is added one tenge at a time to the shares of non-payers, in member order.
- The payer's own share is recorded as settled immediately, because nobody owes themselves.

## 8. Data model (Postgres, all tables with RLS)

- `profiles` (`id` = auth.users.id, `display_name`, `kaspi_phone`, `avatar_color`, `created_at`)
- `households` (`id`, `name`, `invite_code` unique, `created_by`, `created_at`)
- `members` (`household_id`, `user_id`, `role` admin|member, `away_until` date null, `joined_at`; PK (`household_id`, `user_id`))
- `purchases`:
  - `id`, `household_id`, `payer_id`
  - `amount` int > 0
  - `description` text, `merchant` text null
  - `source` apple_pay|manual|monthly
  - `status` pending|shared|personal
  - `created_at`
- `shares` (`purchase_id`, `debtor_id`, `amount` int ≥ 0, `settled_at` null, `settlement_id` null; PK (`purchase_id`, `debtor_id`))
- `settlements`:
  - `id`, `household_id`, `from_id`, `to_id`, `amount`
  - `status` marked|confirmed|cancelled
  - `marked_at`, `confirmed_at`
- `bills` (`id`, `household_id`, `title`, `icon`, `amount` int null, `variable` bool, `day_of_month` 1–28, `payer_id`, `last_generated_month` text null)
- `push_subscriptions` (`user_id`, `endpoint` unique, `p256dh`, `auth`, `created_at`)
- `capture_tokens` (`user_id`, `token_hash` unique, `created_at`, `last_used_at`)
- `reminder_log` (`from_id`, `to_id`, `sent_at`)

**RLS:**
- A user can read and write only rows of households where they are a member.
- `personal` purchases are visible only to their payer.
- Writes go through server actions or RPCs where they must be validated: split math, and settlement confirmation, which only the creditor may do.

## 9. API surface

- `POST /api/capture`: called by the iOS Shortcut.
  - Auth: the capture token, looked up by its SHA-256 hash.
  - Body `{ token, amount, merchant }`. `amount` may arrive as a localized string ("6 000,00 ₸"), so parse it robustly.
  - Rate limit: 30 per hour per token.
  - Creates a pending purchase and sends a push.
- `POST /api/push/subscribe` and `DELETE /api/push/subscribe`.
- Notification action handler: a Service Worker `notificationclick` with an action, which calls a server action to resolve the pending purchase. Reply text is used if the platform supports it; otherwise the app opens the sheet.
- `GET /api/cron/daily`: protected by `CRON_SECRET`; runs reminders and bills.
- Server Actions:
  - `createPurchase`, `resolvePending`, `deletePurchase`
  - `markPaid`, `confirmSettlement`
  - `remind`
  - `createHousehold`, `joinHousehold`
  - `upsertBill`, `setBillAmount`
  - `updateProfile`, `rotateCaptureToken`

## 10. Non-goals for MVP

- Receipts or receipt scanning.
- Native iOS app, Dynamic Island, Live Activities.
- Kaspi API integration and automatic payment verification.
- Multi-currency.
- Multi-party debt graph simplification.
- Android-specific polish (it works, but is not targeted).

## 11. Quality bar

- **Unit tests:** 80%+ coverage for split math, netting and amount parsing (TDD).
- **Playwright E2E:** the happy path "capture → share → mark paid → confirm" and the netting screen.
- **No lag:** 60fps animations on iPhone (transform and opacity only), a fast second launch from the SW cache, and optimistic UI.
- **Security:** RLS on all tables; the capture token stored hashed; secrets only in Vercel env; `CRON_SECRET` checked; input validated with zod.
- **Free tiers only:** Vercel Hobby, Supabase Free.
