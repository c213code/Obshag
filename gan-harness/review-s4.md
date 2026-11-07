# Slice 4 fix list (iteration 2)

Sources:
- the evaluator, `gan-harness/feedback/feedback-s4-001.md` (score 7.2)
- the security reviewer: 0004 must NOT be applied until H1 is fixed
- the code reviewer: BLOCK, 3 HIGH items
- a live bug the user hit

Migrations 0001–0003 are LIVE. 0004 is NOT live, so edit it in place. Don't touch `.env.local`.

## S. Security

**S1 (HIGH): SSRF / VAPID-token leak through `push_subscriptions.endpoint`**
- Add an allowlist CHECK on the table (in 0004, via `alter table … add constraint … not valid` then `validate`): `endpoint ~* '^https://(web\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com)/'`.
- `revoke insert, update on public.push_subscriptions from authenticated`. Writes go only through the `save_push_subscription` RPC, which also checks the host and caps each user at 10 subscriptions (when the cap is reached, the oldest one is removed).
- Keep `select` and `delete` for the owner, or switch delete to a `delete_push_subscription` RPC.
- In `webPush.ts` and `pushSubscriptionSchema`:
  - parse the endpoint with `new URL()`, check the hostname against the allowlist and require empty username/password
  - pass `timeout: 5000` to web-push
- PGlite tests cover:
  - a disallowed host is rejected, both by the RPC and by a direct insert
  - the cap
  - anon still cannot do anything

**S2 (MEDIUM): endpoint ownership move.** The device→new user move is legitimate (sign-out, then a different sign-in). Keep it, but document it in SQL comments. The code fix C1 below removes the leak case: A's row is deleted on sign-out.

**S3 (LOW)**
- Dedupe Shortcut retries. The same user, same amount and same merchant within 60 s returns the existing pending purchase instead of a new one; add a test.
- Strip C0/C1 control characters and bidi overrides from `merchant` in `capture_purchase` and in the SW title.
- Add `unique(user_id)` on `capture_tokens`, or an advisory lock in `rotate_capture_token`; add a test.
- Revoke `capture_purchase` from `authenticated`, so only anon needs it.
- Count a capture op before amount/merchant validation, so failed captures also hit the cap.

## C. Code review HIGH

**C1. Delete the push subscription on sign-out.**
- Before `repo.signOut()`: `const sub = await reg?.pushManager.getSubscription(); if (sub) { await repo.deletePushSubscription(sub.endpoint).catch(()=>{}); await sub.unsubscribe().catch(()=>{}) }`.
- Add a contract test for `deletePushSubscription`.

**C2. Keep the subscription in sync.**
- When the status is "on", silently re-save the subscription, so the server row belongs to the current user.
- In `enablePush`, compare `sub.options.applicationServerKey` with the current VAPID key. If they differ, unsubscribe and resubscribe.
- Add a `pushsubscriptionchange` handler in `sw.js` that resubscribes and posts a message to clients, which re-save it.

**C3. No silent pushes.** Every `push` event must call `event.waitUntil(showNotification(...))`. On bad or unknown data, show the fallback «Общак» / «Новая покупка» with url `/`.

## C. Code review MEDIUM

**C4.** Set `maxDuration = 15` on the capture route. Log only the status code of non-gone push failures; never log tokens or endpoints.

**C5.** In `notificationclick`, prefer a visible client, then `focus().then(navigate).catch(() => openWindow(url))`.

**C6.** In `enablePush`, race `navigator.serviceWorker.ready` against a 5 s timeout. On timeout, show the "failed" state.

**C7. `PendingScreen.resolve`:**
- Disable «Общее» while the roster is empty.
- Show «Поделено ✓» only after the server confirms. A short busy state on the button is fine.
- On failure or stale data, keep the sheet open and show an inline message: «Уже решено» / «Не получилось, попробуй ещё раз».

**C8.** In the capture route, reject when `content-length` > 4096. Compare `Buffer.byteLength(text)` too.

**C-LOW**
- `useMemo` for the filtered purchases on Главная.
- Cap `pushLog` at 50 entries.
- Remove `vapidKey!`.
- Manifest: add `"id": "/"`, a maskable 512 icon, and take the 180 icon out of the manifest list.
- Add parseAmount tests for `".123.456"` (decide reject or accept, then pin it), non-ASCII digits (reject), and `1e3` as a number (accept 1000), plus a comment pinning that `"2,125"` means 2125.
- Fix the Playwright `serviceWorkers:"block"` comment.
- Add one E2E with `serviceWorkers:"allow"` that dispatches a synthetic push into the real WebKit worker and asserts that `showNotification` was called. Spy through an `evaluate` on the registration if possible; if WebKit makes this impossible, document why.

## D. Design (evaluator; the user rejects drift)

Compare against `docs/design/ApplePay.dc.html` and `docs/design/motion-reference.html` #2.

1. **«Ждут решения»** goes at the TOP of Главная: right under the header, above the card stack. It must be visible without scrolling.
2. **No backdrop dim.** The reference has none. Use at most a very light 10–15% scrim, and the lime card must stay lime.
3. **Island geometry and motion, exactly as reference #2:**
   - It starts as a small black capsule at the top centre: ~120×34, radius 22.
   - It grows into a card positioned like the Dynamic Island card in `ApplePay.dc.html`: top-anchored, width = screen − 22px, radius ~44, height sized to the content.
   - The content fades in late.
   - On resolve it collapses back to a small pill (~150×34) at the top centre showing ✓ «Поделено» / «Моё». It must not cover the header, the bell or the balance; it sits in the island zone above the header, under the safe-area top.
   - Measure the sizes from the reference screenshots at 390px.
4. **Copy fixes.**
   - A personal purchase in the payer's list shows «моё» / «личное» instead of «все скинули».
   - A capture without a merchant falls back to «Покупка Apple Pay» in the sheet. Keep the stored description short.
5. **Token display** on `/settings/shortcut`: show the full token, wrapped in monospace, inside a capsule card with a copy button. It must never be truncated.
6. **Re-shoot the comparisons** after the fixes: `gan-harness/screenshots/s4i2-cmp-*`.

## U. Live bug the user hit (slice 3 auth)

On real Supabase, sign-up returned HTTP 500. The cause was SMTP failing while "Confirm email" was ON. The app showed a generic «Что-то пошло не так».
- Map a 5xx or `unexpected_failure` on signUp to: «Не получилось создать аккаунт. Если это повторяется — администратору: выключить Confirm email в Supabase или проверить SMTP.». Put it in `ru.ts`.
- Make it shorter for users: show «Регистрация сейчас не работает. Попробуй позже» and log the detail to `console.debug` (dev only).
- Add a fake-client test.

## Done when

- `npm run verify` is green.
- `npm run test:e2e` is green 3 runs in a row.
- Side-by-side screenshots show the island and Главная matching the references.
- Nothing is committed.
