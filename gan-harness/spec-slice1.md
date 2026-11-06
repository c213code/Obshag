# GAN spec: Slice 1 "First end-to-end path" for Общак

Read first:
- `docs/SDD.md` §5–§9 (design, flows, netting/split rules, data, API).
- `docs/PLAN.md` "Slice 1".
- `gan-harness/generator-state.md`, which describes what slice 0 built. Reuse that UI kit; don't re-invent components.

**Visual source of truth.** Match these 1:1 and compare screenshots side by side:
- `docs/design/Main.dc.html` for Главная.
- `docs/design/AddPurchase.dc.html` for Новая покупка.
- `docs/design/Tokens.dc.html` for tokens and capsules.
- `docs/design/motion-reference.html` for the card stack and Fab menu.

The screens with no mockup (login, onboarding, create/join household) must use the same language: dark background, capsule `Bar` headers, lime primary pill or Fab, big rounded amounts, short Russian copy. The user rejects anything that drifts from the design.

## Goal

A user can do this whole path in mock mode, and the code also works against real Supabase once credentials exist:

1. **Sign in by email code.**
   - `/login`: an email input, then "Получить код".
   - `/login/verify`: a 6-digit code input with large rounded digits.
   - In mock mode the code is always `000000` and no email is sent.
2. **Onboarding** (`/onboarding`): name and Kaspi phone (+7 format), with an avatar color chosen automatically.
3. **Household:** create one ("Квартира 42"; the invite code is generated server-side) or join one by code (`/join` with a code input, and `/join/[code]` as a deep link).
4. **Главная (`/`), exactly per `Main.dc.html`:**
   - greeting "Привет, <имя>"
   - the CardStack of the user's households, showing the balance from `balance.ts`
   - quick actions: Покупка → `/purchases/new`. Напомнить, Расчёт and Ежемесячно can be visible but disabled, marked "скоро"; real flows come in later slices.
   - the Долги summary card with the orange/lime bar, "ты должен X / тебе должны Y" and a "Рассчитаться" button (disabled until slice 3)
   - "Последние покупки" with the progress "N из M скинули"
   - the floating TabBar and the Fab with its menu ("Покупка" works)
5. **Новая покупка (`/purchases/new`), exactly per `AddPurchase.dc.html`:**
   - a big amount input with a numeric keypad (`inputmode=numeric`, ≥16px)
   - a "what" input
   - "Кто платил": in slice 1 only "Я" is enabled. Others are disabled, because RLS requires payer = me.
   - "Как делить": "Поровну" only. "Свои суммы" is disabled until slice 2.
   - "На кого": person pills, all active members selected by default
   - the bottom bar "по X ₸ · на N человек" plus a lime ✓ Fab
   - On submit: an optimistic insert with rollback, then return to Главная with the new purchase at the top.
6. **Sign out**, from the Квартира tab placeholder page or a profile button.

## Domain (TDD, pure, `src/lib/domain/`)

**`split.ts` → `splitEqual(amount, participantIds, payerId)`**, exactly per SDD §7:
- `base = floor(amount / N)`.
- The remainder is added 1 ₸ at a time to the non-payers, in the given member order.
- The payer's own share is returned flagged as settled (or omitted, but stay consistent with the DB).
- Validate: amount is a positive integer, N ≥ 1, the payer is among the participants (or document the behavior when not).
- Property tests: the shares always sum to the amount; no share differs from another by more than 1; it is deterministic.

**`balance.ts`:**
- `balanceFor(userId, shares, purchases)` returns `{ owe, owed, net }`, counting open shares only.
- Pairwise netting comes in slice 3, but write `netPair` now if it is trivial.

**`schemas.ts`:** zod schemas for every action input, shared by the mock repo, the server actions and the RPC param mapping. Phone format is `+7XXXXXXXXXX`; amount is 1..10_000_000.

## Data and backend

