# Evaluation: Slice 1 "First end-to-end path", iteration 001

Mode achieved: live Playwright WebKit iPhone 15 script (own walkthrough, two contexts) against a production build, mock + NEXT_PUBLIC_E2E=1, port 3100. Screenshots: gan-harness/screenshots/s1ev-*.png and s1ev2-r-*.png.

| Criterion | Score | Weight | Reason |
|---|---|---|---|
| Functionality (slice 1 path) | 8.5 | 0.35 | verify + 25/25 e2e green; full path works with correct balances on both phones; stale-members and a few unhandled edges remain |
| Design fidelity | 7.5 | 0.30 | Главная/Новая покупка are close to the mockups; visible deltas listed below; mockup-less screens consistent |
| Motion and craft | 8.0 | 0.20 | Fab menu / stack OK, no forbidden animated props, no raw hex; a few craft gaps |
| Code quality | 8.0 | 0.15 | 133 tests, ~92% lines on src/lib; no raw hex found outside tokens; Server Actions skipped (documented) |

**Weighted total: 8.0**  (0.35*8.5 + 0.30*7.5 + 0.20*8 + 0.15*8 = 7.975). PASS (threshold 7.0).

## Commands run
- `npm run verify`: green. 18 test files, 133 tests passed, coverage 91.5% stmts / 92.4% lines, build OK (16 routes).
- `npm run test:e2e`: 25 passed (18 kit + 7 slice1).
- Raw hex grep in src outside tokens: none. Motion grep: no animated width/height/box-shadow/filter.
- Manual walk (below).

## Manual walkthrough results
- `/` redirects to `/login`. Empty email shows an inline alert ("Проверь почту..."). Wrong code 123456 shows "Код не подошёл..." and stays on verify. 000000 goes to onboarding.
- Onboarding: empty submit shows two inline errors. "+7" prefix, input is formatted as "700 123 45 67". Typing "8 700 123 45 67" is silently reduced to "700 123 45 67" (acceptable).
- Create "Квартира 42": Главная OK. Reload keeps the session and data (state in localStorage / mock-store).
- Second context: registers, "У меня есть код". A wrong code gives one generic message. A lowercase valid code is accepted. Joins, sees the card stack.
- Purchase 6 000 with "6 000" typed with a space: accepted, shown as "6 000 ₸", "по 3 000 ₸ на 2 человека". Double-click on submit created exactly one purchase.
- Balances: user 1 "+3 000 ₸ / тебе должны 3 000 ₸", user 2 "−3 000 ₸ / ты должен 3 000 ₸". Correct. Reload keeps it.
- Optimistic row and rollback are covered by e2e (passes).

## Functional defects
1. **Stale members after another user joins (major).** I had user 1 on Главная, user 2 joined, user 1 navigated by tab links to /purchases/new: "На кого" showed only "Я" ("по 6 000 ₸ на 1 человека"), so the purchase was saved with no debtor. It only refreshed after a full reload. Real users will hit this constantly (invite a flatmate, then add a purchase). Fix: refetch household members/profile on AppDataProvider mount of /purchases/new and on Главная focus/visibilitychange/route entry (or poll mock-store every few seconds in E2E mode); in Supabase mode refetch on focus, and add realtime in slice 2.
2. **Amount above 10 000 000 gives no message.** With 99 999 999 the bar says "по — / введи сумму" and the ✓ stays disabled; nothing tells the user why. Fix: inline hint "Не больше 10 000 000 ₸" under the amount, and clamp input.
3. **Purchase with only me selected is allowed** (1 participant, no debt, silent no-op for balances). Fix: either require ≥2 participants or show "Выбери, на кого делить" and disable ✓ when only the payer is selected.
4. **Back navigation**: from /purchases/new, `goBack()` returned to /flat (history is correct), but the X in the header should be verified to land on `/`, not history-back, when the page was opened by deep link.
5. **Join a household you are already in / second invite code**: Квартира shows "5JQVBK 6FXLUD", a 12-char code wrapped over two lines with no visual grouping. It is hard to dictate. Fix: shorten to 6-8 chars or render as "5JQV BK6F XLUD" on one line (smaller type), and make the share copy the full string.

