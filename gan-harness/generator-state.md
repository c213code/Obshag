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
