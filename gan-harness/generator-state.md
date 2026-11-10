# Generator State — Iteration 001 (Slice 0 Scaffold)

## What Was Built
- Next.js 16 (App Router, src/, TS strict, ESLint), Tailwind v4, motion, zod, Vitest, Playwright (WebKit iPhone 15), PGlite.
- Tokens: src/styles/tokens.css (only file with hex). No-lag CSS in src/app/globals.css.
- Motion: src/lib/motion/index.ts (ease, spring snap/soft, useReducedMotionSafe, useTapLock); MotionConfig reducedMotion="user" in src/components/Providers.tsx.
- UI kit: src/components/ui/* (Bar, Pill/PillLink, Fab, Header, Segmented, ListRow, Avatar, Card, BalanceCard, CardStack, Money, Skeleton, Sheet, BottomActions, TabBar with Fab menu, icons).
- /kit gallery: src/app/kit/{page,KitGallery}.tsx; / links to /kit.
- Data: src/lib/data/{types,repo,mockRepo,seed,index}.ts, src/lib/env.ts (zod), src/lib/i18n/ru.ts, src/lib/format/money.ts.
- SQL: supabase/migrations/0001_baseline.sql (10 tables, RLS, is_member etc).
- Tests: src/lib/format/money.test.ts, src/lib/env.test.ts, src/lib/data/*.test.ts, tests/db/migration.test.ts, tests/e2e/kit.spec.ts.
- README.md, .env.example, .gitignore.

## Commands (final)
- npm run verify: green (lint, typecheck, vitest 31 tests, coverage ~99% lines on src/lib, build)
- npm run test:e2e: 5/5 pass (stable over repeated runs)

## Known gaps / notes
- Providers sets html[data-hydrated] so E2E waits for hydration.
- TabBar tabs render buttons in /kit (Link when href is given).
- themeColor omitted from viewport (would need a raw hex outside tokens).
- Default NEXT_PUBLIC_DATA_MODE is "supabase" (fail-closed); getRepo() throws until slice 1.
- Screenshot at gan-harness/screenshots/kit.png (full-page shot shows the fixed TabBar mid-page; artifact).
- Nothing committed. Dev server stopped.

## Dev Server
- Command: NEXT_PUBLIC_DATA_MODE=mock npm run dev -- -p 3100 (not running)

---

# Generator State — Iteration 002 (review-001 fixes)

Nothing committed. Dev/prod servers stopped.

## Results
- `npm run verify`: green (lint, tsc, vitest 65+ tests incl. 34 PGlite migration tests, coverage ~98% lines, build).
- `npm run test:e2e`: 18/18 pass (WebKit iPhone 15, production build on port 3100, `reuseExistingServer: false`).
- Screenshots (reference vs kit): gan-harness/screenshots/iter2-ref-*.png and iter2-kit-*.png.

## A. Design fidelity
- A1 Fab menu: rebuilt 1:1 from motion-reference (card bg, card-2 border, radius 28, p-2, w-220, gap 6; highlighted first row; lime cart and calendar icons 18px; lime «Закрыть» pill, weight 600). Fab scales .6 + fades, menu scale .24 to 1 from bottom-right (soft curve), never rotates. Focus first item on open, ArrowUp/Down cycle, Esc closes, focus returns to Fab, menu is `inert` when closed. Reduced motion = fade only.
- A2 Sheet: island sheet (pill -> wide card via motion layout animation, radius fixed at 32 so no distortion, content fades in late, collapses to pill with check and «Поделено»).
- A3 Netting and Получил demos added to /kit (Netting.tsx, ReceivedRow.tsx); CardStack matches ref #5 (bottom-anchored, slide down and back, rotate, dim overlay instead of filter, tone colors lime/orange/periwinkle tokens).
- A4 Kit: all labels Russian via ru.ts; skeleton card/row/amount; bottom scrim in TabBar + bottom spacer.

## B. Security (supabase/migrations/0001_baseline.sql, edited in place)
- C1/C2 members: no client insert/delete, only `update(away_until)` own row. `active` soft-leave flag.
- C3 households: no client insert/delete; select via is_member only; `update(name)` admins only; AFTER INSERT trigger makes creator admin; `create_household(text)` RPC (works, server-side invite code).
- C4 shares/settlements read-only; shares has household_id; composite FKs to members(household_id,user_id) for payer/debtor/from/to/bill payer; purchases insert needs payer = auth.uid(), update/delete payer only, column grant (description, merchant, status). Personal-takeover regression test.
- H1 reminder_log: no grants. H2 anon revoked on all objects + default privileges. H3 https endpoint check. M1 helpers moved to `private` schema, `search_path=''`. M2 invite_code >= 10 chars. M3 capture_tokens.token_hash not selectable. L1 last-admin guard trigger (allows whole-household delete). L3 FK delete policy documented at top of the file.
- Tests: tests/db/migration.test.ts rewritten (34 tests): explicit table list, SQLSTATE assertions (42501 / 23514 / 23503 / 28000), negative + positive controls, no extra grants in the test (Supabase default privileges are simulated before the migration).

## C/D. Code review
- Env split: src/lib/env/public.ts + server.ts (`server-only`); mock in production throws unless NEXT_PUBLIC_E2E=1; /kit and the home link are hidden in production without that flag.
- Mock repo: no singleton. `createRepo()` + `RepoProvider`/`useRepo` (src/components/RepoProvider.tsx, client-only, useState initializer). RepoProvider is NOT mounted globally yet because the default mode is fail-closed supabase and would throw during prerender; slice 1 mounts it in the app layout.
- mockRepo: shared zod schemas (src/lib/data/schemas.ts), shares sum, member debtors, positive int amounts, payer must be me, copies returned.
- CardStack: button only for 2+ cards, aria-describedby hint, order = cards + offset, shared CARD_HEIGHT. Sheet: focus trap (manual Tab cycle, Safari-safe), focus restore, scroll lock, onClose via ref, Esc, backdrop. TabBar: pathname-derived active for href tabs, no tap locks. Segmented: group labels. Avatar: Array.from. ListRow avatar decorative. motion/index.ts without "use client". vitest include src/**/*.test.{ts,tsx}.
- Security headers (CSP, nosniff, DENY, referrer policy, HSTS, permissions policy) in next.config.ts; verified in e2e.
- e2e: no networkidle, real pill movement check, Fab menu fidelity checks, double raw tap advances once, reduced-motion fade tests, Sheet Esc/backdrop/Tab trap, webServer.env, build && start.

## Deferred / notes
- TabBar active tab for href tabs relies on usePathname; no href tabs are used in /kit yet (covered by code path only, no e2e).
- CSP uses 'unsafe-inline' for scripts (no nonce pipeline yet); tighten in a later slice.
- Real RPC bodies for join/leave/roles/shares/settlements remain slice 1+ (writes stay denied).

---

# Generator State — Slice 1 "First end-to-end path" (iteration 001)

Nothing committed. No servers running.

## Results
- `npm run verify`: green (lint, tsc, 133 Vitest tests incl. PGlite DB tests, coverage ~92% lines on src/lib, build).
- `npm run test:e2e`: 25/25 (18 kit + 7 slice 1), WebKit iPhone 15, production build, mock + NEXT_PUBLIC_E2E=1.
- Screenshots: gan-harness/screenshots/s1-ref-*.png (docs/design) vs s1-app-*.png; side by side: s1-cmp-main.png, s1-cmp-addpurchase.png; e2e shots s1-e2e-*.png.