**Migration `supabase/migrations/0002_slice1_rpcs.sql`.** Every function uses `security definer` and `set search_path = ''`, and derives the actor from `auth.uid()`.
- **`create_household(name)`:** already exists. Keep it, and make sure the creator becomes admin.
- **`join_household(code)`:**
  - looks up the code; raises a generic error on any failure, so it never reveals whether a code exists
  - inserts the membership (or reactivates an inactive one)
  - is rate-limited: max 10 attempts per user per hour, tracked in a small `private.join_attempts` table
- **`create_purchase_with_shares(household_id, amount, description, merchant, participant_ids)`:**
  - payer is `auth.uid()`
  - checks membership, and that every participant is an active member
  - recomputes the split in SQL with the same rule as `splitEqual`
  - inserts the purchase (status `shared`, source `manual`) and the shares in one transaction, with the payer's share settled immediately
  - returns the purchase id
- **Profile row:** an `auth.users` insert trigger creates the profile row, or an `upsert_profile(name, phone)` RPC handles it.

**Tests in PGlite (`tests/db/slice1.test.ts`):**
- create → join with a good and a bad code
- rate limit
- a non-member cannot join without a code
- the split math matches `splitEqual` for several amounts, including remainders
- shares sum to the amount
- the payer's share is settled
- a non-member cannot call `create_purchase` for a household
- a participant who is not a member is rejected

**Repos (`src/lib/data/`):** extend the `Repo` interface. `mockRepo` implements everything in-memory: seed household plus OTP `000000`, and persists to `localStorage` so a reload keeps the state. `supabaseRepo` implements it with `@supabase/ssr`:
- a browser client, a server client and `src/middleware.ts` (or `proxy.ts` on Next 16) for session refresh
- RPC calls for writes and selects for reads
- Use Server Actions where they fit the App Router. Writes go through RPCs either way.

**Auth guard:**
- Unauthenticated users go to `/login`.
- Users without a profile go to `/onboarding`.
- Users without a household go to `/household`, which has two big capsule choices: «Создать квартиру» / «У меня есть код».
- In mock mode, use a mock session (cookie or localStorage) so the guard logic is exercised the same way.

**Realtime:** not required in slice 1. The Главная list refreshes after your own writes.

## E2E (Playwright, WebKit iPhone 15, mock mode, `build && start`)

`tests/e2e/slice1.spec.ts`:
1. A fresh visit to `/` redirects to `/login`.
2. Email, code `000000`, then onboarding (name "Ерасыл", phone +77001234567).
3. Create a household. Главная shows "Квартира 42" or the entered name, and the invite code is visible somewhere (Квартира placeholder page).
4. Second user, simulated in mock mode with another browser context: joins with the code, then both are members.
5. User 1 adds a purchase of 6 000 "Хлеб, картошка" split among all 4 seeded members (or among the 2 real ones; then assert by computation). The purchase screen shows "по X ₸".
6. Главная for user 1 shows "тебе должны …" with the correct amount. User 2 sees "ты должен …" with the correct amount (in mock mode the shared state must be visible across contexts, using a test-only shared mock store, e.g. a file- or server-backed mock API route enabled only when `NEXT_PUBLIC_E2E=1`).
7. Optimistic add: the new purchase row appears instantly.
8. Visual: screenshots of Главная and Новая покупка saved for comparison with the `docs/design` references.

## Non-goals in slice 1

Netting screen and payments (slice 3), custom split and delete (slice 2), Apple Pay and push (slice 4), reminders, bills, and Квартира details beyond a placeholder with the invite code and sign-out.

## Definition of done

- `npm run verify` is green (coverage ≥ 80% on `src/lib/**`), and the PGlite DB tests and `npm run test:e2e` are green.
- Главная and Новая покупка visually match the references: compare screenshots in `gan-harness/screenshots/s1-*`.
- No raw hex outside tokens. Only transform/opacity animations. Russian copy via `ru.ts`.
- No secrets committed. `.env.example` lists the Supabase vars.
