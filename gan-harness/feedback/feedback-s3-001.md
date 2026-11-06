# Evaluation s3 iteration 001 (slice 3 Netting and settlement)

Mode achieved: live WebKit iPhone 15 (Playwright scripts, two contexts), mock build on :3100 with blank Supabase env. Servers stopped.

| Criterion | Score | Weight | Reason |
|---|---|---|---|
| Functionality | 6.0 | 0.35 | verify green (222 unit tests, 94.8% lines on src/lib, build OK), flow works by hand, but the slice-3 e2e "cancel" test failed 2 of 3 runs (30 s timeout in `withPhone` close, slice3.spec.ts:297-340) |
| Design fidelity | 8.0 | 0.30 | Pay screen near pixel-identical to Pay.dc.html; Russian declension missing; Скопировать state differs from mockup |
| Motion and craft | 7.5 | 0.20 | netting count + Получил ✓ present and sane; not frame-compared against reference timing |
| Code quality | 7.5 | 0.15 | not audited deeply; structure per spec, SQL 0003 present, PGlite tests green |

**Weighted total: 7.1**  (PASS by 0.1, flaky e2e is the reason it is not higher)

## Commands
- `npm run verify`: exit 0, 28 files / 222 tests, coverage All files 94.81 lines.
- `npm run test:e2e`: 31 passed, 1 failed, 3 skipped (serial dependents). The failure is `slice3.spec.ts:297 cancel: ...` with "Test timeout of 30000ms exceeded / browserContext.close: Test ended". Re-run of slice3.spec.ts alone: failed again (4 passed, 1 failed, 3 not run). Third run: 8/8 pass. So the suite is flaky around 2 of 3 runs. The cancel test nests three `withPhone` contexts plus fixed `waitForTimeout(300/900)`; the test is slow (6.3 s when green) and non-deterministic.
- Manual flow (my script, two contexts): A pays 4000, B pays 3600. B main shows "ты должен 200". B Рассчитаться redirects straight to /settle/<A> (single counterparty). Pay screen text: 2 000 / 1 800, equation "2 000 − 1 800 = 200 ₸", arrow ends at "200 ₸", caption «Один перевод вместо двух». Перевести: popup URL exactly https://kaspi.kz/transfers, clipboard got +77010000222, chip «скопирован» appears. Double-click «Я оплатил": one marked settlement, waiting «Ждём подтверждения от Айдос», button becomes «Отменить». Reload mid-flow: waiting state persists. A Главная shows «Подтверди оплату» with «Ерасыл отметил оплату 200 ₸» + «Получил» (1 row). B then bought 1000 split after the mark; A tapped Получил: ✓ shown, old two purchases become «1 из 1 скинули», new «Вода» stays «0 из 1», A owes 500, B is owed 300 (new share correctly not covered). No page errors. Not exercised by hand: the full «Все в расчёте» for both with no later purchase (covered by e2e test 4, green), 3-person list (e2e test 7, green).

## Design diff (390px, Pay.dc.html vs live s3ev-pay-end.png; Main vs a-incoming/a-got-mid)
Matches: header capsule, avatar colors, arrow colors, equation pill, 3-token typography, two-column cards, floating bar with grey «Я оплатил» + lime «Перевести 200 ₸ ↗», spacing and radii visually identical. Differences:
1. Copy grammar: «Расчёт с Айдос» (ref «Айдосом»), «Ты → Айдос» (ref «Айдосу»), «Kaspi · Айдос» (ref «Kaspi Айдоса»). Known by generator, still a visible miss against a user who "rejects any drift".
2. Kaspi row shows a grey «Скопировать» pill until copied; ref shows the green «✓ скопирован» chip statically. Ref also drops the "·" separator.
3. At the end state only one orange arrow (correct per #3 end); ref static Pay shows both arrows and 2 000/1 800 labels. Acceptable (that is the animation's purpose) but the static screenshot after animation differs from Pay.dc.html by design.
4. Reload while waiting replays nothing but the «скопирован» chip resets to «Скопировать»: state not persisted (minor).
5. Получил mid frame: button text «Получ…» clips under the ✓ circle while shrinking (text is cut instead of fading). Check reference #4: label fades with the shrink. Subtle but visible. Row also holds "получено" and a full progress line "все скинули"; ref has no such caption.
6. Debtor Главная shows no sign of the pending outgoing payment (nothing mismatches the ref, but UX gap).

## Prioritized fixes
1. tests/e2e/slice3.spec.ts:297-340: make the cancel test deterministic (no fixed waitForTimeout; await state; avoid nested contexts holding open; raise timeout or split). Currently the required e2e suite fails ~2/3 runs; this alone would cap Functionality.
2. src/.../settle (pair screen header, side titles, Kaspi label) and ru.ts: add Russian declension (dative/instrumental/genitive) for names, at least for the common endings, with a fallback to a neutral phrasing («Расчёт: Айдос»). Expected: «Расчёт с Айдосом», «Ты → Айдосу», «Kaspi Айдоса».
3. Kaspi bar: show the green «✓ скопирован» chip style per Pay.dc.html; keep a tappable fallback but match the ref pill when copied; persist copied state across reload or drop the "Скопировать" pill.
4. ReceivedRow (Получил): fade the button label to 0 while the button shrinks so the text is not clipped by the ✓.
5. Show a «Ждём подтверждения» pill row on the debtor's Главная (optional UX).
6. Netting end state: confirm result colour flash (~0.9 s lime) is in reference #3 (it is) — no action; verify timing with a frame capture next iteration.
