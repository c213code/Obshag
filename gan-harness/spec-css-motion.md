# GAN spec: Motion → compositor (CSS / WAAPI) (lean process)

**User request:** «Да, переведи». Make the main animations smooth even in iOS Low Power Mode, where WebKit throttles requestAnimationFrame to about 30 fps.

**Goal:**
- Every frequent animation runs on the compositor: CSS transitions or keyframes, or WAAPI `element.animate()`, on `transform` and `opacity` only.
- It must look identical: the same durations, the same easing curves (from `src/lib/motion` / tokens, converted to `cubic-bezier`), and the same start and end states.
- For springs, use a close `cubic-bezier` (e.g. `softSpring` → `cubic-bezier(.34,1.18,.64,1)`, `snap` → a short ease-out). Document the mapping in `src/lib/motion`.

**Rules:**
- No SQL. Do not touch `.env.local`. Do not commit or stash.
- `docs/design` and `docs/design/motion-reference.html` are the visual truth.
- Reduced motion keeps working: no movement, opacity only or instant.

## Convert, in this order

1. **TabBar active pill** (`layoutId` spring) and **Segmented pill**: a single absolutely positioned pill moved with a CSS `transform: translateX()` plus a width or scale transition, measured once per tab change.
2. **Fab and Fab menu** (`TabBar.tsx` menu, `Fab.tsx`): CSS transitions toggled by `data-open`. While closed, keep the menu `visibility:hidden` after the transition.
3. **CardStack / BalanceCard:** `y`/`scale` per depth plus the face overlays become inline `transform` with a CSS transition (`.6s` and the same curve). Keep the slide-down and the 650 ms deferred household switch.
4. **Sheet (island):**
   - Replace the motion `layout` grow with a compositor animation.
   - Render the card at its final size and animate `transform: scale()` from the pill size, with `transform-origin: top center`. The content stays hidden during growth, as now.
   - Avoid visible radius distortion: animate an inner rounded background element with an inverse scale, or crossfade a real pill element into the card. Pick what looks identical.
   - The backdrop is a CSS opacity transition.
   - Keep the phases, timings, «✓ Поделено» pill, the no-island fade path, focus handling and every test id.
5. **List enter animations** (RecentPurchases, PendingSection, IncomingSection, Toast, OfflineBanner, InstallPrompt): CSS `@keyframes` for opacity plus `translateY`, the same values.
6. **PendingCard, Netting, PairScene, ReceivedRow:** any `scale`/`scaleX`/`y`/opacity motion becomes CSS or WAAPI.

## Keep motion (JS) only where needed

- The swipe drag (finger-driven).
- The Money number roll. Keep it, already ref-based.
- Anything genuinely gesture-driven.

After this pass, motion/react should be imported in few files. If motion is still needed, switch to `LazyMotion` + `m` with `domAnimation`, or `domMax` only where drag is required, to shrink the bundle.

## Done when

- `npm run verify` is green.
- e2e passes for the touched specs (kit, slice1, slice3, slice4, slice11, slice67, plus whatever else references these components). Rerun flaky ones alone; the machine may be loaded. Update e2e assertions that read motion-specific inline styles to the new mechanism, without weakening what they check.
- Before/after mock screenshots of Главная, the island sheet open, the Fab menu open and Покупки, in `gan-harness/screenshots/css-*.png`, with no visible difference.
- Also capture mid-animation frames, or check the computed transitions, to show the timings match.
- Append a "CSS motion" note to `generator-state.md`.
- The final report lists each component and its mechanism, what is still on motion and why, and the results.
