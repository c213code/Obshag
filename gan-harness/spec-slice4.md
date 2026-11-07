# GAN spec: Slice 4 "Apple Pay capture + push" for Общак

Read first:
- `docs/SDD.md` §5.3 (screen 2), §5.4 (island motion), §6.2 (Apple Pay capture), §9, §11.
- `docs/PLAN.md`, Slice 4.
- `gan-harness/generator-state.md`, for slices 0, 1 and 3. Reuse the UI kit, repos, trackers and auth.

**Visual source of truth.** The user rejects drift from these. Compare side by side.
- `docs/design/ApplePay.dc.html`: the after-payment experience, including chips and the "что купил" text input.
- `docs/design/motion-reference.html` #2: the APPROVED "island" sheet. It grows from a black pill, the content fades in late, and it collapses back to a pill showing ✓ «Поделено».
- `docs/design/Main.dc.html`: the Главная section style.

**Live database rules.**
- 0001, 0002 and 0003 are LIVE. Never edit them. New SQL goes in `supabase/migrations/0004_slice4_capture.sql`.
- PGlite tests apply all migrations in order.
- If you need pgcrypto, use the `extensions` schema on Supabase. In PGlite, load the pgcrypto contrib and create the `extensions` schema to mirror Supabase.
- Do not touch `.env.local`.

## No service-role key

The capture endpoint must not need `SUPABASE_SERVICE_ROLE_KEY`. Capture goes through a security-definer RPC that the anon role can execute. The RPC itself authenticates the caller by hashing the capture token.

## Goal

### 1. Capture token and Shortcut setup: `/settings/shortcut`

The page is reachable from the Квартира tab as a row, «Apple Pay → Общак».

- **«Создать ключ»** calls the RPC `rotate_capture_token()` (authenticated).
  - It generates 32 random bytes server-side (`extensions.gen_random_bytes`), encoded base64url.
  - It stores only the `sha256` hex hash (`extensions.digest`) in `capture_tokens`, replacing any previous token for that user.
  - It returns the plaintext once.
  - The UI shows the token one time, with a copy button and the warning «Сохрани — второй раз не покажем».
- Step-by-step Russian instructions with numbered capsule steps for an iOS Shortcuts personal automation:
  1. Команды → Автоматизация → «+» → **Кошелёк (Wallet)** → choose the Kaspi Gold card → «Запускать сразу».
  2. Add the action **«Получить содержимое URL»** with URL `<origin>/api/capture`, method **POST**, body **JSON** with these keys:
     - `token`: the token text
     - `amount`: the variable «Ввод команды → Сумма» (Shortcut Input → Amount)
     - `merchant`: the variable «Ввод команды → Продавец» (Merchant)
  3. Done.
- Copy buttons for the URL and the token.
- A note: «Работает, только если Общак добавлен на экран Домой и уведомления включены».
- A **«Включить уведомления»** pill:
  - It calls `Notification.requestPermission()`, then `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: NEXT_PUBLIC_VAPID_PUBLIC_KEY })`, then saves the subscription. `push_subscriptions` already has client insert/delete for the owner; upsert by endpoint.
  - It shows the states «включены» / «запрещены в настройках iOS» / «добавь на экран Домой» (when not in standalone mode on iOS).

### 2. `POST /api/capture` (Route Handler, Node runtime)

- Parse the body with zod: `{ token: string 20..200, amount: string|number, merchant?: string ≤120 }`.
- Parse the amount with a pure `parseAmount()` in `src/lib/domain/parseAmount.ts`. It must be lenient and table-tested, accepting:
  - `"6 000,00 ₸"`, `"6 000 ₸"` (with NBSP or a thin space), `"₸6,000.00"`, `"KZT 6,000.00"`
  - `"6000"`, `6000`, `"6000.5"` (rounds half up), `"1 234 567,89"`
- It rejects garbage, zero, negatives, and amounts over 10 000 000.
- Call the RPC `capture_purchase(p_token text, p_amount int, p_merchant text)` with the anon key client.
- Respond:
  - `201 {ok:true}`
  - `400` for a bad body or amount
  - `401` for a bad token (generic)
  - `429` when rate limited
  - `500` with no detail otherwise
- Never log the token or the body.
- After success, send a Web Push to the token owner's subscriptions, using the `web-push` lib with VAPID from server env.
  - Payload: `{type:'pending', purchaseId, merchant, amount}`.
  - Notification title «Magnum · 6 000 ₸», body «Что купил? Общее или моё».
  - Actions `[{action:'shared', title:'Общее'}, {action:'personal', title:'Моё'}]`.
  - Prune subscriptions that return 404 or 410. This needs a definer RPC `prune_push_subscription(p_token, p_endpoint)` that is token-authenticated, so the server never needs the service key. Alternatively, return the subscriptions from `capture_purchase` and prune through the same token-gated RPC.
- If VAPID env is missing, skip push silently. Capture still succeeds.

### 3. `0004_slice4_capture.sql`

**Visibility.** Pending purchases must be visible ONLY to the payer.
- Today `purchases_select` and `private.can_see_purchase` hide only `personal`.
- Create `private.can_see_purchase_v2` (or `create or replace` the 0001 function in 0004, which is allowed: replacing a function body is a forward migration, not an edit of 0001) and recreate the policies so that pending and personal are both payer-only.

**`capture_purchase(p_token, p_amount, p_merchant)`:**
- security definer, `search_path=''`. Grant execute to **anon** and authenticated, revoked from public.
- Hash the token and look up the user. On an unknown token, raise the generic 28000 «invalid token».
- Rate limit: 30 per token per hour, in `private.capture_ops` with a per-token advisory lock. Exceeding it raises P0001 `rate_limited`.
- Insert a purchase with `status='pending'`, `source='apple_pay'` and the payer = the token owner, into the owner's **default household**.
  - Add `profiles.default_household_id uuid null`.
  - If it is null, use the most recently joined active household.
  - If there is none, raise 23514 `no_household`.
