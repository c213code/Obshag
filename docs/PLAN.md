# Общак: MVP slice plan

Source: docs/SDD.md. Written by the planner subagent (Sonnet). Gate 1 means the user must approve this plan before implementation starts.

## Global conventions

- **Pure domain logic** lives in `src/lib/domain/*` (split, netting, parseAmount, reminders, bills) and is built test-first with Vitest.
- **Data access** goes through `src/lib/data/repo.ts`, which has two implementations: `mockRepo` and `supabaseRepo`. This lets UI work go ahead before credentials exist.
- **Migrations:** every migration ships with RLS and RLS tests.
- **Motion:** animate only transform and opacity, ignore taps while an animation runs, and fall back to a fade under reduced motion.
- **Copy:** all Russian UI strings live in `src/lib/i18n/ru.ts`.
- **Time:** use one Almaty timezone helper, `src/lib/time.ts`.

## Slice 0: Scaffold

**Contents:**
- Next.js, TypeScript, Tailwind v4 with an `@theme` token file (no raw hex values outside it), and `src/lib/motion` (curves, springs, reduced-motion).
- UI kit:
  - Bar, Pill, Fab, Header, Segmented, ListRow, Avatar, Card, Skeleton
  - Money (rolling number), Sheet, BottomActions
  - TabBar with the sliding pill
- A `/kit` dev gallery for the UI kit.
- Mock repo with seed data, and zod-validated env.
- `supabase/migrations/0001_baseline.sql` with all SDD §8 tables and RLS:
  - an `is_member()` helper
  - a policy that hides personal purchases from everyone but the payer
  - owner-only access to the token, push and reminder tables
- Tooling: Vitest with an 80% domain coverage threshold, Playwright (iPhone WebKit, mock-mode webServer), and an `npm run verify` script.

**Acceptance:**
- `/kit` renders every variant and the tab pill slides.
- `verify` is green.
- The migration applies.

**Tests first:** `money.test.ts` (unit) and a kit smoke spec (E2E).

**Skills:** vercel:nextjs, ecc:design-system, frontend-design:frontend-design, ecc:motion-foundations, ecc:make-interfaces-feel-better, ecc:database-migrations, ecc:postgres-patterns, ecc:tdd-workflow, ecc:e2e-testing, vercel:env-vars.

**Security review:** yes (RLS baseline, secrets).

## Slice 1: First end-to-end path

**Goal:** OTP sign-in → onboarding (name and Kaspi phone) → create or join a household → add a manual purchase split equally → see it on Главная with the debts summary.

**Files:**
- `domain/split.ts`: `splitEqual` using the SDD §7 remainder rule, with the payer's own share pre-settled.
- `domain/balance.ts`.
- Supabase client, server and middleware.
- Pages: `(auth)/login`, `onboarding`, Главная (card stack and debts card), `purchases/new` (equal split).
- App layout with the TabBar and the morphing "+" fab.

**Server actions:** updateProfile, createHousehold, joinHousehold, createPurchase.

**Migration 0002:** RPC `create_purchase_with_shares`, which recomputes the split on the server.

**Also:** optimistic add with rollback, and skeletons.

**Acceptance:**
- An unauthenticated visit to `/` redirects to `/login`.
- 6 000 split among 4 shows "по 1 500 ₸".
- The payer sees "тебе должны 4 500" and another member sees "ты должен 1 500".
- A non-member cannot read the household's purchases (RLS).

**Tests first:**
- split property tests
- balance and schemas
- a repo contract test that runs against both mockRepo and supabaseRepo
- an onboarding → home E2E

**Skills:** vercel:nextjs, ecc:react-patterns, vercel:react-best-practices, ecc:api-design, ecc:backend-patterns, ecc:postgres-patterns, ecc:database-migrations, ecc:motion-patterns, frontend-design:frontend-design, ecc:make-interfaces-feel-better, ecc:tdd-workflow, ecc:e2e-testing, ecc:security-review.

**Security review:** yes. Depends on slice 0.

## Slice 2: Purchase detail, custom split, delete

**Covers:** screen 3, the Покупки tab, the "Свои суммы" split mode, and leaving away members out of a split by default.

