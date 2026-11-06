# Slice 3: fix list for iteration 2, plus an auth change requested by the user

Sources:
- the user's decision on auth
- the evaluator (`gan-harness/feedback/feedback-s3-001.md`, 7.1)
- the security reviewer (H1, M1, L1–L3)
- the code reviewer (verdict BLOCK, with H1–H2 and M1–M5)
- my own side-by-side comparison against `docs/design/Pay.dc.html`

`0001` and `0002` are LIVE on Supabase and must not be edited. `0003` is NOT applied yet, so edit it in place. Put any change to 0001/0002 objects (for example `create_purchase_with_shares`) in a new `0004_*.sql`.

## U. User decision: switch auth from email OTP to email + password

The user does not want codes. Sign-up and sign-in use email + password through Supabase Auth. Email confirmation is OFF in the project settings, so `signUp` returns a session immediately.

- `/login` becomes a capsule screen with two modes, «Вход» and «Регистрация». Use a Segmented control, same design language.
  - **Вход:** email and password, «Войти».
  - **Регистрация:** email, password (min 8) and repeat password, «Создать аккаунт».
  - Show a password visibility toggle as an eye icon.
  - Errors are short Russian messages:
    - «Неверная почта или пароль»
    - «Такая почта уже зарегистрирована»
    - «Минимум 8 символов»
    - «Пароли не совпадают»
- After sign-in or sign-up, the existing guard flow is unchanged: onboarding, then household, then Главная. The `/join/[code]` deep link must still survive.
- Remove `/login/verify` and the OTP code paths from both repos and the UI. If `/login/verify` is hit, redirect it to `/login`.
- Supabase repo: `signUp({email, password})` and `signInWithPassword`. Keep `signOut`. Map these errors to `RepoError`s:
  - `invalid_credentials`
  - `user_already_exists` / `email_exists`
  - `weak_password`
  - a rate limit
- Mock repo: store users with a password, any non-empty password of 8 or more characters. In mock/E2E, seed users get the password `password123`. Mirror the error semantics.
- Update every e2e spec (slices 1 and 3) and the contract tests to the password flow.
- «Забыли пароль?» is out of scope. Show nothing for it.
- Update `README.md` and `.env.example` notes: no OTP template is needed, and "Confirm email" must be OFF.

## S. Security (must fix)

**S1 (HIGH, security H1 + code M1). Confirm can close shares that were never paid.**
- Problem: `confirm_settlement` closes shares by time (`created_at <= marked_at`). It can close a share that was never paid: a purchase committed late, a pending purchase that later became shared, or a purchase deleted after the mark.
- Fix: record the exact covered set at mark time.
  - Add a table `public.settlement_shares(settlement_id, purchase_id, debtor_id, amount)` with primary key `(settlement_id, purchase_id, debtor_id)` and foreign keys. RLS: select for household members only; no client writes.
  - `mark_settlement` takes the pair lock, then inserts exactly the open shares between the pair in both directions (both debtors), and computes `amount` from those rows. It never accepts an amount from the client.
  - `confirm_settlement` locks the settlement, then verifies that every recorded share is still open and its purchase is still `shared`. If anything has changed (deleted, already settled, or status changed), raise 23514 `stale_settlement`. The client shows «Суммы изменились — отметь оплату заново» and the settlement is auto-cancelled. Otherwise it closes exactly those shares.
- PGlite tests:
  - a late purchase stays open
  - pending → shared after the mark stays open
  - a deleted purchase gives stale
  - a normal confirm closes exactly the recorded set
- Mirror all of this in the domain (`coveredShares` uses the recorded set) and in the mock repo.

**S2 (MEDIUM, security M1). The idempotent mark returns an old amount.** When `mark` returns an existing marked settlement whose recorded set or amount no longer matches the current open set, refresh it: replace its `settlement_shares` and its amount, still under the lock.

**S3 (LOW).**
- Use the same error for a settlement id that doesn't exist and one that isn't yours, P0002 → `not_found`.
- `pair_net` returns bigint, or the result is capped.
- Add a simple cap: at most 20 mark/cancel operations per user per hour, in a `private` table, like `join_attempts`.

After 0003 is applied, a check must confirm that `has_function_privilege('anon', …)` is false for all new functions. Add this as a SQL test in PGlite too.

## C. Code review: HIGH