- Description: `coalesce(merchant, 'Покупка')`. There are no shares yet.
- Update `capture_tokens.last_used_at`.
- Return the purchase id plus the owner's push subscriptions as `(endpoint, p256dh, auth)` rows or jsonb.

**`resolve_pending(p_purchase_id, p_shared bool, p_description text, p_participant_ids uuid[])`** (authenticated):
- The payer only, and only while the purchase is `pending`.
- Shared: set the description and status `shared`, then create shares with exactly the same equal-split rule as `create_purchase_with_shares`. Refactor that rule into a private helper used by both. A new helper in 0004 is fine; do not edit 0002's function body unless you replace it via `create or replace` in 0004.
- Personal: set status `personal` and the description.
- Idempotent per final state.
- The payer is the actor.
- Participants are validated like in 0002.

**`set_default_household(p_household_id)`** (authenticated, member only).

**Grants and tests.** Revoke everything from public, anon and authenticated, then grant explicitly. PGlite tests cover:
- token hashing (the plaintext is never stored)
- invalid token → 28000
- the 31st capture in an hour → rate limited
- a pending purchase is invisible to other members and visible to the payer
- resolve to shared creates the correct shares
- resolve to personal stays hidden
- a non-payer cannot resolve
- anon cannot call anything except `capture_purchase`
- anon cannot read any table

### 4. Service Worker + manifest (minimal; slice 8 polishes them)

**`public/manifest.webmanifest`:**
- name «Общак», `short_name` «Общак», `display: standalone`, `start_url: /`
- `background_color` and `theme_color` from tokens (in JSON it is OK to repeat the bg hex)
- 192/512 icons and an apple-touch-icon: a simple lime ₸ on bg, generated as PNG files

Also add apple-mobile-web-app meta tags in the layout.

**`public/sw.js`:**
- `push` → `showNotification` with actions, `data.url = /pending/<id>`.
- `notificationclick`:
  - with action `shared` or `personal`, open or focus `/pending/<id>?choice=shared|personal`
  - with no action, open `/pending/<id>`
- Never cache auth or API responses. No offline caching in this slice, beyond what is needed.

Register the SW from a client component, only in production builds or E2E.

### 5. Pending UI

**Главная** gets a «Ждут решения» section (top, above the Подтверди оплату section) with pill rows: merchant, amount, time, and a lime «Решить» pill.

**`/pending/[id]`** is the island sheet over Главная, exactly per motion reference #2 and `ApplePay.dc.html`:
- The black capsule grows from a pill into the card showing merchant + amount.
- Category chips: «Продукты», «Хлеб», «Вода», «Бытовое», «Написать…».
  - The first four set the description.
  - «Написать…» reveals a text input «Что купил?» (≥16px).
- «Общее · по N ₸» splits among all active members, using the same default as the new purchase screen.
- «Моё» makes it personal.
- After resolving, it collapses to a pill showing ✓ «Поделено» or «Моё», then closes.

When opened with `?choice=shared` or `?choice=personal` (from a notification action), the matching button is pre-selected. Do NOT auto-submit without a tap: the user still confirms the description quickly. Note this choice in `generator-state`.

Optimistic UI uses the tracker patterns. It refreshes on focus.

### 6. Repos

- Extend Repo with:
  - `rotateCaptureToken`, `capture` (mock only, for E2E)
  - `listPending`, `resolvePending`
  - `savePushSubscription`, `deletePushSubscription`
  - `setDefaultHousehold`
- The mock repo mirrors the SQL rules. For E2E, `/api/capture` in mock mode writes to the E2E mock store (only when E2E flags are set, same guards as the mock-store route).
- The push sender is behind an interface. Tests use a fake that records calls; nothing is ever sent.

## E2E (`tests/e2e/slice4.spec.ts`)

- A token created on `/settings/shortcut` is shown once. After a reload it is hidden, and «Создать новый» rotates it.
- `POST /api/capture` with that token and amount `"6 000,00 ₸"`, merchant «Magnum»:
  - Returns 201.
  - The payer's Главная shows «Ждут решения: Magnum 6 000 ₸».
  - Another member does NOT see it.
  - The fake push sender recorded one notification with the actions.
- Resolve as «Общее» with the chip «Продукты»:
  - The sheet collapses to «Поделено».
  - The purchase appears in Последние покупки as «Продукты · Magnum».
  - The other member now owes their share.
- Resolve another one as «Моё»: it stays invisible to others.
- Error paths:
  - a bad token → 401
  - a bad amount → 400
  - the 31st request in an hour → 429 (use a smaller limit via a test-only env override, or call the RPC directly in PGlite)
- `/pending/<id>?choice=shared` pre-selects «Общее».
- Screenshots go to `gan-harness/screenshots/s4-*`, compared with `ApplePay.dc.html` and motion #2.

## Out of scope

Real device push (needs HTTPS deploy; the orchestrator will deploy), reminders (slice 5), inline notification text reply (unreliable on iOS), and offline caching (slice 8).

## Definition of done

- `npm run verify` and `npm run test:e2e` are green 3 times in a row, with all earlier tests green.
- No raw hex outside tokens. Exceptions: the manifest JSON and the generated icons.
- Only transform/opacity animation.
- Russian copy via `ru.ts`.
- The token is never logged.
- Nothing is committed.
- `README` section «Apple Pay → Общак: как настроить» in Russian.