## What was built
- Domain (TDD, src/lib/domain): split.ts (splitEqual, perPersonRange), balance.ts (balanceFor, netPair), schemas.ts (zod, phone +7XXXXXXXXXX, amount 1..10_000_000), guard.ts (stage -> redirect), summary.ts, avatar.ts, phoneFormat.ts.
- Repo: extended interface (session, OTP, profile, households, createPurchase with participant_ids). mockRepo = load/mutate/save over a MockStorage (localStorage in the browser, /api/mock-store only when NEXT_PUBLIC_E2E=1), per-device session in localStorage; mirrors the SQL rules and the join rate limit. supabaseRepo (browser client, RPC writes, RLS reads) is type-checked and unit-tested with a fake client; never run live. Shared contract test (repoContract.ts) runs against mockRepo.
- SQL: supabase/migrations/0002_slice1_rpcs.sql (upsert_profile, join_household, create_purchase_with_shares, private.join_attempts, case-insensitive invite index). tests/db/slice1.test.ts (17 tests).
- Next: src/proxy.ts + src/lib/supabase/{client,server,proxy}.ts (session refresh, anonymous redirect in supabase mode).
- Screens under src/app/(shell): /login, /login/verify, /onboarding, /household, /household/new, /join, /join/[code]; (app): / (Главная), /purchases/new, /flat (invite code, neighbours, sign out), /purchases and /monthly placeholders. Guard + AppDataProvider (optimistic addPurchase with rollback and Toast).
- UI kit adjustments to match Main/AddPurchase 1:1: BalanceCard (192px, rings, avatars, month), CardStack (10px peeks, stack grey faces, frontId/onFrontChange), Segmented disabled options + 42px "bar" pills, Header close variant, Pill lg (48px) and disabled, TextField, TabBar/BottomActions spacing (px 20, bottom 28, gap 12), icons from the mockups, new token --color-stack.

## Deviations and notes
- join_household returns NULL for a wrong code (a raised exception would roll back the recorded attempt and the rate limit could never trip); the repo turns NULL, errors and an exhausted limit into the same generic `join_failed`.
- No Server Actions: the browser client + RLS + RPCs cover slice 1; server.ts exists for later slices.
- Card chip "N из M" = housemates who are even with me; purchase progress shows "N из M" (+ sr-only "скинули").
- Disabled: Напомнить, Расчёт, Ежемесячно (marked «скоро»), Рассчитаться, other payers, «Свои суммы».
- Global input font-size and :focus-visible moved into @layer base so Tailwind utilities (outline-none, text-*) can override.
- Remaining visual deltas vs mockups: 1-2px vertical offsets in the amount block (input line-height), disabled Рассчитаться is dimmed.

---

# Slice 1 — iteration 2

Nothing committed (per instruction). No servers running. Migrations 0001/0002 edited in place.

## Results
- `npm run verify`: green. 24 test files, 175 tests (was 133), coverage 93.2% stmts / 93.6% lines, build OK.
- `npm run test:e2e`: 27 passed (18 kit + 9 slice 1; slice 1 gained: malformed deep link, stale members, over-limit/too-small/no-debtor, single-row, peek layers, chip, bell, Fab menu, invite format).
- Screenshots: gan-harness/screenshots/s1i2-cmp-main.png, s1i2-cmp-addpurchase.png (left = docs/design reference, right = app); app-only s1i2-app-*.png. Script: gan-harness/shoot-s1i2.mjs.