**Contents:**
- Domain: `splitCustom` and `defaultParticipants`.
- `deletePurchase`: allowed for the payer or an admin, and blocked once any share belongs to a confirmed settlement.
- A Realtime feed hook.
- Migration 0003.

**Tests:** units for the domain functions, plus detail-delete and custom-split E2E specs.

**Skills:** ecc:react-patterns, ecc:motion-patterns, ecc:make-interfaces-feel-better, ecc:postgres-patterns, ecc:tdd-workflow, ecc:e2e-testing.

**Security review:** yes. Depends on slice 1. Can run in parallel with slices 6 and 7.

## Slice 3: Netting and settlement (screen 4)

**Domain:** `netting.ts` with `netPair`, `netForUser` and covered-share selection. Test cases:
- 2000 vs 1800 gives 200
- zero net
- reverse direction
- shares created after a settlement are not covered by it

**UI:**
- `settle/[userId]` with the equation pill.
- A Kaspi button that copies the number and opens `https://kaspi.kz/transfers`.
- The netting animation and the "Получил" animation.
- The Главная balance switches to `netForUser`.

**Actions:** markPaid, confirmSettlement, cancelSettlement.

**Migration 0004:** a security-definer RPC `confirm_settlement` (creditor only, row locks, idempotent), plus RLS.

**Acceptance:**
- A confirm from anyone but the creditor is rejected.
- A double confirm does nothing.
- After confirmation, the pair's balances are 0.

**Skills:** ecc:motion-patterns, ecc:motion-advanced, ecc:motion-foundations, ecc:make-interfaces-feel-better, ecc:postgres-patterns, ecc:database-migrations, ecc:backend-patterns, ecc:tdd-workflow, ecc:e2e-testing, ecc:security-review.

**Security review:** yes. Depends on slice 1.

## Slice 4: Apple Pay capture and push

**Domain:**
- `parseAmount`, table-driven: "6 000,00 ₸" parses, NBSP is handled, garbage is rejected.
- `rateLimit`: 30 per hour.
- Token generation, stored as a SHA-256 hash.

**Routes:** `api/capture`, and `api/push/subscribe` (POST and DELETE).

**Push and sheet:**
- `push/send.ts` using web-push; dead subscriptions are pruned.
- `public/sw.js` with `notificationclick` actions.
- The pending-purchase sheet with the island motion, and a "Ждут решения" section.
- A Shortcut setup page that shows the token only once.

**Actions:** resolvePending, rotateCaptureToken. **Migration:** 0005.

**Acceptance:**
- An invalid token returns 401.
- The 31st call within an hour returns 429.
- A bad body returns 400.
- Only the token hash is stored.
- A purchase marked "Моё" is invisible to others.
- The full happy-path E2E passes: capture → share → mark paid → confirm.

**Skills:** vercel:vercel-functions, ecc:api-design, ecc:backend-patterns, ecc:security-review, ecc:motion-advanced, ecc:motion-patterns, ecc:tdd-workflow, ecc:e2e-testing, vercel:env-vars, ecc:postgres-patterns.

**Security review:** yes. Depends on slices 1 and 3. Needs VAPID keys and a real iPhone.

## Slice 5: Reminders

**Contents:**
- `reminders.ts`: debts older than 24h, a 6h cooldown per pair, and the reminder text.
- `api/cron/daily`, protected by `CRON_SECRET`.
- `vercel.json` with schedule `0 14 * * *`, which is 19:00 Almaty (UTC+5).
- The remind action and the Напомнить button states.
- Migration 0006: a `members.reminders_enabled` column.

**Acceptance:**
- A request without the secret returns 401.
- A member with reminders turned off is skipped.
- A second remind to the same person within 6h is rejected.

**Skills:** vercel:vercel-functions, ecc:backend-patterns, ecc:api-design, ecc:security-review, vercel:env-vars, ecc:tdd-workflow.

**Security review:** yes. Depends on slices 3 and 4.

## Slice 6: Monthly bills (screen 6)

**Contents:**
- `bills.ts`:
  - `dueBills`, made idempotent through `last_generated_month`
  - the "нужна сумма" state for bills without an amount
  - day 28 in February
  - the Almaty timezone edge case
- The monthly page and the bill form.
- upsertBill (admin only) and setBillAmount.
- A `jobs/bills` module called by the daily cron.
- Migration 0007.

