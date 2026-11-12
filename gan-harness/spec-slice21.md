# Slice 21 — «💸 Перевести» buttons under the group purchase post

## Problem
The group post «🛒 Ip Mahanova. G — 450 ₸ / Платил: @Nurbol1 / Должны: …» has no button. Debtors must open the app to
pay. The reminder already has a «💸 Перевести N ₸» url button (slice 19, `public.remind` in 0017) that opens
`/k/<code>`: copies the number, opens Kaspi, then asks «Ты оплатил?». Reuse exactly that under the purchase post.

## Target
```
🛒 Ip Mahanova. G — 450 ₸
Платил: @Nurbol1
Должны:
@yeeerosh — 113 ₸
Nurdaulet — 112 ₸
@Parasatttt — 113 ₸
[💸 Ерасыл → перевести]
[💸 Nurdaulet → перевести]
[💸 Парасат → перевести]
```
One url button per row, one per debtor, in the same order as the «Должны» lines (`order by s.debtor_id`).
Button text: `'💸 ' || <debtor display_name> || ' → перевести'` (plain text — buttons are not HTML; no amount on the
button, because /k shows the real netted amount which may differ from the share). Trim display_name to 30 chars.

## A. Database — `supabase/migrations/0019_slice21_purchase_paybuttons.sql`
Never edit 0001–0018 (live). New migration only. Do NOT apply it remotely; no Supabase MCP tools. PGlite tests only.
- `create or replace function private.tg_on_purchase()` — copy the LIVE body (0007 is the only definition; verify with
  grep that no later migration replaced it) and change only the send:
  - debtors = shares of this purchase with `debtor_id <> payer_id`, `amount > 0`, `settled_at is null`, and the debtor
    is an active member of the household.
  - For each debtor insert a `public.pay_links (code, household_id, from_user = debtor, to_user = payer)` with the
    same code generator as `remind` in 0017 (`translate(encode(extensions.gen_random_bytes(9),'base64'),'+/','-_')`).
  - Send with `private.tg_send_markup(v_chat, private.tg_purchase_message(new.id), {"inline_keyboard": [[btn], [btn], …]})`,
    url = `private.app_url() || '/k/' || code`.
  - No debtors → plain `private.tg_send` as before.
  - Any error in the links/markup path → fall back to plain `private.tg_send(v_chat, message)` (like remind does), and the
    outer `exception when others then null` stays: Telegram never breaks the user's transaction.
  - Keep the `telegram_sent` dedupe exactly as is. Keep the trigger itself (do not drop/recreate it unless needed; check
    how it is declared in 0007 — if it is a deferred constraint trigger, shares are visible at fire time).
  - Keep `revoke all … from public, anon, authenticated` like 0007.
- Bills (🏠 posts) go through the same trigger — they get the buttons too. That's intended.
- Anon surface stays 13 functions.

## B. App
Nothing should need changing: `/k/<code>` already handles a link (pay / paid / small / expired). Verify by reading
`src/components/paylink/PayLinkScreen.tsx` and `src/lib/server/payLinkHandler.ts` that a link created this way works
(from_user = debtor, to_user = payer). If the pair is already netted out / nothing owed, the page shows its existing
«paid»/«small» state — fine.

## C. Tests — `tests/db/slice21.test.ts` (PGlite, follow tests/db/slice19.test.ts / slice20.test.ts for the net/vault fake)
1. Shared purchase with 3 debtors + Telegram chat → one sendMessage whose body has `reply_markup.inline_keyboard` with
   3 rows, each one url button `…/k/<code>`; 3 pay_links rows (debtor → payer); text unchanged vs `tg_purchase_message`.
2. Button order matches the «Должны» order; texts are `💸 <name> → перевести`.
3. Payer-only purchase (no debtors) → plain send without reply_markup.
4. Zero-amount share (orders case) and an inactive member get no button.
5. Pending → shared (resolve) posts once with buttons; a second update does not post again (dedupe).
6. A failure in link creation falls back to a plain message and the purchase insert still succeeds.
7. A pay link created here works with `public.pay_link_open(secret, code, false)` (returns the pay state for the pair).
8. anon function count still 13.
Run: `npx tsc --noEmit`, `npx vitest run` (all). No e2e needed (no app change).