**C1. `settlementTracker` loses rollbacks.**
- Problem: it builds views from the previous view, so optimistic rows and rollbacks are lost.
- Fix:
  - Keep the last server lists in a `serverRef`, and always build `view(h, serverRef.current[h])`.
  - Recompute purchases from the server purchases plus the locally confirmed ones.
  - On rollback, restore the snapshot without depending on `refresh()`.
- Tests: chain `view(view(…))` after `release`, and check that a failed mark, a failed confirm and a failed cancel all fully revert. Also check offline, where refresh fails too.

**C2. Infinite redirect with a departed counterparty.**
- `netForUser` gets an `isActive` filter, or the list uses only counterparties that have a member record.
- `SettleScreen` never bounces back to `/settle` for the sole counterparty. It renders the state «<Имя> больше не в квартире». Departed members' debts are shown on the list as read-only rows, but they are not part of the redirect logic.
- Home totals keep counting them, so nothing is silently dropped.
- Test: a departed sole counterparty causes no loop.

## M. Code review MEDIUM, evaluator, and design

**M1. A failed «Получил» plays the success animation.** Release the held row when the result is false, and don't show the ✓ unless the confirm succeeds. Either play the ✓ only after the promise resolves, or reverse it on failure.

**M2. Cancel guard.** Shorten it to about 350 ms, and base it on the gesture timestamp. Set `aria-disabled` and dim the button while it is guarded.

**M3. E2E determinism (evaluator #1).**
- Rewrite the cancel test so it is deterministic: no fixed `waitForTimeout`, no triple-nested contexts, and cancel right after the mark.
- Route `https://kaspi.kz/**` with `fulfill`, and assert only the popup URL.
- The countdown check needs at least 2 samples, plus a monotonic check and an endpoint check.
- Close contexts in `finally`.
- Run the slice 3 suite 5 times in a row; it must pass 5/5.

**M4. Name declension (evaluator #2, design).**
- Implement a small Russian declension helper for first names, in `src/lib/i18n/declension.ts`, with unit tests.
  - Cases: instrumental (с кем), dative (кому) and genitive (кого).
  - Rules:
    - Masculine names ending in a consonant: +ом / +у / +а. Айдос → Айдосом, Айдосу, Айдоса. Ерасыл → Ерасылом.
    - Names ending in -й: -ем / -ю / -я. Нурлыбай → Нурлыбаем.
    - Names ending in -а or -я: -ой (-ей) / -е / -ы (-и). Даня → Даней, Дане, Дани.
    - Names ending in -ь: -ем / -ю / -я.
    - Otherwise, leave the name unchanged.
- Use it in:
  - «Расчёт с Айдосом»
  - «Ты → Айдосу», «Айдос → тебе»
  - «Kaspi Айдоса»
  - «Ждём подтверждения от Айдоса»
  - «Перевести Айдосу»

**M5. Kaspi bar (evaluator #3).**
- Match the mockup: the lime-soft «✓ скопирован» chip.
- The number is copied automatically on the first user gesture on the screen, or when the bar is tapped. Until then, show «Скопировать» in the same chip shape, not a grey generic pill.
- After a reload, keep the copied state per counterparty in sessionStorage.

**M6. Получил label clipping (evaluator #4).** Fade the label out (opacity) while the button shrinks, then show the ✓.

**M7. Bottom bar position.** On `/settle/[userId]`, the bottom capsule bar must be fixed to the bottom with the safe area, as in `Pay.dc.html`. My comparison showed it sitting mid-screen after the content. Content must scroll above it.

**M8. Debtor's Главная.** Add a «Ждём подтверждения» row in the same section style, showing the waiting state for my marked settlements.

## L. Code review LOW (do these)

- `SettleListScreen` back uses `router.back()` when there is history.
- Copy synchronously first, using the legacy textarea path. If both clipboard paths fail, show «Не удалось скопировать — номер: …».
- Don't auto-redirect from the list on a refresh-driven change. Redirect only on the first load.
- `PairScene`: reset the `played` state when the animation restarts.
- `snapRef` is updated synchronously in the setter.
- `settlementTracker` overrides get a TTL of about 30 s.
- The transition-colors flash can stay. It is a color tween on text, and the user approved the lime flash from the reference.

## Done when

- `npm run verify` is green.
- `npm run test:e2e` is green 3 times in a row.
- The slice 3 spec passes 5/5.
- Side-by-side screenshots of `/settle/[userId]` and `/login` (both modes) are in `gan-harness/screenshots/s3i2-*`.
- Nothing is committed.
