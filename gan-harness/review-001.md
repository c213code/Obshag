# Slice 0: review findings to fix in iteration 2

Sources: the user's feedback, gan-harness/feedback/feedback-001.md (evaluator, 7.8), the code reviewer (TypeScript), and the security reviewer. All of these must be fixed before Gate 2 unless marked "slice 1+".

## A. USER: design fidelity (top priority)

The user said the build doesn't match the approved design. The references are now in the repo, and they are the source of truth:
- `docs/design/motion-reference.html`: the approved motion demos. Open it in a browser and replicate 1:1.
- `docs/design/*.dc.html`: the approved canvas screens. `Main.dc.html` shows the TabBar and Fab; `Tokens.dc.html` shows the tokens and capsules.
- `docs/design/ref-fab-menu.png`: the user's screenshot of the expected Fab menu.

**A1. Fab menu, exactly as in the reference:**
- Container: card background, 1px card-2 border, radius 28, padding 8, width about 220, vertical gap 6.
- Item 1, "Покупка": a highlighted card-2 pill row with a lime cart icon (18px) followed by the label.
- Item 2, "Ежемесячный платёж": a transparent pill row with a lime calendar icon.
- A full-width lime pill button "Закрыть" (on-lime text, weight 600) that closes the menu.
- Motion: on open, the Fab scales to .6 and fades to 0 while the menu scales .24 → 1 from its bottom-right corner (soft spring). Close reverses this. No rotation.
- Fix the menu's keyboard and tap-lock issues at the same time: focus the first item on open, handle ArrowUp/ArrowDown, close on Esc, and return focus to the Fab.

**A2. Island sheet:** the Sheet must match reference #2 (grows from a small black pill into a wide card, content fades in late, collapses to a pill with ✓ "Поделено"). Do not distort the corner radius; use the approach in the reference note.

**A3. Netting, Получил and CardStack:** make sure they match references #3, #4 and #5 where they already exist in the kit. Add a netting demo and a Получил demo to `/kit` that replicate the reference.

**A4. Kit gallery:**
- All labels in Russian through `ru.ts`. No English: no SEGMENTED, CARDSTACK, SKELETON, or "Ghost/On/Lime".
- Skeletons shaped like a card, a row and an amount.
- A bottom gradient or scrim behind the fixed TabBar so content doesn't collide with it, plus a bottom spacer.

## B. SECURITY: CRITICAL/HIGH, must fix in `supabase/migrations/0001_baseline.sql` and its tests

**C1/C2. members.** Drop the client update and insert policies:
- `revoke insert, update, delete on members from authenticated, anon`
- `grant update (away_until) on members to authenticated`, with a self-only policy.

Create, join, role changes and leaving go through security-definer RPCs in slice 1. A stub signature is fine now, or leave them to slice 1 but keep writes denied.

**C3. households.**
- Remove the creator self-insert branch.
- `households_select` uses `is_member(id)` only.
- `revoke update on households`, then `grant update (name)` to admins via a policy.
- The creator becomes admin through a `create_household` RPC (slice 1) or an AFTER INSERT trigger that runs in the same transaction.

**C4. Ledger.**
- `shares` and `settlements` are read-only for clients: revoke insert, update and delete, and keep only select. Writes go through RPCs (slices 1 and 3).
- `purchases`:
  - insert with check `is_member(household_id) and payer_id = (select auth.uid())`
  - update and delete only by the payer
  - `grant update (description, merchant, status)` only
  - add a regression test for the "personal takeover"
- Composite foreign keys so payer, debtor and from/to must be members of that household: `members(household_id, user_id)`. `shares` gets a `household_id` column. Use an `active` flag on members for soft leave.

**H1.** `reminder_log` has no client writes; it is server/service-role only.

**H2.** Lock down anon explicitly:
- `revoke all on all tables/sequences/functions in schema public from anon`
- `alter default privileges ... revoke ... from anon`

**H3.** `push_subscriptions.endpoint check (endpoint ~ '^https://')`.

**M1.** Move the helpers to a `private` schema that is not exposed, with `set search_path = ''`.

**M2.** `invite_code check (char_length(invite_code) >= 10)`. It is generated server-side in slice 1.

**M3.** `capture_tokens`: revoke select on `token_hash` from authenticated. It is generated server-side in slice 4.

**L1.** A last-admin guard trigger, or leave a note for slice 1.

**L3.** On-delete rules for the profile foreign keys. Pick one policy and document it.

**Tests, in `tests/db/migration.test.ts`:**
- Negative write tests for C1–C4, H1 and anon.
- Positive controls: own purchase insert, `away_until` update.
- Assert specific errors: `/row-level security/i` or code 42501 for RLS, 23514 for check constraints.
- Compare against an explicit expected table list.
- Stop granting `all` to authenticated in the test. Use the migration's own grants.

## C. CODE REVIEW: HIGH, must fix

**H1. env.**
- Split into `src/lib/env/public.ts` (NEXT_PUBLIC_* only) and `src/lib/env/server.ts` (secrets, `import "server-only"`).
- `getRepo` reads only the public mode.
- Mock mode throws in production (`NODE_ENV === 'production'`), unless an explicit `E2E` flag is set.

**H2. Mock repo is a module singleton.** Decide and document: mock mode is client-only through a React context provider that creates the repo in a `useState` initializer.

## D. CODE REVIEW: MEDIUM, fix now

- **CardStack:**
  - Render the card as a button only when there are 2 or more cards, and don't let the aria-label hide the balance (use `aria-describedby`).
  - Derive the order from `cards` plus a rotation offset.
  - Use one shared `CARD_HEIGHT` constant.
- **Sheet:** focus trap, restore focus on close, body scroll lock, keep `onClose` in a ref, close on Esc and on backdrop tap.
- **TabBar:** link tabs derive the active tab from `usePathname()` and never lock navigation.
- **Segmented:** proper group labels ("Способ деления", "Кто платил").
- **mockRepo:**
  - Validate inputs with a shared zod schema (shares sum to the amount, debtors are members, amounts are positive integers, description is not empty).
  - Return copies of objects, never internal references.
- **e2e:**
  - Remove `networkidle`.
  - Assert that the pill element actually moves (its boundingBox x changes).
  - Select a Fab menu item.
  - Double-tapping the CardStack advances it only once.
  - Use playwright `webServer.env` instead of a shell env prefix.
  - Run against `build && start` (port 3100, `reuseExistingServer: false`).
  - Add tests for: the reduced-motion fade, the Sheet closing on Esc and backdrop, and the Fab menu matching the reference (it has "Закрыть", icons, and the first item is highlighted).
- **LOW items worth doing quickly:**
  - Drop `"use client"` from `motion/index.ts` (the values only) if feasible.
  - Avatar: use `Array.from(name.trim())[0]`.
  - The avatar inside ListRow is `aria-hidden`.
  - `/kit` returns `notFound()` in production unless mock or E2E mode is on.
  - Vitest include `src/**/*.test.{ts,tsx}`.
  - Rename the misnamed test.
- **Security headers** in `next.config.ts` (security review M6): CSP suitable for Next.js (allow self plus inline styles needed by motion; no external origins yet), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `frame-ancestors 'none'` / `X-Frame-Options: DENY`, and HSTS.

## Out of scope (slice 1+)

The real RPC bodies for create/join household and the split and settlement logic. Only the lockdown and stubs come now.
