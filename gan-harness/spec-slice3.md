# GAN spec: Slice 3 "Netting and settlement" for Общак

Read first:
- `docs/SDD.md` §5.3 (screen 4), §5.4 (netting motion), §6.4 (paying and confirming), §7 (netting rule), §8–§9.
- `docs/PLAN.md` "Slice 3".
- `gan-harness/generator-state.md`, slice 0 and slice 1 sections. Reuse the UI kit, `AppDataProvider`, the repos and the `netPair` domain function.

**Visual and motion source of truth.** Match these 1:1 and compare screenshots side by side:
- `docs/design/Pay.dc.html`: the Расчёт screen layout.
- `docs/design/motion-reference.html`:
  - #3 netting: the lime arrow slides onto the orange arrow and dissolves, and the amount counts down to the net.
  - #4 Получил: the button shrinks into a ✓ and the progress fills.
- `docs/design/Main.dc.html`: the Долги card and the "Рассчитаться" button.

The user rejects any drift from these designs.

**Live database.** `0001` and `0002` are now applied to the user's live Supabase project. **Never edit them.** Put all schema changes in a new `supabase/migrations/0003_slice3_settlements.sql`, and keep the PGlite tests applying 0001, 0002 and 0003 in order.

## Goal (mock mode fully, Supabase-ready)

1. **The Главная "Рассчитаться" button and the "Расчёт" quick action are enabled.** They open `/settle`, the list of people you have a non-zero net with.
   - Each row is a pill row: avatar, name, "ты должен N ₸" in orange or "тебе должен N ₸" in lime, and a chevron.
   - With only one counterparty, go straight to `/settle/[userId]`.
   - With nothing to settle, show the empty state «Все в расчёте».
2. **`/settle/[userId]`, exactly per `Pay.dc.html`:**
   - A capsule header "Расчёт с <Имя>".
   - Two avatars with opposite arrows: you → them in orange `owes(me→them)`, and them → you in lime `owes(them→me)`.
   - The equation pill `A − B = net ₸`, with the caption «Один перевод вместо двух».
   - Two columns listing the open shares behind each side: description and amount. Show the top 3 per side plus «и ещё N».
   - The other person's Kaspi number, masked like the mockup, with a «скопирован» chip after copying.
   - A floating bottom bar, depending on the direction:
     - **I owe them:** an «Я оплатил» on-pill, plus a lime «Перевести N ₸ ↗» pill. It copies the creditor's `kaspi_phone` to the clipboard (`navigator.clipboard.writeText` with a fallback) and opens `https://kaspi.kz/transfers` in a new tab or window. That URL was verified on iPhone to open the Kaspi app on the Transfers screen; do not add query params.
     - **They owe me:** «Напомнить» (disabled, «скоро», slice 5), plus the incoming-settlement state described below.
   - **Netting animation.** When the screen opens, play reference #3 once: the lime arrow merges into the orange one, and the amount counts from the larger side down to the net. Respect reduced motion: show the final state with a fade only.
3. **«Я оплатил»** creates a settlement `marked` from me to them for exactly the current net.
   - The screen then shows «Ждём подтверждения от <Имя>», and the button turns into a «Отменить» ghost pill that cancels the marked settlement.
   - Only one marked settlement can be open per pair and direction. A second tap is idempotent.
4. **The creditor sees the incoming marked settlement:**
   - On Главная, as a pill row in a «Подтверди оплату» section above Последние покупки: avatar, «<Имя> отметил оплату N ₸», and a lime «Получил» button.
   - On `/settle/[userId]` too.
   - «Получил» plays reference #4: the button shrinks to a ✓ and the progress fills.
   - It then confirms the settlement. All open shares between the pair, in both directions, that existed when the settlement was marked get `settled_at = now()` and `settlement_id`.
   - Balances update: the pair goes to 0 and Главная's Долги card and card stack update.
5. **Purchase rows on Главная** show the "N из M скинули" progress correctly after confirmation.

## Domain (TDD, pure, `src/lib/domain/netting.ts`)

- **`netPair(me, other, shares, purchases)`** returns `{ iOwe, theyOwe, net, direction: 'i_pay' | 'they_pay' | 'even', myItems, theirItems }`. Count only open shares of shared purchases.
- **`netForUser(me, ...)`** returns the list of counterparties with a non-zero net, plus the total. Главная's balance uses this from now on, and it must stay consistent with the slice 1 summary.
- **`coveredShares(settlement, shares)`** selects the open shares between the pair that were created at or before `marked_at`.

