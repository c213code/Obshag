# GAN spec: Slice 8, "Polish, offline, forgot password" (lean process)

Read `docs/SDD.md` §5.4 (the no-lag checklist), §11 and `docs/PLAN.md` slice 8, plus `gan-harness/generator-state.md`. **No SQL changes**: 0001–0006 are live and there is no new migration. Do not touch `.env.local`.

## 1. Offline and speed (`public/sw.js`)

Keep the existing push and notificationclick handlers.

**Precache** on install, under a versioned cache name, cleaning up old caches on activate:
- the app shell: the `/offline` page
- the manifest and icons
- static `/_next/static/*` assets referenced by the offline page

**Fetch rules** (same origin only):
- `/_next/static/*`, `/icons/*` and fonts: cache-first. They are immutable.
- Navigations (HTML): network-first with a 4 s timeout, falling back to the cached `/offline` page.
- **NEVER cache** any of these:
  - `/api/*`
  - any request with an `Authorization` header
  - any cross-origin request (Supabase, `kaspi.kz`)
  - RSC payloads (`?_rsc=` or the `RSC: 1` header)
  - any response with `Cache-Control: no-store` or `private`
  - any non-GET request

  This keeps one user's data from ever being served to another person on the same device.

**`/offline` page:** a capsule message «Нет интернета. Покажем, как только связь вернётся», plus a «Повторить» pill.

**Offline banner:** when `navigator.onLine` is false, show a small pill «Офлайн» under the header. Writes keep their existing optimistic rollback and error toasts.

**Prefetch:** use `<Link prefetch>` for the tab routes. Main tabs must feel instant.

## 2. Icon badge

Use `navigator.setAppBadge(n)` when supported, otherwise do nothing. `n` = pending captures + incoming settlements to confirm + people I owe money to. Clear it when `n` is 0. Update it on every data refresh.

## 3. Add to Home Screen prompt

- On iOS Safari, when not in standalone mode and on a page after login, show a dismissible bottom capsule: «Добавь Общак на экран Домой: Поделиться → На экран Домой». It has a share icon and is remembered as dismissed in `localStorage` for 14 days.
- On browsers that support `beforeinstallprompt`, use that instead.

## 4. Empty, error and loading states

- **Empty states** (capsule illustration with a short line and a primary action):
  - Главная, no purchases: «Пока пусто — добавь первую покупку»
  - Покупки
  - Ежемесячно, no bills
  - /settle with nothing to settle (exists already, keep it)
- **Errors:** add global `error.tsx` and `not-found.tsx` in the same design, with «Обновить» and «На главную».
- **Loading:** a `loading.tsx` skeleton per main tab, using the existing Skeleton component.

## 5. Forgot password

- Add a «Забыли пароль?» link under the password field on «Вход».
- `/forgot`: email field, then «Отправить ссылку». It calls Supabase `resetPasswordForEmail(email, { redirectTo: <origin>/reset })`. Always show the same neutral message «Если такая почта есть — мы отправили письмо», whether the account exists or not.
- `/reset`: the user lands here from the email. Exchange the code from the URL:
  - with `@supabase/ssr`, either a `?code=` param through `exchangeCodeForSession`, or a token hash through `verifyOtp({type:'recovery'})`; support both.
  - Then show «Новый пароль» + «Повтори пароль» (minimum 8) and call `updateUser({password})`. On success go to `/`.
- **Mock mode:** `/forgot` succeeds silently, and `/reset?mock=1` lets E2E set a new password for the seeded user.
- **README:** document that this needs working SMTP (a Gmail app password without spaces) and the Supabase URL configuration. Site URL = `https://obshak-gules.vercel.app`, with redirect URL `https://obshak-gules.vercel.app/reset`.

## 6. Device checklist

Write `docs/DEVICE_CHECKLIST.md` in Russian. It is a short checklist for the user to run on a real iPhone:
- install to the Home Screen
- sign up and log in
- create a flat and invite a neighbour
- add a purchase
- settle up with Kaspi
- turn on push and test the Apple Pay Shortcut
- receive a reminder
- add a monthly bill
- go offline and check the offline page

## Tests (lean)

- **Unit:** the SW fetch-rule decision function. Extract it as a pure `shouldCache(request)` and `strategyFor(request)` used by `sw.js`, and test every NEVER-cache case. Also unit-test the badge count.
- **E2E (once):**
  - Offline: with `serviceWorkers: "allow"` in that spec only, load `/`, go offline (`context.setOffline(true)`), navigate, and see the `/offline` page.
  - Forgot → neutral message.
  - The mock reset flow.
  - The Главная empty state.

## Done when

- `npm run verify` is green and `npm run test:e2e` is green once.
- Russian copy goes through `ru.ts`, there is no raw hex outside tokens, and animation uses only transform/opacity.
- Nothing is committed.