## Design fidelity: Главная vs docs/design/Main.dc.html (390px)
Matches: header (greeting, "Общак", bell, lime avatar), lime BalanceCard with rings and avatars and "ноябрь", four action circles (lime + 3 grey), Долги card, floating TabBar + Fab, typography, tabular money, ₸ glyph. Differences:
1. Notification dot on the bell: present on user 2's Главная, absent on user 1's (and in the empty state). Ref always shows the orange dot. Decide a rule (unread) or always show it as the mockup does.
2. CardStack peeks: reference shows two grey faces above the lime card. With one household there is no peek at all (acceptable, but the card then sits ~20px higher than the ref; the ref spacing below was designed for the peeks).
3. Action labels: disabled actions carry an extra "скоро" caption line, so the labels are taller than in the ref (two-line vs one-line) and "Ежемесячно" nearly touches the container edge. Intended by spec, but the row height differs from the mockup.
4. Долги bar: ref has a lime bar with a small orange segment on the left. App shows a plain empty track when 0/0, full lime for owed-only, full orange for owe-only; there is no mixed orange+lime segmentation to compare (verify proportion with both owe and owed non-zero).
5. "Рассчитаться" disabled: rendered as a muddy olive gradient (dark green-brown fading towards the TabBar area) instead of the ref's solid lime. It looks like a rendering bug, not a deliberate disabled state. Fix: flat `--color-lime` at 35-40% opacity on solid bg, or a grey-capsule disabled style with no gradient.
6. Card chip: ref "1 из 3", app "0 из 1" / "0 из 0". Semantics differ ("housemates even with me"); with 0 members it reads "0 из 0", which is meaningless. Hide the chip when M=0.
7. Balance of 0 shows "0 ₸" with an avatar of only me, no "+" sign: fine.
8. Purchase row: ref has the dark-olive cart tile, "Magnum · 18:40" subtitle and a lime progress bar with "2 из 3". App row shows "Ты · 23:48", "6 000 ₸", and the progress text "0 из 1скинули" in the DOM text (sr-only word, fine visually) but verify the progress bar is drawn; in my screenshots it sits under the TabBar and I could not confirm it. Scroll padding at the bottom must let the last row clear the TabBar (the "Последние покупки" heading is already half under the TabBar at rest, as in the ref).
9. In the empty state, "Последние покупки / Все" is hidden under the TabBar at the first screen, the same as the ref; OK.

## Design fidelity: Новая покупка vs docs/design/AddPurchase.dc.html
Matches: Header close pill, big white 6 000 ₸ with ₸ glyph, subtitle line, section labels, lime "Я" segment, "Поровну / Свои суммы" segmented, person pill with lime outline, bottom bar "по X ₸ / на N человек" + lime ✓ Fab. Differences:
1. "Кто платил": in the ref the segmented shows all members (Я Айдос Даня Нурик) and they are tappable; in the app Я fills the whole width when alone, and with others the extra payers are disabled (spec). Disabled options are visually identical to enabled ones except colour, so the user taps and nothing happens. Add a visible disabled style or a hint.
2. "Свои суммы" is disabled but looks identical to the enabled state (same grey as the ref's inactive tab). Add reduced opacity or "скоро".
3. Amount block sits ~1-2px off vertically (generator already admits this); the amount/subtitle spacing is slightly tighter than the ref (ref 2 400 at y=355 on 780px-wide capture, subtitle 455).
4. "На кого" pills: ref uses a 2-line wrap with non-selected pill greyed; with one member this is a single pill. Verify the unselected look with 3+ members (not seen in my run as only 2 members existed).
5. Bar copy: "на 1 человека" vs ref "на 3 человек": plural logic is correct for Russian, fine; ref copy itself is the oddity.
6. Description input: no visible affordance (placeholder-only line under the amount). In the empty state I could not see a placeholder; verify a muted "Что купили?" placeholder shows.

## Mockup-less screens (consistency)
- /login: big white title, muted caption, pill input, lime full-width CTA at the bottom. Consistent. Large dead space in the middle, acceptable.
- /login/verify: six rounded-rect cells (not capsules, but squircle) with a lime focus ring; "Другая почта" back-pill header; disabled "Дальше" is dark olive (same muddy look as the Рассчитаться issue). The test-mode hint wraps with "000000" orphaned on its own line. Fix: shorten copy or use `text-wrap: balance`.
- /onboarding: avatar capsule with "?" and lime circle is a nice touch; fields are pill inputs; consistent.
- /household: two big capsule choices; the second option uses a check-mark icon that suggests "done", not "enter a code". Use a key/hash icon. Large empty lower half.
- /flat: invite lime card (good), neighbour ListRow, "Другая квартира" grey pill, "Выйти" as plain muted text sitting right above the TabBar and looking disabled; use an outlined/danger capsule and make sure it clears the TabBar.
- Fab menu: lime icons, highlighted first row, lime "Закрыть", matches ref-fab-menu. "Ежемесячный платёж" is enabled in the menu but leads to a placeholder (inconsistent with the "скоро" marking on Главная).

## Prioritized fixes
1. src (AppDataProvider / purchases/new): refresh members when entering the purchase screen and on focus; otherwise purchases are saved with no debtor after a join. Expected: "На кого" shows the new neighbour without a reload.
2. Disabled Pill style (Рассчитаться, verify "Дальше", onboarding): replace the olive gradient with a flat low-opacity lime or neutral grey. Expected: no gradient artefacts, matches the capsule language.
3. Purchase form validation: messages for >10 000 000 and for "no one else selected"; disable ✓ when no debtor.
4. Bell dot rule: show consistently (same on every user) or tie to a real unread count.
5. Hide the card chip when there are no other members; define the "N из M" copy for 0.
6. Disabled segmented options (Айдос/Даня payer, Свои суммы): visible disabled style plus "скоро".
7. Invite code: shorter (or grouped on one line); copy-to-clipboard feedback on "Поделиться".
8. /household second choice icon (key instead of check), /flat sign-out as a proper capsule; /monthly Fab item marked "скоро" or hidden.
9. Verify copy wrap ("000000" orphan): `text-wrap: balance`.
10. Add an e2e for "member joins while another is on the purchase screen" and for the over-limit amount.