**Test cases:**
- 2000 vs 1800 → I pay 200.
- Zero net.
- The reverse direction.
- Several purchases mixed with settled shares.
- A share created after the mark is not covered.
- Personal purchases are ignored.

## Backend: `0003_slice3_settlements.sql`

All functions are `security definer` with `search_path = ''`, take the actor from `auth.uid()`, and run in a single transaction with row locks.

**`mark_settlement(p_household_id uuid, p_to uuid)`:**
- The actor is the debtor. Compute the net server-side from open shares. Never accept an amount from the client.
- Raise an error if the actor doesn't owe `p_to` (net ≤ 0).
- Lock the pair with `pg_advisory_xact_lock` on the household and the ordered pair.
- If a marked settlement for the same pair and direction already exists, return it (idempotent).
- Otherwise insert `settlements(status='marked', amount=net, from_id=actor, to_id=p_to)` and return the row.

**`confirm_settlement(p_settlement_id uuid)`:**
- Only `to_id = auth.uid()` may confirm, and only while the status is `marked`. Confirming twice is a no-op that returns the row.
- Lock the settlement row `FOR UPDATE`.
- Recompute the current net. If it has changed since the mark because new shares appeared, still close only the shares that existed at `marked_at` (`coveredShares` semantics).
- Set `settled_at` and `settlement_id` on all open shares between the pair, in both directions, with `created_at` (of their purchase) ≤ `marked_at`.
- Set `status = 'confirmed'` and `confirmed_at = now()`.

**`cancel_settlement(p_settlement_id uuid)`:** the debtor (`from_id`) or the creditor (`to_id`) can cancel while the status is `marked`.

**Grants and access:**
- Revoke everything from public and anon, and grant execute to authenticated only.
- Clients still cannot write `settlements` or `shares` directly.

**PGlite tests (`tests/db/slice3.test.ts`):**
- A non-debtor cannot mark.
- The amount comes from the server.
- Marking is idempotent.
- A non-creditor cannot confirm.
- A double confirm is a no-op.
- The pair's balance is 0 after confirm.
- A share created after the mark stays open.
- Cancel permissions.
- Concurrent mark → one row. Simulate the lock order; real concurrency can't run in PGlite, so assert that the lock is called.
- Members of another household can't touch it.

## Repos

- Extend `Repo` with `listSettlements`, `markSettlement`, `confirmSettlement` and `cancelSettlement`.
- The mock repo mirrors the SQL semantics exactly, with the same error codes mapped to the same `RepoError`s.
- `supabaseRepo` calls the RPCs. The fake-client tests assert the arguments.
- Optimistic UI uses the stable `clientKey` approach from slice 1.
- Refresh on focus, as in slice 1.

## E2E (`tests/e2e/slice3.spec.ts`, two browser contexts, mock E2E store)

1. User A pays 4000 split between A and B, so B owes A 2000. User B pays 3600 split between A and B, so A owes B 1800.
2. B opens Расчёт and sees the arrows 2 000 and 1 800, and the equation "2 000 − 1 800 = 200 ₸".
   - The netting animation ends at exactly "200 ₸".
   - «Перевести 200 ₸» copies A's Kaspi phone to the clipboard (grant clipboard permissions) and opens kaspi.kz/transfers. Assert the popup URL.
3. B taps «Я оплатил». The screen shows «Ждём подтверждения». A sees «Подтверди оплату» on Главная.
4. A taps «Получил». The ✓ animation plays. Both see «Все в расчёте» and the Главная balances are 0.
5. Cancel flow: B marks, then cancels. A sees nothing to confirm.
6. Reduced-motion variant: the final state is shown without counting.
7. Screenshots go to `gan-harness/screenshots/s3-*`, compared with `Pay.dc.html` and motion references #3 and #4.

## Non-goals

Push notifications (slice 4), reminders (slice 5), multi-party simplification, and automatic Kaspi verification.

## Definition of done

- `npm run verify` and `npm run test:e2e` are green, all slice 0 and slice 1 tests included.
- Coverage on `src/lib/**` is ≥ 80%.
- The screens match the references.
- No raw hex outside the tokens. Only transform/opacity animations. Copy goes through `ru.ts`.
- Do not git commit.