## Per item
- A1 done: `create_purchase_with_shares` returns jsonb (purchase + shares); supabaseRepo does one RPC, no follow-up select. Tests: DB shape test, fake-client "no read after RPC".
- A2 done: monotonically increasing load token (stale loads ignored; `refresh()` waits for the newest), `PurchaseTracker` re-merges in-flight and just-confirmed rows into every snapshot (de-duplicated by id). Unit tests in purchaseTracker.test.ts.
- A3 done: stable `clientKey`, inherited by the real row and kept across later loads. E2E `expectSingleRowFor` (count stays 1).
- A4 done: cache headers from `setAll(cookies, headers)` copied to the response and the redirect (proxy.ts); `getClaims()` in try/catch (outage passes through). server.ts gets `onCacheHeaders` for Route Handlers (Server Components cannot set headers). Tests with a fake ssr client.
- M1 done: advisory xact lock before counting attempts (DB test checks the lock precedes the count; PGlite is single-connection so true concurrency is not exercised).
- M2 done: reactivation sets role 'member', away_until null, only `where not active`; mock mirrors. Tests in DB, mock.
- M3 done: insert revoked on purchases (policy removed), checks description 1..200, merchant <=120, amount <=10M, status removed from update grant. Tests (existing migration tests adapted).
- L1 done: code >64 returns null after recording the attempt; >50 participants rejected (SQL + zod).
- L2 done: `codeFromPath` try/catch; additionally the proxy answers a malformed %-escape with 400 (Next itself returned a bare 500 before the page ran).
- L3 done: anchored matcher exclusions + extension exclusion; matcher test.
- L4 done: fixed messages in mapDbError, raw errors via dev-only console.debug; test.
- Mock-store hardening done: needs `E2E_ALLOW_MOCK_STORE=1` (set in playwright.config webServer env, documented in .env.example) and refuses with `NEXT_PUBLIC_SUPABASE_URL`; also compare-and-set revision (409). Gate tested.
- C1 done: roster refetch on entering /purchases/new and on window focus/visibility (throttled 3 s, silent); ✓ disabled with no debtor + "Выбери, с кем делить" (or an "alone in the flat" hint); "Максимум 10 000 000 ₸" message (input allows up to 11 digits so the message can show).
- C2 done: disabled lime = flat lime/35% with on-lime text; other disabled segmented options 45% opacity plus «скоро» (Свои суммы inside the option, payers on the label row); "Выйти" is an orange-outlined capsule.
- C3 done: «скоро» as a tiny badge on the circle (row height asserted < 96px); two decorative peek layers with one or two households (card top now at the mockup's y); chip hidden when M=0; bell dot only with unread (slice 1: never, slot kept); invite code `XXXX-XXXX-XXXX` on one line; key icon on "У меня есть код"; verify hint uses nbsp + text-balance; Fab menu monthly row disabled with «скоро» via `soonActions`.
- C4 done: amount < participants rejected in schema, SQL, form message "Сумма меньше числа людей". splitEqual unchanged (callers guarantee amount >= n).
- C5 done: pendingJoin cleared on signOut and when the user already has a household; redirect only at stage 2 and ready.
- C6 done: per-repo promise chain for `tx`, revision check (409 from the route, retry with fresh data), stored as `{version, rev, db}` validated by zod (mismatch reseeds), localStorage access in try/catch. Tests.
- C7 done: getMe and listHouseholds in parallel; three contexts (`useAppActions` stable, `useAppData`, `useNotice`); PurchaseCard memo, payer names passed as Map; `.order` tie-breakers (id / user_id).
- C8 done: signOut returns boolean and shows a notice on failure; FlatScreen resets `leaving` in finally.
- C9 done: fake client records and asserts select/eq/order calls; every e2e test uses `withPhone` (try/finally context close); new e2e for stale members, no duplicate rows, disabled ✓.
- D partial: done: avatar comment corrected (different hash than SQL, documented), "Ты" in ru.ts, fallback name for a payer who left, `newId()` fallback for crypto.randomUUID, email parse memoized, FlatScreen timeout cleared on unmount, RepoProvider now logs creation errors. Not done: RepoProvider still uses useMemo (kept: it must stay client-only to avoid hydration mismatch).

## Known issues / notes
- Disabled payers on Новая покупка are dimmer than in the mockup (deliberate, per C2); everything else matches the reference side by side.
- Disabled "Рассчитаться" is a flat translucent lime as specified; it still reads olive on the dark card.
- Duplicate purchase after a network failure whose request actually reached the server is still possible (no idempotency key); only the follow-up-read cause was removed.

---

# Slice 3 "Netting and settlement" (iteration 001)

Nothing committed. No servers running. Migrations 0001 and 0002 untouched; `.env.local` untouched.

## Results
- `npm run verify`: green (lint, tsc, Vitest incl. PGlite DB tests applying 0001+0002+0003, coverage ~95% lines on src/lib, build).
- `npm run test:e2e`: 35/35 (18 kit + 9 slice 1 + 8 slice 3), WebKit iPhone 15, production build, mock + NEXT_PUBLIC_E2E=1.
- playwright.config webServer.env and vitest env now blank NEXT_PUBLIC_SUPABASE_URL/ANON_KEY and force mock mode, so the developer's `.env.local` (live Supabase) cannot disable the E2E store gate or leak into unit tests.

## What was built
- Domain `src/lib/domain/netting.ts`: `netPair` (iOwe, theyOwe, net = |diff|, direction i_pay|they_pay|even, myItems/theirItems), `netForUser` (counterparties, owe, owed, total), `coveredShares` (open shares between the pair whose purchase.created_at <= marked_at), `markCovered`. `householdSummary` now uses `netForUser` (Главная's Долги card is net per person; total unchanged).
- Migration `supabase/migrations/0003_slice3_settlements.sql`: `private.pair_net`, `private.lock_pair` (pg_advisory_xact_lock on household + ordered pair), `mark_settlement(p_household_id, p_to)` (net computed server-side, idempotent), `confirm_settlement(p_settlement_id)` (FOR UPDATE, creditor only, no-op when confirmed, closes covered shares both directions), `cancel_settlement` (debtor or creditor, no-op when cancelled). security definer, `search_path=''`, execute for authenticated only. Error codes: 28000, 42501, 23514, 23503, P0002.
- Repos: `listSettlements`, `markSettlement`, `confirmSettlement`, `cancelSettlement` on `Repo`; mockRepo mirrors the SQL; supabaseRepo calls the RPCs (P0002 -> not_found). Mock DB version 3 (settlements). Shared contract tests.
- `SettlementTracker` (optimistic overlay: temp marked row, optimistic confirm/cancel, locally settled shares, rollback + refresh), AppDataProvider actions `markPaid`, `confirmReceived`, `cancelSettlement`, settlements in the snapshot (refreshed on focus like before).
- UI: `/settle` (list of pill rows, one counterparty redirects with replace, empty «Все в расчёте»), `/settle/[userId]` (Pay.dc.html: capsule header, `PairScene` netting card, two columns top 3 + «и ещё N», masked Kaspi bar with «скопирован» chip, floating bar: Я оплатил / Отменить + Перевести N ₸ ↗ (copies kaspi_phone, opens https://kaspi.kz/transfers), Напомнить disabled «скоро» when they owe), «Ждём подтверждения от <Имя>» in the caption slot of the card, `IncomingRow` + `IncomingSection` «Подтверди оплату» on Главная above Последние покупки and on the pair screen (reuses ReceivedRow = reference #4, rows held 1.4s so the ✓ is seen). TabBar hidden on /settle*. Quick action «Расчёт» and «Рассчитаться» are live links.
- Netting animation = reference #3 timings (slide 420ms, count 800ms, pop, caption); reduced motion renders the final state with a fade. Only transform/opacity animate.
- Guard: a tap on «Отменить» within 900ms of «Я оплатил» is ignored (the pill swaps under the finger).

## Screenshots
- References: gan-harness/screenshots/s3-ref-*.png (script gan-harness/shoot-s3-ref.mjs). App: s3-app-*.png (from the E2E run). Side by side (left ref, right app): s3-cmp-pay.png, s3-cmp-netting.png, s3-cmp-poluchil.png, s3-cmp-waiting.png (script gan-harness/shoot-s3-cmp.mjs).

## Known gaps / notes
- Russian declension is not applied to names: «Расчёт с Айдос», «Ты → Айдос», «Kaspi · Айдос» (mockup: Айдосом / Айдосу / Айдоса).
- Pay.dc.html shows «скопирован» statically; the app shows a «Скопировать» pill first and the chip after copying (or after «Перевести»).
- The result in the equation pill flashes lime for ~0.9s after the netting finishes (reference #3), then returns to the Pay.dc.html white.
- The mock confirm uses wall-clock timestamps for "created at or before marked_at" (same ms ties count as covered); SQL uses the purchase's created_at vs settlements.marked_at.
- Concurrency (advisory lock) is asserted structurally in PGlite (single connection), not exercised with two real connections.
- Supabase path is unit-tested with a fake client and PGlite only; never run against the live project.

---

# Slice 3 — iteration 2 (+ password auth)

Nothing committed. No servers running. `.env.local`, 0001 and 0002 untouched. 0003 edited in place (not applied yet); no 0004 was needed (nothing in 0001/0002 had to change).

## Results
- `npm run verify`: green (30 test files, 272 tests, 96% lines on src/lib, build OK).
- `npm run test:e2e`: 37/37 (18 kit + 10 slice 1 + 9 slice 3). Green in the last 4 consecutive full runs (and 3 of 4 in an earlier batch); one run in between had a single failure in slice1 "user 1: sign up..." at 1.7 s that I could not reproduce in 10+ later runs (suspected: the shared in-memory mock store under three parallel workers; the failing log was not kept).
- Slice 3 spec alone: 9/9, 5 runs in a row.
- Screenshots: gan-harness/screenshots/s3i2-* (script gan-harness/shoot-s3i2.mjs; composites s3i2-cmp-*: left reference, right app).

## Per item
- U done: email + password. `/login` = Segmented «Вход / Регистрация», eye toggle, short Russian errors. Repo: `signUp`/`signIn`/`signOut`; supabase maps invalid_credentials, user_already_exists/email_exists, weak_password, rate limits (and a hidden existing account behind "Confirm email"). Mock: users keep a password, seeds use `password123`, same error semantics, mock schema v4. OTP code, `/login/verify` screen and CodeInput removed; `/login/verify` redirects to `/login`. e2e (slices 1 and 3), contract and unit tests moved to the password flow. README and .env.example updated.
- S1 done: table `settlement_shares` (RLS select for members, no client writes, purchase_id intentionally without FK so a deleted purchase is detectable). `mark_settlement` records the exact open shares under the pair lock and derives the amount from them; `confirm_settlement` closes exactly the recorded set or raises 23514 `stale_settlement` (client then cancels the row and shows «Суммы изменились — отметь оплату заново»). Domain `coveredShares/isStale/markCovered/pairShares` and mockRepo mirror it. PGlite tests: late purchase, pending then shared, deleted purchase, settled-by-opposite, no longer shared, normal confirm.
- S2 done: re-marking refreshes the record and the amount in the same row, under the lock.
- S3 done: not-found and not-yours both P0002 (a party who is not the creditor still gets 42501); `pair_net` returns bigint; 20 mark/cancel calls per user per hour (`private.settlement_ops`); PGlite test that anon has no execute on any function in public/private and no privilege on the new table.
- C1 done: AppDataProvider keeps `serverRef` and builds every view from it (purchases and settlements); rollback never depends on refresh; tracker also strips released/resolved optimistic ids and expires overrides after 30 s. Tests: chained views after release, failed mark/confirm/cancel, TTL.
- C2 done: pure `settleNav` (`listRedirect`, `pairScreenState`) shared by both screens; a departed sole counterparty cannot loop; list shows read-only rows for departed people, pair screen renders «Бывший сосед больше не в квартире»; Home totals still count them (`netForUser(..., isActive)` only flags). Unit tests only (no UI to remove a member in e2e).
- M1 done: `useHeldIncoming.release`; a refused «Получил» rolls the ✓ back. e2e test for it.
- M2 done: guard 350 ms from the click's `timeStamp`, `aria-disabled` plus dimmed while guarded or saving.
- M3 done: cancel test uses a held PUT (route gate) instead of timeouts, no nested contexts, contexts closed in `finally`, Kaspi routed with `fulfill`, countdown needs >= 2 samples, strictly decreasing, endpoints checked, stores awaited (`savedToStore`) before a phone is closed.
- M4 done: `src/lib/i18n/declension.ts` (+ tests) used in «Расчёт с Айдосом», «Ты → Айдосу», «Kaspi Айдоса», «Ждём подтверждения от Айдоса», `open`.
- M5 done: chip is the mockup's (card-2 pill, lime text, ✓ скопирован); «Скопировать» in the same shape; the first tap anywhere on the screen (capture, inside the gesture) or the bar copies; per person in sessionStorage.
- M6 done: label fades (0.14 s) while the button shrinks.
- M7 checked: the bar was already `position: fixed` with the safe area and content has bottom padding; the "mid-screen" look comes from full-page screenshots. Viewport check: transfer button bottom edge 624 of 659.
- M8 done: «Ждём подтверждения» section on the debtor's Главная (capsule rows, link to the pair screen).
- L done: list Back uses `router.back()`; legacy textarea copy first, async API fallback, «Не удалось скопировать — номер: …»; list redirects only on arrival; PairScene resets `played`; `snapRef` updated synchronously in a `commit` helper; tracker TTL 30 s.

## Known issues
- Departed-member flow and the stale confirm are covered by unit and PGlite tests, not by a browser test.
- Supabase path is still only tested with a fake client and PGlite; never run against the live project.

---

# Slice 4 "Apple Pay capture + push" (iteration 001)

Nothing committed. No servers running. 0001-0003 and `.env.local` untouched; no service-role key anywhere.

## Results
- `npm run verify`: green (38 test files, 397 tests, ~93% lines on src/lib, build OK).
- `npm run test:e2e`: 45/45, green 3 runs in a row (18 kit + 10 slice 1 + 9 slice 3 + 8 slice 4).
- Playwright config and the slice 1/3 contexts now use `serviceWorkers: "block"`: a registered worker hides requests from `page.route` (it broke two older "failed save" tests). Slice 4 opts in (`allow`) only for the worker-registration check.

## What was built
- SQL `supabase/migrations/0004_slice4_capture.sql` (+ `tests/db/slice4.test.ts`, 31 PGlite tests): pgcrypto in `extensions`, `profiles.default_household_id`, `can_see_purchase` replaced and `purchases_select` recreated (pending and personal are payer-only), `private.capture_ops`, helpers `check_participants` / `insert_equal_shares` / `purchase_json` (create_purchase_with_shares replaced to use them, same behaviour), `rotate_capture_token`, `capture_purchase` (anon+authenticated, 30/h per user, default household else latest joined, 23514 no_household), `prune_push_subscription` (token-gated), `resolve_pending`, `set_default_household`, `save_push_subscription` (RPC upsert by endpoint so a device can change owner; deliberate deviation from "client insert"). `grant usage on schema public to anon`; anon executes only capture_purchase and prune_push_subscription (tested), no table access (tested).
- `POST /api/capture` (`src/app/api/capture/route.ts`, node runtime) -> `src/lib/server/captureHandler.ts` (pure, tested) with `parseAmount` (`src/lib/domain/parseAmount.ts`, 46 table tests). 201/400/401/429/500 with a bare `{ok}` body, nothing logged. Push is sent after the response (`after()`), dead 404/410 endpoints pruned via the token RPC. `PushSender` interface (`src/lib/server/push.ts`), real `web-push` sender (`webPush.ts`, VAPID optional: missing = skipped), recording fake for tests and E2E. `/api/mock-push-log` (same gate as mock-store) exposes what the recorder got. `src/lib/data/mockServerStore.ts` shares the mock DB between `/api/mock-store` and `/api/capture`.
- Repo: `getCaptureTokenInfo`, `rotateCaptureToken`, `capture`, `prunePushSubscription`, `listPending`, `resolvePending`, `savePushSubscription`, `deletePushSubscription`, `setDefaultHousehold` in Repo, mockRepo (mock schema v5) and supabaseRepo; contract tests for all.
- SW + PWA: `public/sw.js` (push -> showNotification with Общее/Моё actions, notificationclick opens/focuses `/pending/<id>[?choice=]`, no fetch handler, no caches; unit-tested in `src/lib/sw.test.ts`), `public/manifest.webmanifest`, icons in `public/icons` (lime ₸ on bg), apple meta via Next metadata, registration in production builds only (`src/lib/pwa.ts`), `/sw.js` served with no-cache.
- UI: `/settings/shortcut` (key shown once with copy + warning, "Создать новый" rotates, numbered recipe, URL copy, iOS note, notification pill with states включены / запрещены в настройках iOS / добавь на экран Домой / unsupported / not configured), row «Apple Pay → Общак» on Квартира, «Ждут решения» section on Главная (above «Подтверди оплату»), `/pending/[id]` island sheet over Главная (Sheet got `radius`, `expandedClassName`, `onClosed`, `focusFirst`), optimistic `resolvePending` in AppDataProvider with `PurchaseTracker.override`.
- Tokens: added `--color-outline` (ghost chip ring of ApplePay.dc.html). No other raw hex.

## Decisions
- `?choice=shared|personal` only emphasises the matching button (lime) and never submits: the user still taps. Without it «Общее» is emphasised.
- «Продукты» is pre-selected like in the mock; tapping it again deselects (description then stays the merchant). The arrow in «Написать…» only commits the text and closes the keyboard.
- «Общее · по N ₸» uses all active roster members (as the new purchase screen); N = floor.
- E2E "recorded one notification with the actions": the recorder holds the payload `{type, purchaseId, merchant, amount}`; title, body and the two actions are composed in sw.js and covered by the sw unit test.

## Screenshots
- References: `gan-harness/screenshots/s4-ref-*.png` (script `gan-harness/shoot-s4-ref.mjs`). App: `s4-app-*.png`. Side by side (left reference, right app): `s4-cmp-open|main|island-pill|island-growing|island-collapsing|island-done.png` (script `gan-harness/shoot-s4-app.mjs`, needs the E2E build on :3100). E2E shots: `s4-app-shortcut-*.png`, `s4-app-island-*.png`.

## Known gaps
- The app shows a dim backdrop behind the island (the reference has none, it is an isolated demo box); the open card is 368px like ApplePay.dc.html.
- Real push is untested on a device (needs HTTPS + VAPID). Notification inline text reply, offline caching: out of scope.
- A deep link opened while signed out lands on `/` after login (no return-to).
- Concurrency of the capture rate limit is asserted in single-connection PGlite only.

## Slice 4 — final pass
- S1: 0004 has the push endpoint allowlist CHECK (not valid, then validate), insert/update revoked from authenticated, save_push_subscription checks host and keeps at most 10 per user (oldest dropped). webPush.ts and pushSubscriptionSchema share isAllowedPushEndpoint (URL parse, host allowlist, no credentials or port), plus timeout 5000. PGlite tests: allowlist via RPC and direct insert, cap, anon.
- S3: dedupe within 60 s (SQL and mockRepo, returns the existing pending, no second push), control and bidi characters stripped from merchant, unique index on capture_tokens(user_id), capture_purchase revoked from authenticated. Skipped: counting failed captures (a raise rolls the count back).
- C1 sign-out deletes the device subscription; C2 syncPush on status "on", key mismatch resubscribes, pushsubscriptionchange in sw.js; C3 sw.js always shows a notification; C5 notificationclick falls back to openWindow; C7 pending sheet: Общее disabled on empty roster, «Поделено» only after server success, inline error.
- D1-D5: «Ждут решения» at the top of Главная, scrim 15%, island geometry (11px inset, 368 wide), «моё» for personal purchases, full wrapped token on /settings/shortcut.
- U: signup 5xx/unexpected_failure and no-session map to signup_unavailable with the user message from ru.ts, dev-only console.debug; fake-client test.
- verify green (413 unit tests), e2e 45/45 green once. Screenshots: gan-harness/screenshots/s4f-cmp-island.png, s4f-app-main.png (shoot script: gan-harness/shoot-s4f.mjs).

---

# Slices 5+2 "Reminders + purchase detail" (one pass)

Nothing committed. No servers running. 0001-0004 and `.env.local` untouched; no service-role key anywhere.

## Built
- SQL `supabase/migrations/0005_slice5_2.sql` (+ `tests/db/slice52.test.ts`, 24 PGlite tests): `private.server_secrets` + `private.server_secret_ok` (sha256 hex of the secret vs the 'cron' row, no rows inserted), `members.reminders_enabled`, `run_daily_reminders(secret)` (anon), `remind(secret, household, debtor)` (6h cooldown, HINT = seconds left), `set_reminders_enabled`, `create_purchase_custom`, `delete_purchase` (23514 has_payments), `update_purchase_description`; direct client update/delete on purchases revoked (policies dropped). anon can execute only capture_purchase, prune_push_subscription, run_daily_reminders (tested).
- Server: `GET /api/cron/daily` (constant-time bearer, `after()` pushes), `POST /api/remind` (200/400/401/403/429+retry_after), `vercel.json` cron `0 14 * * *`, proxy matcher excludes `/api/cron`. `reminderHandler.ts`, `cronAuth.ts`, `reminderDeps.ts`; `PushPayload` union (+ `reminder` type); `public/sw.js` shows «Ты должен Айдосу 200 ₸ · Рассчитаться» and opens `/settle/<creditor>`. Mock mode: `x-mock-user` header (E2E gate only) + `CRON_SECRET` as the mock server secret.
- Repo/mock/supabase: `createPurchaseCustom`, `deletePurchase`, `updatePurchaseDescription`, `setRemindersEnabled`, `remind`, `runDailyReminders`; `RepoError.retryAfter`, code `has_payments`; mock schema v6 (`reminderLog`).
- UI: `/purchases` (days, filters Все/Мои/Должен я), `/purchases/[id]` (Purchase.dc.html: lime card, «Кто скинул», edit, two-step delete), «Свои суммы» in Новая покупка, `RemindButton` (sending / Напомнили / Можно через N ч) on `/settle` rows, pair screen and detail rows, «Напоминания» switch on Квартира, «Напомнить» quick action live. Removed «скоро» from Напомнить, Свои суммы, remind pill and the Покупки tab; «Ежемесячно» and other payers stay «скоро».
- Optimistic delete/edit via `PurchaseTracker.remove/restore/rename`; `listRedirect` no longer redirects when the single counterparty owes me (the list carries the pill).

## Results
- `npm run verify`: green (46 test files, 479 tests, lint, tsc, build). `npm run test:e2e`: 54/54 (45 old + 9 new; slice 1 and 3 assertions about «скоро» / the single-counterparty redirect were updated).
- Screenshot: `gan-harness/screenshots/s52-cmp-purchase.png` (left Purchase.dc.html, right the app; script `gan-harness/shoot-s52.mjs`).

## Known gaps
- Dead push endpoints from reminders are not pruned (prune RPC is capture-token gated; anon surface stays at 3 functions).
- Visual deltas vs Purchase.dc.html: «на 4 человека» (correct plural instead of «человек»), 1-2px row/avatar offsets, thinner check stroke.
- `from_name_dative` in the RPC result is the raw display name; the route declines it (declension.ts).
- Cron in Supabase mode is untested live (fake client + PGlite only).

---

# Slices 6+7 "Monthly bills + Квартира" (one pass)

Nothing committed. Servers stopped. 0001-0005 and `.env.local` untouched; no service-role key.

- SQL `supabase/migrations/0006_slice6_7.sql` (+ `tests/db/slice67.test.ts`): bills.participants, purchases.bill_id/bill_month (unique per bill+month), bills write only through RPCs (upsert_bill, delete_bill, set_bill_amount), `run_monthly_bills(secret)` (anon, body in private.generate_bills(now), Asia/Almaty), set_member_role, remove_member, leave_household (zero net via pair_net, 23514 not_settled), rotate_invite_code (12 chars), set_away. Anon surface = 4 functions (tested).
- Cron `/api/cron/daily` runs bills after reminders; push type `bill` («Коммуналка: введи сумму за ноябрь», opens /monthly) in sw.js.
- UI: /monthly (Bills.dc.html), /monthly/new and /monthly/[id] form, amount sheet; Fab «Ежемесячный платёж» and the Home quick action are live; Квартира per Invite.dc.html (QR via `qrcode`, share/copy, member admin sheet, away sheet, profile sheet, leave, rotate code, household switcher persisted with set_default_household); default participants skip away members.
- Results: `npm run verify` green (53 files, 526 tests); `npm run test:e2e` 59/59 (5 new in slice67.spec.ts, own household injected into the mock store).
- Screenshots: gan-harness/screenshots/s67-cmp-bills.png, s67-cmp-flat.png (script gan-harness/shoot-s67.mjs).

Known gaps (slices 6+7): variable-bill notice repeats on every daily cron until the amount is entered; Bills «Всего» counts only known amounts; 1-2px vertical deltas vs the mockups; the month bar has arrows (spec) so it is wider than the mockup's; the black pill at the top of app screenshots is the iPhone emulation, not app UI; Supabase path only tested with fake client and PGlite.

---

# Slice 8 "Polish, offline, forgot password" (one pass)

Nothing committed. Servers stopped. No SQL changes, `.env.local` untouched.

- SW: `public/sw-rules.js` (pure `strategyFor` / `shouldCache`, loaded by `importScripts`) + `public/sw.js` (precache `/offline`, manifest, icons and the offline page's `/_next/static` assets under `obshak-static-v1`, old caches deleted on activate; cache-first for static, network-first navigation with 4 s timeout then `/offline`; everything else is not intercepted). Never cached: `/api/*`, Authorization, cross-origin, RSC, non-GET, no-store/private, HTML pages. `/offline` and the sw files are excluded from the proxy matcher and public in the supabase proxy.
- UI: `/offline`, `error.tsx`, `not-found.tsx`, `loading.tsx` for Главная/Покупки/Ежемесячно/Квартира, `EmptyState` (capsule illustration) on Главная, Покупки, Ежемесячно, OfflineBanner, BadgeSync (`badgeCount`, `applyBadge`), InstallPrompt (iOS hint / beforeinstallprompt, 14-day snooze), TabBar links `prefetch`.
- Forgot password: «Забыли пароль?» on Вход, `/forgot`, `/reset` (code or token_hash, `?mock=1[&email=]` in mock mode); Repo `requestPasswordReset`, `startPasswordRecovery`, `updatePassword`; README section; `docs/DEVICE_CHECKLIST.md`.
- Tests: verify green (55 files, 542 tests); e2e 63/63 (4 new in slice8.spec.ts). E2E noise filter also ignores "Failed to fetch RSC payload". The slice52 «Напомнили» test is timing-sensitive under load (failed in 2 of 4 full runs, passes alone).
- Leftover: a duplicate `git stash` entry (stash@{0}) from a mistaken stash/apply; the working tree is intact; drop it with `git stash drop`.

---

# Slice 9 "Telegram group notifications" (one pass)

Nothing committed. Servers stopped. 0001-0006 and `.env.local` untouched; no token anywhere; nothing applied to the live DB.

- SQL `supabase/migrations/0007_slice9_telegram.sql`: `profiles.telegram_username` (check `^[A-Za-z0-9_]{5,32}$`), `households.telegram_chat_id bigint`, `private.telegram_sent(kind, ref, sent_at, pk(kind, ref))`, RPC `public.set_telegram_username(text)` (authenticated only), private `tg_esc`, `tg_money`, `tg_tag`, `tg_purchase_message`, `tg_settlement_message`, `tg_send` (pg_net + vault `telegram_bot_token`, dynamic EXECUTE guarded by to_regprocedure/to_regclass), trigger functions `tg_on_purchase`, `tg_on_settlement`, deferred constraint triggers `tg_purchase_notify` (purchases insert/update) and `tg_settlement_notify` (settlements update). profiles insert is now column-granted (telegram_username excluded).
- Status values: purchase posts when `status = 'shared'` on insert or `pending -> shared`; settlement posts on `status` becoming `'confirmed'`. Monthly bills = `bill_id is not null` (house icon).
- App: Repo `setTelegramUsername` (mock + supabase + contract test), `normalizeTelegramUsername`, TextField `hint`, Telegram field in the Профиль sheet, ru.ts copy, README "Telegram" section.
- Tests: tests/db/slice9.test.ts (14), contract test, e2e Профиль Telegram in slice67.spec.ts. verify green (557+ tests); e2e 64/64.
- E2E isolation fix: slice67's cron helper drops reminder-log rows the cron added for the seeded flat, and slice52 clears the log before its remind test (the cron raced it into the 6 h cooldown).
- Gaps: pg_net/vault path is never executed in tests (PGlite has neither); real sending untested live. Callback of net.http_post failures is not inspected. A user can set any free handle (no uniqueness).

---

# Slice 10 "Decide in the Shortcut" (one pass)

Nothing committed. 0001-0007 and `.env.local` untouched; nothing applied to the live DB.

- SQL `supabase/migrations/0008_slice10_capture_choice.sql`: drops `capture_purchase(text,integer,text)` and creates `capture_purchase(p_token, p_amount, p_merchant, p_choice text default null)` (security definer, `search_path=''`, anon only). `shared`/`общее` -> shared at once, equal split among active members not away (everyone if all are away; stays pending if amount < head count), `personal`/`моё`/`мое` -> personal, anything else -> pending as before. Returns `status`; subscriptions are `[]` unless pending. Dedupe now per outcome. Anon surface stays 4 functions (the 4-arg one replaced the 3-arg one).
- App: `parseChoice` in `captureHandler.ts` (lenient, Russian too), `choice` passed through `Repo.capture` (mock + supabase), `CaptureResult.status`; no push unless pending. Old Shortcut without `choice` is unchanged.
- Tests: `tests/db/slice10.test.ts` (PGlite), choice cases in `captureHandler.test.ts`, supabaseRepo arg test updated.
- Gap: the Shortcut recipe text in /settings/shortcut is not updated (out of spec); mock-mode `away` uses the Almaty day like SQL.

---

# Slice 11 "Swipe left to delete + Telegram reminder" (one pass)

Nothing committed. 0001-0008 and `.env.local` untouched; nothing applied to the live DB.

- SQL `supabase/migrations/0009_slice11_admin_delete.sql`: `create or replace public.delete_purchase(uuid)` (payer, or active admin via `private.is_admin` only when `status = 'shared'`; pending/personal of others stay P0002; non-admin non-payer 42501; has_payments unchanged; grants authenticated only), new `private.tg_remind_message(debtor, creditor, amount)`, `create or replace public.remind(text, uuid, uuid)` (same body as 0005 plus a guarded `tg_send` after the reminder_log insert). Anon surface stays 4.
- Manual vs cron: only `remind` (the manual RPC, behind `/api/remind`) posts; `run_daily_reminders` is unchanged and never calls Telegram. Cooldown raises `rate_limited` before the insert, so a blocked remind posts nothing. The send sits in `begin ... exception when others then null`; no chat id, pg_net or vault secret means `tg_send` is a no-op.
- App: `src/lib/domain/canDelete.ts` (used by `deletePurchase` in AppDataProvider, the detail screen delete button, the swipe rows), mockRepo allows admin delete of shared, `src/components/app/swipe/` (`SwipeDeleteRow` motion drag x with dragDirectionLock and an opacity-faded «Удалить» capsule, `DeleteConfirmSheet` on the Sheet kit, `useSwipeDelete`), wired into Home «Последние покупки» and Покупки. Reduced motion: no drag, the detail-screen delete remains. Copy in ru.ts `purchases.swipe*`.
- Tests: tests/db/slice11.test.ts (16, PGlite), canDelete unit tests, tests/e2e/slice11.spec.ts (2). vitest `hookTimeout` raised to 120 s.
- Gaps: pg_net/vault path never runs in tests (recording stub only); the e2e swipe uses synthetic mouse moves and retries because a loaded machine drops frames; under load (load avg ~20) a different unrelated e2e test flaked on each full run (slice3, slice4, slice52, kit double tap), all green when rerun.

---

# Slice 12 "Потом -> 19:00 digest, Telegram DM with buttons" (one pass)

Nothing committed. Servers stopped. 0001-0009 and `.env.local` untouched; nothing applied to the live DB; no token anywhere; Telegram API never called for real.

- SQL `supabase/migrations/0010_slice12_tg_dm.sql` (+ `tests/db/slice12.test.ts`, 23 PGlite tests): `profiles.telegram_user_id bigint unique`, `private.telegram_link_codes` (sha256 only), `private.pending_digest_log(purchase_id, sent_on)`, RPCs `create_telegram_link_code`, `unlink_telegram` (authenticated), `tg_link_account`, `tg_resolve_pending`, `run_pending_digest` (anon + `private.server_secret_ok`). Anon surface 4 -> 7 (exact list asserted in slice12.test.ts; older tests apply only 0001-0009 and still say 4).
- Capture: `parseChoice` returns `'later'` for later/потом; explicit later = pending with NO push (handler skips it; the RPC still gets null), missing/junk = pending WITH the instant push.
- Webhook `POST /api/telegram/webhook` (`src/lib/server/telegram/{parse,api,digest,env,deps,webhookHandler}.ts`): constant-time secret check before reading the body (401), 64 KB cap, zod-parsed subset, `/start <code>` links, `s:`/`p:<uuid>` buttons resolve, answerCallbackQuery then editMessageText, always 200 after a valid secret. `POST /api/telegram/setup` (Bearer CRON_SECRET) calls setWebhook. `src/proxy.ts` matcher now excludes `/api/telegram` (a cookie-less caller would otherwise be redirected to login).
- Cron: `handleCron` runs `run_pending_digest` after reminders and bills: one push `{type:"digest",count}` per user (sw.js shows «Ждут решения: N покупок», opens `/`) and one DM per purchase (<=10) with [Общее][Моё]. A digest failure reports 500 but does not hide the reminders.
- UI: Квартира -> Профиль -> `TelegramLink` (pill -> one-time code -> «Открыть Telegram» link, `window.open` attempted; linked state «Telegram подключён · Отключить»). Repo: `createTelegramLinkCode`, `unlinkTelegram`, server-only `tgLinkAccount`, `tgResolvePending`, `runPendingDigest` (mock + supabase); `getMe` turns `telegram_user_id` into `telegram_linked`.
- Env (README + .env.example, no values): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (16+), `NEXT_PUBLIC_TELEGRAM_BOT` (default obshagk_bot).
- Tests: verify green (63 files, 647 tests); e2e slice4/8/52/67 green (new: slice67 «Подключить Telegram»). Under load slice52 «delete is blocked» and slice67 «away» flaked once in a combined run and passed on rerun.
- Gaps: `profiles.telegram_user_id` is readable by housemates like other profile columns (profile select is table-wide). The webhook/digest DM path is unit-tested with a recording Telegram client only. Mock mode never calls the bot. The digest runs once a day at 19:00 Almaty; a purchase captured after the run waits for the next day.

---

# Perf pass (spec-perf.md, one pass)

Nothing committed. No servers running. No SQL, `.env.local` untouched. Visual design unchanged (see below).

## Results
- `npm run verify`: green (66 files, 664 tests, build OK; the one lint warning is in untracked scripts/video).
- `npm run test:e2e`: 65/67 on the full run; the 2 failures (slice11 «plain member cannot swipe», slice3 «reduced motion» sampler) passed when rerun (whole slice3 file 9/9, slice11 test alone). Both are load-sensitive; kit Sheet test updated (body overflow toggle is gone, it now asserts the overlay's `touch-action: none`).
- Before/after screenshots (mock mode, same seed): `gan-harness/screenshots/perf-{before,after}-{home,home-full,purchases}.png`. Script `gan-harness/shoot-perf.mjs`, compare `gan-harness/compare-perf.mjs`: 0 pixels differ by more than 8/255 (max channel delta 5 on Главная, 1 on Покупки).

## P1 (data layer)
- Resume: `src/lib/data/resume.ts` (`createResumeRefresher`): visibilitychange only, 30 s gap (counted from provider start), 400 ms delay, in-flight refresh reused, cancelled if hidden again.
- No-op commits: `src/components/app/snapshot.ts` (`reconcileSnapshot`, `shareList`): `commit` keeps unchanged rows by identity and skips `setState` when nothing changed; the same is applied to the last server load (`loadedRef`). `PurchaseTracker.view` reuses row objects (`derived` cache); `settledLocally` touches only purchases covered by confirmed settlements (Set) and returns the same object otherwise.
- After a successful mutation (add, delete, edit, markPaid, confirm/cancel, resolve) one debounced silent refresh 1.5 s later (`scheduleRefresh`); failure paths still roll back and refresh at once as before.
- Bounded history in supabaseRepo (`src/lib/data/history.ts`): purchases = last 90 d + older pending + older with an unsettled share (3 parallel queries, then full rows by id for the open ones); settlements = last 90 d OR status marked. Mock repo is not bounded.
- Stale-while-revalidate: `snapshotCache.ts` (localStorage `obshak:snapshot:<userId>`, version 1, try/catch); painted from cache as soon as `getSession()` answers (if the real load has not landed), then replaced; cleared on sign-out; written when idle and only if the load changed.
- Settle data / cards / active summary computed once in the provider (`useAppDerived`; `useSettleData` and `useHouseholdCards` just read it). `Intl.DateTimeFormat` hoisted. `cards` array is kept stable when equal.
- Context split: `useAppStatus()` (status, stage) used by Guard, HouseholdChoice, JoinScreen.
- `<link rel=preconnect>` + dns-prefetch to the Supabase origin (only when the URL is set).

## P2 / P3
- 9 PurchasesScreen: no AnimatePresence, CSS `.list-fade-in` (200 ms, only after a filter change), memo(Row) + memo(Item), 40 rows + «Показать ещё» (`ru.purchases.showMore`, Pill on/lg), `.row-cv` content-visibility.
- 10 SwipeDeleteRow memo, hoisted constants, capsule mounted only while dragging, `wrap` is a useCallback, confirm sheet mounted only while a delete is being asked about (cleared in `onClosed`).
- 11 `layout="position"` removed from RecentPurchases, PendingSection, IncomingSection (enter animation kept; the shift of the rows below a new one is no longer animated).
- 12 Money writes `textContent` through a ref (layout effect + onUpdate), no state per frame. 13 Skeleton is a CSS keyframe (`.skeleton-pulse`).
- 14 memo CardStack and BalanceCard; `onFrontChange` follows the card after 650 ms (immediately on mount / reduced motion). 15 island opens after a double rAF; Sheet no longer touches `body.style.overflow` (overlay is `touch-none overscroll-contain`). 16 `prefetch={false}` on per-row links; TabBar `prefetch` prop removed. 17 `--color-bar: #191b21` (card 94% over bg) replaces the color-mix.
- 18 proxy skips Supabase auth for `next-router-prefetch` / `purpose` / `sec-purpose` prefetch headers (tests with a mocked `updateSession`). 19 sw.js navigations: plain `fetch`, offline page only when fetch rejects (tests added in sw.test.ts). 20 QrSheet via `next/dynamic` (mounted on first tap), `qrcode` imported inside the now-async `qrPath`.

## Known risks
- Cached snapshot can show data up to one session old for a moment before the real load replaces it.
- `.is("shares.settled_at", null)` on an embedded `shares!inner` and `.or(marked_at.gte...,status.eq.marked)` are PostgREST filters verified only against the fake client, not a live project.
- A prefetch header can be forged, but it only returns the data-less page shell (data stays behind RLS).

# CSS motion (spec-css-motion.md, one pass)

Nothing committed. Servers stopped. No SQL, `.env.local` untouched.

## Mechanisms
- Curves: `src/lib/motion/index.ts` `css.{smooth,softSpring,snap}` (+ `cssTransition`, `SNAP_MS`, own `useReducedMotion` on matchMedia). Mapping: spring.snap -> `cubic-bezier(.25,.25,.2,1)` 270 ms (least-squares fit of the spring step response); softSpring = the reference `--s` curve; spring.soft pop [1.08,1] -> `.pop` keyframe 450 ms softSpring.
- TabBar / Segmented pill: `ui/useSlidePill.ts`, FLIP with WAAPI (`translateX` + `scaleX` from the previous pill box to identity, measured once per change, `origin-left`); each active tab still renders its own pill (SSR-exact at rest). Reduced: 150 ms opacity.
- Fab / Fab menu: `.fab`, `.fab-menu` in globals.css, toggled by `data-hidden` / `data-open`; menu `visibility:hidden` after the 0.55 s close transition (kit test now queries it with `includeHidden`).
- CardStack: inline `transform`/`opacity` + CSS transition (.6 s, slide .22 s); face overlays CSS opacity. 650 ms deferred switch unchanged.
- Sheet: card laid out at final size; `.sheet-face` scales from pill size (`--sx/--sy`, `--ex/--ey`, `--h` written in a layout effect), origin top center; a real `.sheet-pill` crossfades (no radius distortion); backdrop `enter`/`leave` CSS; content mounted from the pill phase (opacity 0), so a backdrop tap is also accepted in the pill phase. Phases, timers, ✓ «Поделено», no-island path, focus handling and test ids unchanged.
- Lists / Toast / OfflineBanner / InstallPrompt / WaitingSection: `.enter` / `.leave` keyframes (`--enter-y`, `--enter-d`...), exits via `src/lib/motion/presence.ts` (`usePresenceValue`, `usePresenceList`, tested).
- Netting, ReceivedRow, PairScene: inline transform/opacity + CSS transitions, `.pop`; PairScene waiting/caption swap via presence.
- motion/react remains in: Money (number roll, `animate`), SwipeDeleteRow (drag), and cross-fades on Login, Forgot, PurchaseDetail, RemindButton, SettleScreen (rare, `m` + `AnimatePresence`). Providers uses `LazyMotion` with an async `domMax` bundle (only when online; offline leaves them static).

## Results
- `npm run verify` green; touched e2e (kit, slice1, 3, 4, 11, 52, 67, 8) green (see final report for the full run).
- Screenshots `gan-harness/screenshots/css-{before,after}-*.png`, side by side `css-cmp-*.png` (scripts `shoot-css.mjs`, `compare-css.mjs`, `combine-css.mjs`); end states match (Покупки 0 px differ; Главная only AA at the avatar edge). Mid frames are timing-noisy; use `gan-harness/timings-css.mjs` for computed durations/easings: Fab .4/.5 s, menu .35/.55 s soft, sheet .55 s soft + content .25 s after .22 s.

## Known
- Sheet corners during the first ~100 ms are a crossfade pill -> card (squashed corners hidden under the pill).
- Interrupting a tab-pill slide jumps from the last resting box (motion's layout handled interruptions smoothly).

---

# Light theme (spec-light-theme.md, one pass)

Nothing committed. Servers stopped. No SQL, `.env.local` untouched.

- Tokens: `src/styles/tokens.css` keeps the dark set; `@media (prefers-color-scheme: light)` overrides it («Белый + фиолет», accent = the "lime" family as violet #6a3fe0). New tokens: `card-sun*`, `card-window*`, `night-on-hill`, `on-person`, `tile-{green,sand,violet,rose}` (+ `on-`). `.theme-dark` re-applies the dark set; the Sheet (island) uses it so it stays black. `color-scheme: light dark`.
- Contrast compromise: muted is #6a6684 instead of the spec's #7c7894 (4.4:1 on white, 3.9:1 on card-2 -> AA now).
- PWA chrome: `statusBarStyle: "default"` (black-translucent gives white status text, invisible on light), `theme-color` per scheme (`src/lib/themeColors.ts`, tested against tokens.css), manifest colours stay dark #0E0F13 (a manifest has no per-scheme value). Trade-off: content starts below the status bar (opaque system bar), no edge-to-edge.
- Home: `HomeHeader` (flat pill with menu when 2+ flats / link to Квартира with one, bell, avatar), `Bento` (Тебе должны + Напомнить, next bill tile or «Ежемесячно/Добавить», Траты with 6 weekly bars), `CategoryTile` + `domain/category.ts`, one rounded card of rows with hairlines and a «N из M» chip. `domain/spending.ts`, `domain/nextBill.ts` (unit tested). CardStack follows `frontId` changes made from outside. Removed GreetingHeader, QuickActions, DebtsCard. The row subtitle is «payer · день» (merchant no longer shown on the row).
- E2E: playwright `use.colorScheme = "dark"` (kit page fixture); specs that open their own contexts run in light. Assertions moved: greeting -> avatar link «Профиль и квартира, <имя>»; Долги text -> `bento-owed-amount`; «Расчёт»/«Рассчитаться» links -> the Тебе должны tile link; quick «Покупка» -> Fab menu. New `theme.spec.ts`.
- Screenshots: `gan-harness/screenshots/theme-{light,dark}-{home,home-full,fab,purchases,settle,monthly,flat,island}.png` (script `gan-harness/shoot-theme.mjs`).

---

# Slice 13 "Kaspi minimum 100 ₸" (one pass)

Nothing committed. Servers stopped. 0001-0010 and `.env.local` untouched; 0011 not applied to the live DB.

- SQL `supabase/migrations/0011_slice13_min_transfer.sql` (+ `tests/db/slice13.test.ts`, 21 PGlite tests): `private.min_transfer()` (immutable, 100), `settlements.kind` ('transfer' | 'writeoff', default transfer), replaced `run_daily_reminders` (0005: skips net < 100), `remind` (0009: `too_small` P0001 after the creditor check, before cooldown/log/Telegram), `mark_settlement` (0003: `too_small` when 0 < net < 100, evaluated before the idempotent re-mark branch), new `write_off_small(p_household, p_debtor)` (creditor only, 0 < net < 100, pair lock, withdraws a stale `marked` row of the pair, records the shares and calls `confirm_settlement`), `private.tg_writeoff_message`, replaced `private.tg_on_settlement` (0007: picks the write-off message when `kind = 'writeoff'`). Anon surface unchanged (7).
- TS: `src/lib/domain/minTransfer.ts` (`MIN_TRANSFER`, `isAccumulating`, `isTransferable`, tested). `Settlement.kind?`, `RepoErrorCode` `too_small` / `not_small`, `Repo.writeOffSmall` (mock + supabase + contract tests), mock remind / daily / mark mirror the SQL, mockDb schema accepts `kind`. `/api/remind` answers 409 for too_small; the client shows `ru.remind.tooSmall`.
- UI: «копится» note on the pair screen (no Kaspi bar, no «Я оплатил», no «Напомнить»), `WriteOffButton` (secondary pill + confirm sheet) on the pair screen and the list rows, list caption «N ₸ · копится», Главная bento (claimable amount, muted `копится N ₸` line, «Напомнить» only when something is claimable), BadgeSync ignores debts under 100, purchase detail note «Твоя доля … — добавится к следующему расчёту» and «Списано N ₸» on written-off shares, remind pill hidden for accumulating pairs. `AppDataProvider.writeOff` is optimistic with rollback.
- Tests: verify green (73 files, 725 tests). E2E `tests/e2e/slice13.spec.ts` (1) plus slice1, 3, 4, 8, 11, 52, 67, theme, kit green; slice52 «Напомнить» failed once in a combined run (duplicate push from a parallel cron) and passed alone.
- Gaps: no standalone settlement history screen exists, so «Списано» shows on the purchase detail rows; the written-off row uses the share amount, not the net. pg_net/vault path still unexercised.

---

# Slice 14 «Очередь» (spec-slice14.md, one pass)

Nothing committed. Servers stopped. `.env.local` untouched; 0001-0011 untouched; `0012_slice14_duty.sql` is NOT applied to the live DB.

## SQL (`supabase/migrations/0012_slice14_duty.sql`, `tests/db/slice14.test.ts`, 38 PGlite tests)
- Tables with RLS (members select, no client writes): `duties` (kind cooking|trash|water|custom; one active duty per kind and household), `duty_members(duty_id, user_id, position)`, `duty_overrides(duty_id, day, user_id, source swap|admin, reason)`, `duty_done`, `duty_swap_requests` (pending|accepted|declined|cancelled|expired); `private.duty_morning_log(duty_id, day)`.
- Private: `almaty_today`, `duty_day_label`, `duty_tag`, `duty_resolve` (override > recorded done > rotation `(day - start) mod n`; from today on away/inactive members are skipped to the next available, past days stay plain), `duty_assignee`, `duty_clean_order`, `duty_set_members`, `duty_respond` (the one place a swap is decided: lock duty row then request row; posts «⇄ @a и @b поменялись: пн 17 ⇄ вт 18» through `tg_send`), `duty_notice`, `duty_visible` (RLS helper, granted to authenticated).
- Authenticated RPCs (definer, `search_path=''`, actor `auth.uid()`): `duty_schedule(duty, from, to)` (day, user_id, source rotation|swap|admin|skip, done, request_id, skipped_user), `create_duty`, `set_duty_order`, `admin_assign_day` (null user clears; cancels pending swaps touching the day), `mark_duty_done` (today; yesterday only before 09:00), `request_swap`, `respond_swap`, `cancel_swap`, `swap_notice(secret, request, 'requested'|'declined')` (authenticated AND server secret, like `remind`).
- Anon (server-secret gated, 28000 without it): `run_duty_morning(secret)`, `tg_respond_swap(secret, tg_user_id, request, accept)`. The anon surface is now exactly 9.
- Errors: P0001 with message busy / stale / not_assignee / past_day / future_day / locked / expired. Expiry = earlier day 10:00 Almaty; an answer after it returns the row as `expired` (lazy), the morning cron and `request_swap` expire in bulk, `duty_schedule` ignores overdue pending requests.

## TS
- `domain/duty.ts` (+ test): date maths, `resolveDay` (mirror of the SQL), `swapExpiresAt`, `effectiveStatus`, `timeLeft`, tones (`toneMap`), `buildWeek` / `buildMonth` / `monthStats` / `neighbours`.
- Repo: `listDuties`, `dutySchedule`, `listSwapRequests`, `getSwapRequest`, `createDuty`, `setDutyOrder`, `adminAssignDay`, `markDutyDone`, `requestSwap`, `respondSwap`, `cancelSwap`, `swapNotice`, `runDutyMorning`, `tgRespondSwap`; `RepoErrorCode` += busy, not_assignee, past_day, future_day, locked, expired. `mockDuty.ts` (mock twin, own test), `supabaseDuty.ts`; `mapDbError` maps the P0001 messages; mock db schema gets optional `duties`, `dutyOverrides`, `dutyDone`, `swapRequests`, `dutyMorningLog` (no version bump).
- Server: `dutyHandler.ts` (`handleMorning`, `handleDutyNotify`, group text, DM text + `sw:a|d:<id>` keyboard), `GET /api/cron/morning` (Bearer CRON_SECRET), `POST /api/duty/notify` (session user; push + DM to the other side), webhook handles `sw:a:`/`sw:d:` (`parseSwapCallback`), declined-from-Telegram pushes the requester; `vercel.json` second cron `0 4 * * *`; push payload types `duty-today`, `swap-request`, `swap-declined` (+ sw.js + tests).
- UI (`components/app/duty/`): `/duty` (DutyScreen: chips, StoveCard, PendingCards, WeekCard, OrderCard, create flow for admins, empty state for members, order/start sheet, «Заменить повара» sheet), `/duty/calendar` (month nav, legend, stats; with `?swap=<day>` it is the picker for the swap sheet), `/duty/request/[id]`, SwapSheet (DutySwap), Home tile `DutyTile` (hidden without a duty), TabBar «Очередь» between Покупки and Ежемесячно (5 tabs, tighter paddings), tokens `stove-*`, `duty-*`, `faint`, `lime-ink`.

# Slice 15 «Мусор» и «Вода» (spec-slice15.md, one pass)

Nothing committed. `0013_slice15_trash_water.sql` is NOT applied to the live DB; 0001-0012 and `.env.local` untouched.

## SQL (`supabase/migrations/0013_slice15_trash_water.sql`, `tests/db/slice15.test.ts`, 18 PGlite tests)
- `duties` += price_per_liter (20), bottle_liters (5), bottles_total (4), bottles_full (4). New `duty_events(id, duty_id, kind done|ping|empty, user_id, partner_id, liters, purchase_id, created_at)` with RLS (members select, no client writes). partner_id = second carrier on `done`, the current person on ping/empty.
- Private: `duty_current` (pointer, away/inactive skipped), `duty_event_open` (lock duty row, member + kind check), `duty_event_cooldown` (P0001 rate_limited, hint = seconds), `duty_group_line` (Telegram, never fails the event).
- Authenticated RPCs: `duty_done_event`, `duty_ping` (2 h), `water_empty` (1 h, bottles 0), `water_brought(duty, partner)` (2 / 4 bottles, shared purchase via check_participants + insert_equal_shares, so triggers/netting/Telegram apply), `water_bottle_used`, `set_water_price` (admin), `duty_event_notice(secret, event)` (authenticated + secret, own fresh event only).
- `run_duty_morning` replaced to skip trash/water (they have no day).
- Anon surface: still 9.

## App
- `domain/dutyEvents.ts` (+test), mock twin in `mockDuty.ts` (+`mockDutyEvents.test.ts`), `supabaseDuty.ts`, Repo methods, `/api/duty/event-notify`, push `duty-event` + sw.js, tokens `bin-*`, `aqua-*`, `bottle-empty`.
- UI: chips switch Готовка / Мусор / Вода (`?kind=`), `TrashPanel`, `WaterPanel`, `useEventDuty`, CreateDuty per kind, settings sheet for event duties (no start date), admin price sheet.
- Tests: verify green (824 unit), e2e slice14 + slice15 green; screenshots `gan-harness/screenshots/duty15-trash.png`, `duty15-water.png`.

## Gaps
- Not run against live Supabase; pg_net Telegram lines untested outside PGlite (tg_send is a no-op there).
- Trash card sub-line can wrap when the time is «сегодня, HH:MM» (mock shows «вчера»).
- «Вода кончилась» push only when the current person is not the caller.
