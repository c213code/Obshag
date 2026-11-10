# GAN spec: Perf pass, "smooth on iPhone" (lean process)

**User request:** «у меня на телефоне наш сайт лагает с фризами … найди место которые держат много и также сделай так что бы всё было плавно».

Three read-only audits found the causes below. Fix them with **NO visual change**: the approved design (docs/design) must look identical, and motion feel stays the same.

**Rules:**
- No SQL and no migrations.
- Do not touch `.env.local`.
- Do not commit or stash.
- Approved skills: ecc:react-performance, vercel:react-best-practices, ecc:motion-foundations, ecc:make-interfaces-feel-better, ecc:react-patterns, ecc:e2e-testing, vercel:nextjs, ecc:tdd-workflow.

Work in priority order. If time runs out, finish P1 fully before P2.

## P1: data layer and resume (the main freeze)

All of this is in `src/components/app/AppDataProvider.tsx`, `purchaseTracker.ts` and `supabaseRepo.ts`.

1. **Resume:**
   - Listen to `visibilitychange` only. Drop `focus`.
   - Minimum gap between resume refreshes: 30 s.
   - Start the refresh about 400 ms after becoming visible (setTimeout, or requestIdleCallback when available).
   - De-dupe in-flight refreshes: return the running promise.
2. **No-op commits:**
   - After loading, skip `commit` entirely when nothing changed. Compare per household: ids plus status/updated fields, or a cheap version key.
   - When something did change, keep **structural sharing**: unchanged purchase, settlement and member row objects keep their previous identity. That applies to `withLocalRows`, `tracker.view` and `rebuild`.
   - `settledLocally` must only touch purchases covered by confirmed settlements, using a precomputed Set, and return the same object otherwise.
3. **After a successful mutation** (delete, edit, markPaid, confirm, cancel, resolve, add): do not fire an immediate full refresh. Coalesce into one debounced silent refresh about 1.5 s later. The optimistic state is already right. Keep the rollback-on-failure behaviour exactly.
4. **Bounded history** in `listPurchases`:
   - Fetch purchases from the last 90 days, plus any older purchase that still has an unsettled share or is pending (a second query, merged by id).
   - Netting must stay correct, since it only needs open shares. Add a unit test proving balances are unchanged versus a full fetch.
   - Do the same for settlements: last 90 days plus any non-final ones.
5. **Instant first paint (stale-while-revalidate):**
   - Persist the last successful snapshot to `localStorage`, keyed by user id and with a version number, wrapped in try/catch.
   - On start, if a cached snapshot exists for the current session user, render it immediately (`status` ready), then silent-refresh.
   - Clear it on sign-out.
   - The mock mode keeps working.
6. **Settle data once:** compute `useSettleData`'s result and the household summaries once in the provider (or one shared memo store) and expose them via context. BadgeSync, Home, Settle and Flat read it; nobody recomputes. Hoist the `Intl.DateTimeFormat` in `useHouseholdCards.ts:11` to module scope.
7. **Context split:** put status/stage in its own context so `Guard` and other status-only readers don't re-render on data changes.
8. Add `<link rel="preconnect">` (and dns-prefetch) to the Supabase origin in the root layout.

## P2: rendering and animation

9. **PurchasesScreen:**
   - Remove `AnimatePresence mode="popLayout"` and the exit on filter change. Use a plain keyed div with a CSS opacity fade-in (~200 ms, same ease).
   - `memo(Row)`.
   - Render the first 40 rows plus a «Показать ещё» pill (copy in `ru.ts`, capsule kit).
   - Add `content-visibility:auto; contain-intrinsic-size:auto 72px` on rows.
10. **SwipeDeleteRow:**
    - Hoist `dragConstraints`/`dragElastic` constants.
    - Mount the red «Удалить» capsule only while dragging or revealed.
    - `memo` the component.
    - Make `useSwipeDelete().wrap` stable (`useCallback`).
    - Render the confirm sheet only while open.
11. **`layout="position"`:** remove it from list items in RecentPurchases, PendingSection and IncomingSection, keeping the enter animation (opacity plus y). Keep it only on a freshly inserted row if that is cheap.
12. **Money:** no React state per frame. Write `textContent` through a ref in `onUpdate`; JSX renders the final value. Skip the roll on silent refreshes when the value is unchanged. The look stays the same.
13. **Skeleton:** replace the infinite `motion.div` shimmer with a CSS `@keyframes` opacity animation in `globals.css`, with the same values and timing.
14. **CardStack:**
    - `memo` CardStack and BalanceCard with stable `cards`.
    - Defer `onFrontChange` → `switchHousehold` until the card animation finishes (~650 ms), or wrap it in `startTransition`.
15. **PendingScreen/Sheet:**
    - Open the island one frame after Home paints (double rAF).
    - Don't toggle `document.body.style.overflow`; rely on the fixed overlay plus `touch-action:none`/`overscroll-behavior`.
16. **Per-row links:** add `prefetch={false}` on per-row `<Link>`s (purchases, settle rows). On TabBar, remove the explicit `prefetch` prop and keep the default behaviour.
17. **Bar:** use an opaque `--color-bar` token computed to look identical to the current 94 % mix.

## P3: network and boot

18. **`src/proxy.ts`:** skip the Supabase auth check for prefetch requests (`next-router-prefetch` header, or `purpose: prefetch`). Keep the protection for real navigations. Update `proxy.test.ts`.
19. **`public/sw.js`:** navigations shouldn't hang on a timer. Pass navigations through `fetch`, and return the cached `/offline` page **only on an actual network error (rejection)**. Remove the 4 s race. Update `sw.test.ts`/`swRules.test.ts`.
20. **QrSheet:** load it with `next/dynamic`, and import `qrcode` lazily inside the QR code path.

## Done when

- `npm run verify` is green.
- `npm run test:e2e` is green once. Rerun only failing specs; the machine may be loaded.
- Add unit tests for: the structural sharing / no-op commit, the bounded-fetch netting equivalence, and the resume throttle.
- Take before/after screenshots of Главная and Покупки in mock mode to prove there is no visual change: `gan-harness/screenshots/perf-*.png`.
- Append a "Perf pass" note to `generator-state.md`.
- The final report lists what was done per item, what was skipped and why, and the results.
