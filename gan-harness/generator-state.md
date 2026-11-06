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