**Acceptance:** running the cron twice in the same month creates exactly one purchase per bill.

**Skills:** ecc:backend-patterns, ecc:postgres-patterns, ecc:react-patterns, ecc:make-interfaces-feel-better, ecc:tdd-workflow, ecc:e2e-testing, ecc:security-review.

**Security review:** yes. Depends on slice 1, and on slice 5 for the cron route. Its UI can be built in parallel.

## Slice 7: Квартира (screen 7)

**Contents:**
- Invite code card with Web Share and a QR code.
- A `join/[code]` deep link.
- Member rows: a missing Kaspi number is shown in orange, plus the away-until date.
- The reminders toggle.
- The card-stack animation for several households.

**Actions:** setAway, removeMember (admin only, blocked until the member's nets are zero), leaveHousehold. **Migration:** 0008.

**Skills:** ecc:react-patterns, ecc:motion-patterns, ecc:make-interfaces-feel-better, ecc:postgres-patterns, ecc:security-review, ecc:e2e-testing.

**Security review:** yes. Depends on slice 1. Can run in parallel with slices 2, 3 and 6.

## Slice 8: Polish, PWA, offline, deploy

**Contents:**
- Manifest, icons and Apple meta tags.
- Badging API.
- Service Worker caching:
  - precache the app shell
  - stale-while-revalidate for other requests
  - never cache auth or user data
  - an offline banner
- Route prefetch.
- No-lag CSS:
  - remove the tap delay and tap highlight
  - disable overscroll
  - inputs at 16px or larger
- An "add to Home Screen" prompt, plus empty and error states.
- Vercel deploy.
- `docs/DEVICE_CHECKLIST.md`.

**Acceptance:**
- The offline shell loads.
- Reduced motion shows fades.
- A grep check finds no animated width, height, shadow or filter.
- All E2E specs pass on the Vercel preview.

**Skills:** ecc:react-performance, vercel:react-best-practices, ecc:motion-foundations, ecc:make-interfaces-feel-better, ecc:motion-advanced, vercel:deployments-cicd, vercel:env-vars, vercel:vercel-functions, vercel:verification, ecc:verification-loop, ecc:e2e-testing, ecc:security-review.

**Security review:** yes. Depends on all earlier slices.

## Order

1. Slice 0, then slice 1.
2. The main spine: slice 3 → slice 4 → slice 5. After slice 4 the core promise works end to end.
3. In parallel after slice 1: slice 2, the UI of slice 6, and slice 7.
4. Slice 8 last, with an early deploy dry-run after slice 4.

## Credentials timeline

| When | What | Who provides it |
|---|---|---|
| End of slice 1 | Supabase project URL, anon key and service-role key. SMTP for OTP email (the free built-in sender is heavily rate limited). | User |
| Slice 4 | VAPID keys | We generate them |
| Slice 4 | A real iPhone for testing | User |
| Slice 5 | CRON_SECRET | We generate it |
| Slice 8 | Vercel login | User |

## Risks and proposed defaults

**Risks:**
- **iOS Shortcut transaction fields.** We don't know their exact format until a real payment, so the parser stays lenient.
- **iOS web push.** It needs a home-screen install, and notification action buttons and inline reply are unreliable. Tapping the notification to open the sheet is the primary path; slice 4 includes a spike to check the rest.
- **Badging API on iOS** is best-effort.
- **Vercel Hobby cron** runs once a day, in UTC, and its timing within the hour is imprecise.
- **Supabase free tier:** OTP email is rate limited, and the project pauses after a week without activity.
- **Capture token** travels in the request body, so it must never be logged.

**Proposed defaults:**
- Deleting a purchase is blocked once a confirmed settlement covers any of its shares.
- Removing a member is blocked until their nets are zero.
- `parseAmount` rounds half up.
- No offline write queue in the MVP.
- If a user has several households, captures go to a default household set on the profile, changeable in the sheet.

## Definition of done

- Every slice's acceptance criteria pass.
- Domain test coverage is at least 80%.
- The SDD §11 happy-path E2E is green.
- RLS is enabled on every table.
- security-reviewer has signed off every slice.
- The app is deployed on free tiers.
- The device checklist is signed off on a real iPhone.
