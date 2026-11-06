# Slice 1: fix list for iteration 2

Sources:
- the evaluator (`gan-harness/feedback/feedback-s1-001.md`, 8.0 PASS)
- the code reviewer (verdict BLOCK, 4 HIGH)
- the security reviewer (no CRITICAL/HIGH, 3 MEDIUM)

Fix everything in sections A–C. Section D is optional if time allows.

Neither migration has been applied to a live database yet, so edit `0001` and `0002` in place.

## A. Code review: HIGH (blocking)

**A1. Duplicate purchase on retry.**
- Problem: `createPurchase` treats a failure of the follow-up select as a failure of the whole purchase. A purchase that was actually saved gets rolled back on screen, and a retry then creates a duplicate.
- Fix: only an RPC failure counts as failure. Better still, make the RPC return the full purchase row with its shares (as jsonb or a setof), so the create needs one round trip.
- Files: `src/lib/data/supabaseRepo.ts:157-172`, `AppDataProvider.tsx:135-141`.

**A2. A load or refresh races the optimistic rows.**
- Problem: a load that started before the insert can finish after it and overwrite the optimistic row.
- Fix:
  - Give each load a monotonically increasing token and ignore superseded results.
  - Re-merge in-flight optimistic rows into every snapshot.
  - In the `.then`, if the optimistic row is gone, insert the real row (de-duplicated by id).

**A3. Two rows show up when the optimistic row becomes the real one.**
- Problem: the React key changes from the optimistic id to the real id, so both rows render at once.
- Fix: give each row a stable `clientKey` and keep it when the real row replaces the optimistic one.
- Test: add an e2e assertion `toHaveCount(1)` for the new row.

**A4. Cache headers dropped on session refresh.**
- Problem: `@supabase/ssr` passes cache headers as the second argument to `setAll(cookies, headers)`, and our code drops them. A CDN could then cache a response that contains `Set-Cookie`.
- Fix: copy those headers onto both the normal response and the redirect response, in `src/lib/supabase/proxy.ts` and in `server.ts`.
- Also wrap `getClaims()` in try/catch, so a Supabase outage doesn't turn every page into a 500.

## B. Security: MEDIUM and LOW

**M1. Join rate limit can be beaten with concurrent calls.** In `join_household`, call `perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));` before counting attempts.

**M2. Rejoining restores an old admin role.**
- On reactivation, set `active = true, role = 'member', away_until = null`, with `where not members.active`.
- Add a test: a former admin rejoins and gets `member`.

**M3. Direct inserts bypass the purchase RPC.**
- `revoke insert on public.purchases from authenticated`. Inserts go through the RPC only. Bills will later use their own RPC.
- Add checks `char_length(description) between 1 and 200`, `merchant <= 120` and `amount <= 10000000`.
- Remove `status` from the update grant: status changes will go through an RPC in slice 4.
- Add tests for each of these.

**L1. Input bounds.**
- `join_household`: a code longer than 64 characters returns null after the attempt has been recorded.
- `create_purchase`: more than 50 participants is rejected.

**L2. Malformed deep link.** `/join/[code]`: wrap `decodeURIComponent` in try/catch. Code review item 6 is the same issue.

**L3. Proxy matcher.**
- Anchor the exclusions, for example `kit(?:/|$)`.
- Exclude static files by extension: `.*\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|json|webmanifest)$`. Code review item 5 is the same issue.

**L4. Error messages.** `mapDbError` uses fixed strings for messages. Raw database errors go to a debug log only.

**Mock-store hardening.** The route also requires the server-only env `E2E_ALLOW_MOCK_STORE=1`, and refuses to run when `NEXT_PUBLIC_SUPABASE_URL` is set.

## C. Evaluator and code review: MEDIUM, plus design

**C1. Stale member list.**
- Problem: a member who joins while you have the app open doesn't appear in "На кого" until you reload.
- Fix: refetch members when entering `/purchases/new`, and when the window regains focus or becomes visible again.
- Disable ✓ when nobody is selected as a debtor. Show the inline message "Выбери, с кем делить".
- Show the message "Максимум 10 000 000 ₸" when the amount is over the limit.

**C2. Disabled look.**
- Disabled lime pills (Рассчитаться, Дальше) use a flat lime at about 35% opacity with on-lime text, not a muddy olive gradient.
- Other disabled controls (Свои суммы, other payers) look clearly disabled: muted text plus a lower-opacity "скоро" hint.
- "Выйти" must not look disabled.

**C3. Design parity with `docs/design/Main.dc.html`:**
- The action row height matches the mockup. Put "скоро" as a tiny badge so it doesn't add height, or drop it and rely on the disabled look.
- With only one household, still show the decorative peek layers behind the card, as in the mockup.
- Hide the "N из M" chip when M is 0.
- Bell dot: show it only when there are unread items. For slice 1 that means hide it, but keep the slot.
- Invite code: show it formatted in groups, for example `7KQ2-9PXA-4M1C`, on one line.
- The household "У меня есть код" option uses a key or ticket icon, not a check.
- The verify hint "000000" must not wrap.
- In the Fab menu, "Ежемесячный платёж" is shown disabled with "скоро" until slice 6.

**C4. Zero shares.** Reject an amount smaller than the number of participants, in both the form and the schema, and keep `splitEqual` and the SQL in sync. This gives a message like "Сумма меньше числа людей". Alternatively, skip 0 ₸ shares in both places; choose rejection.

**C5. Stale pending join.**
- Clear `pendingJoin` on `signOut`, and when the user already has a household.
- Only redirect when the guard stage allows it.

**C6. Mock store lost updates.**
- Serialize `tx` per repo with a promise chain.
- The route uses a version check and returns 409 on conflict; the client retries.
- Persist mock data as `{version, db}`, validated with zod, and reseed on a mismatch.
- Wrap `localStorage` access in try/catch.

**C7. Performance.**
- Run `getMe` and `listHouseholds` in parallel.
- Split `AppDataProvider` into three contexts: actions (stable), data, and notice.
- Wrap `PurchaseCard` in `memo` and pass a `Map` for payer names.
- Add `.order` tie-breakers.

**C8. Sign out.** `signOut` handles errors with a try/catch, shows a notice, and resets `leaving` in `finally`.

**C9. Test gaps.**
- The fake Supabase client records and asserts the `select`, `eq` and `order` arguments.
- Each e2e test cleans up its contexts with try/finally.
- E2E covers: stale members (the join happens while the app is open, then the new member appears in "На кого" without a reload), no duplicate rows, and a disabled ✓ when there is no debtor.

## D. LOW (optional)

- `RepoProvider` uses a lazy `useState` instead of `useMemo` with side effects, and logs errors.
- Fix the avatar color comment, or align the SQL and JS algorithms.
- Move "Ты" into `ru.ts`, and use a fallback name for a payer who has left.
- `crypto.randomUUID` gets a fallback.
- Memoize the email parse on the verify screen.
- Clear the `FlatScreen` timeout on unmount.
