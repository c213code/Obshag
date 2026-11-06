# Feedback 001: Slice 0 "Scaffold" (Общак)

Evaluation mode: no Playwright MCP tools; used a Playwright script (WebKit, iPhone 15) against `NEXT_PUBLIC_DATA_MODE=mock next dev -p 3100`. Screenshots: `gan-harness/screenshots/eval-*.png`. Dev server stopped (port 3100 free).

| Criterion | Score | Weight | Reason |
|---|---|---|---|
| Functionality | 8.0 | 0.35 | verify and e2e green, RLS test real, every spec item works; gaps: no reduced-motion test, Sheet "Поделено" collapse not built (not in spec §3) |
| Design fidelity | 7.5 | 0.30 | Tokens exact, capsule style consistent, no stray hex; kit page has English dev labels, unlabeled giant skeletons, fixed TabBar overlaps content mid-scroll |
| Motion and craft | 7.5 | 0.20 | transform/opacity only, Fab never rotates, tap locks and reduced-motion branches present; Sheet distorts radius via scaleX/scaleY, menu items lack lock |
| Code quality | 8.0 | 0.15 | strict TS, zod env, clean repo/mock split, correct .gitignore, no secrets; minor items below |

**Weighted total: 7.8** (0.35*8.0 + 0.30*7.5 + 0.20*7.5 + 0.15*8.0 = 2.80 + 2.25 + 1.50 + 1.20). Verdict: PASS (threshold 7.0).

## Commands run and results
- `npm run verify`: green. Lint, typecheck OK; vitest 5 files / 31 tests pass; coverage 99.06% stmts, 98.86% lines on src/lib (≥80%); `next build` OK, routes `/`, `/kit` static.
- `npm run test:e2e`: 5/5 pass (WebKit iPhone 15, 8.6s): no console errors, tab pill moves + aria-current, Fab menu, CardStack front changes, Money ends at `200 ₸`.
- Hex grep outside tokens.css (`grep -rnE '#[0-9A-Fa-f]{3,8}\b' src | grep -v tokens.css`): no matches. All values in tokens.css match SDD §5.1 / spec (bg #0e0f13, lime #c8f25a, etc.; radii 12/20/28/999; type utilities correct).
- Animated-properties grep (width/height/boxShadow/filter/top/left/rotate in src/components, src/lib/motion): only static classes, SVG attributes and the CardStack container's fixed `height` style (not animated). All animated targets are x/y/scale/scaleX/scaleY/opacity. No `rotate` anywhere.
- Live checks (script): Fab computed transform `none` after menu opens (no rotation); rapid tap Покупки then Главная within lock leaves "Покупки" current (second tap ignored); Money demo settles at exactly "200 ₸"; Sheet opens with Magnum / 6 000 ₸ / chips / lime "Общее · по 1 500 ₸"; reduced-motion context: CardStack still advances to "Дача" (fade path); console errors: none; page width 393 = scrollWidth 393 (no horizontal overflow).
- RLS test (`tests/db/migration.test.ts`) read: uses PGlite with stub `auth.uid()` from `request.jwt.claim.sub`, `set role authenticated`, asserts RLS on all 10 public tables (and count = 10), A cannot see household B purchases, B sees only own, personal purchase and its shares hidden from member C but visible to payer, push_subscriptions owner-only, cross-household insert rejected, profiles limited to housemates, check constraints. Genuinely proves isolation.
- Secrets: only `.env.example` (empty values) exists; no `.env*` files, no keys in src. `.gitignore` covers node_modules, .next, `.env*` with `!.env.example`, coverage, playwright-report, test-results, gan-harness/screenshots. Correct. No-lag CSS present in `src/app/globals.css` (tap highlight, touch-action, overscroll, 16px inputs, user-select, color-scheme, safe-area, tabular-nums). `aria-current="page"` set on active tab (button or Link).

## Prioritized fixes
1. `src/app/kit/KitGallery.tsx` (visual): fixed TabBar sits over scrolling content with no scrim/backdrop; in eval-scroll1/2 it covers a BalanceCard and the BottomActions demo. Add a bottom gradient/backdrop fade in `bg` (opacity only) or make TabBar demo less intrusive; BalanceCard/BottomActions end up half hidden mid-scroll. Expected: content readable under the bar, matching the canvas.
2. `src/app/kit/KitGallery.tsx`: section labels are English component names uppercased (SEGMENTED, LISTROW И AVATAR, CARDSTACK, SKELETON) and Pill demo labels "Ghost/On/Lime"; spec says all copy via `ru.ts`. Move to Russian strings in `src/lib/i18n/ru.ts`. Also the "Последнее действие: –" line wraps awkwardly.
3. `src/components/ui/Skeleton.tsx` / gallery: skeleton demo is three unlabeled giant blocks (one ~170px tall) that look like a rendering bug. Give them card/ListRow/amount shapes.
4. `src/components/ui/Sheet.tsx`: animating `scaleX: 0.28, scaleY: 0.1` on the whole sheet distorts the 28px top radius and border during open/close. Use a clip/mask-free alternative (scaleY with counter-scale is not possible; consider translateY + opacity, or an inner pill element that scales and cross-fades) so the radius never visibly warps. Also the sheet's left edge is flush/cut at the 390px max width on a 393 viewport; keep it inside the safe margins or full-bleed intentionally.
5. `src/components/ui/TabBar.tsx`: menu items (`choose`) and the backdrop-less outside-tap handler have no tap lock; a double tap during the 0.32s open/close can re-trigger. Route `choose` and Fab through the same lock, and add `role="menu"` keyboard handling (arrow keys, focus first item on open).
6. `tests/e2e/kit.spec.ts`: add tests for reduced motion (`reducedMotion: "reduce"`), Sheet open/close via backdrop and Escape, and a rapid double-tap on CardStack (should advance only once). Currently none of the motion rules (tap-lock, reduced-motion) is covered by automated tests.
7. `src/components/ui/Money.tsx`: under reduced motion it jumps instantly (acceptable) but per-frame `setState` re-renders the whole span at 60fps; fine for now, consider writing to a ref/DOM node if used in lists.
8. `src/lib/env.ts`: default `NEXT_PUBLIC_DATA_MODE="supabase"` makes a bare `npm run dev` fail at runtime when `getRepo()` is called; document this prominently in README (the "mock" command) or add a `dev:mock` script. Optional: `themeColor` is omitted; add it via a token-derived constant in tokens-adjacent TS file so the PWA status bar matches bg.
9. Hygiene: `tsconfig.tsbuildinfo` and `coverage/` exist on disk (ignored, fine); `test-results/` likewise. No action required.
