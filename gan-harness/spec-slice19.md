# Slice 19 — «Перевод в пути» + «💸 Перевести» в напоминании

User's words (verbatim, Russian):
- «Перевод «в пути» считается оплаченным … Можно сделать это, но давай сделаем так, типа, если человек перешел и по ссылке, на Каспи … пусть подпишет табличку «Ты оплатил, ты перешел по ссылке, ты оплатил нурболу столько и столько».»
- «Пусть бот потом отправляет как кнопку … или ссылку, но не длинную … сразу на переводы к на Каспи … и потом … смотреть, что он перешел, не перешел, и поэтому пишет ему в личку, типа оплатил, не оплатил».

Live bug that motivates part A (prod data, 2026-11-11): Nurbol marked a 150 ₸ transfer to Nurdaulet («нан», settlement status 'marked', not confirmed). Later Nurdaulet owes Nurbol 450 ₸ («Ролтон»). Every calculation still counts Nurbol's 150 as open, so the pair net is 450 − 150 = 300 and the reminder says 300. Correct: 450.

## Part A — a marked (unconfirmed) transfer counts as paid for netting

Rule: a share that is recorded in `public.settlement_shares` of a settlement with `status = 'marked'` is "in flight". In-flight shares are NOT open debts for any netting/balance/reminder calculation. The DB rows are not changed (settled_at stays null until the creditor confirms). When the creditor confirms → shares become settled as today. When the creditor rejects («Не получил», whatever the existing reject path sets the status to) → the shares are open again automatically (they are no longer covered by a 'marked' settlement).

DB (new migration `supabase/migrations/0017_slice19_inflight_paylinks.sql`; NEVER edit 0001–0016, they are live):
- `create or replace function private.open_pair_shares(...)`: same signature/return, add
  `and not exists (select 1 from public.settlement_shares ss join public.settlements st on st.id = ss.settlement_id where st.status = 'marked' and ss.purchase_id = s.purchase_id and ss.debtor_id = s.debtor_id)`.
  `private.record_settlement_shares` deletes its own rows BEFORE selecting open_pair_shares, so a re-mark still re-records its own shares — keep that order and add a db test proving re-mark works.
  `pair_net`, `remind`, the daily reminder job, `mark_settlement_for`, `paid_prompt_answer` all go through it — verify each still behaves (db tests).
- Check any other SQL that sums open shares without open_pair_shares (grep `settled_at is null` in migrations: e.g. delete/edit guards, `private.purchase_json`, home/summary RPCs, 0006 line ~294 member removal check) and decide per site; netting-type sums must use the in-flight rule, guards about "has anything been paid" must treat in-flight as paid (they likely already check settlement_id / settlement_shares — verify).
- Reminder text: `public.remind` (latest body in 0011) — when posting the group message for debtor D from creditor C, if there are 'marked' settlements from C to D (C paid D, D hasn't confirmed), append a line: `\nИ подтверди, что <tag C> перевёл тебе <money> ₸` (sum of those settlements' amounts; use private.tg_tag / tg_money). Keep remind's signature and return shape.

App (TypeScript):
- One helper in `src/lib/domain/netting.ts` (or a new `inFlight.ts`): given shares + settlements, return the shares with in-flight ones excluded from netting (e.g. mark them as settled for calculation only). Apply it everywhere the client nets: `settleData.ts` (net, pairWith, incoming/outgoing unchanged), `AppDataProvider.tsx` optimistic mark/remind (~lines 555–645; a re-mark of MY existing pending settlement must still include its own covered shares — mirror the SQL), `domain/balance.ts`/`summary.ts` callers (home cards, PurchaseCard, PurchasesScreen, PurchaseDetailScreen), and `mockRepo.ts`/`mockPaid.ts` so mock mode matches the DB.
- The purchase detail «Кто скинул» row for an in-flight share should read like a sent payment awaiting confirmation (check what it shows today when settlement_id is set and settled_at null; keep it if already right).
- Settle screen (/settle/[id]) for the sender while their transfer is pending: the pair net no longer contains it; the existing «ждём подтверждения» UI for outgoing must still show. Make sure no screen shows a negative or doubled amount.

## Part B — «💸 Перевести N ₸» button under the group reminder → short page → Kaspi → «Ты оплатил?»

DB (same migration 0017):
- `public.pay_links(code text primary key, household_id uuid, from_user uuid /*debtor*/, to_user uuid /*creditor*/, created_at timestamptz default now(), expires_at timestamptz default now() + interval '7 days', opened_at timestamptz)`; FKs like other tables (household + members composite FKs); RLS enabled with NO policies (server-only via security definer). Code: url-safe random, ~10–12 chars (e.g. from `extensions.gen_random_bytes`, base64url without padding).
- `private.app_url()` returns `'https://obshak-gules.vercel.app'` (immutable sql function).
- `private.tg_send_markup(p_chat bigint, p_text text, p_markup jsonb)`: copy of private.tg_send (0007) adding `'reply_markup', p_markup` to the body. Revoke from public/anon/authenticated.
- `public.remind`: create a pay_link for (debtor, creditor) and post via tg_send_markup with `{"inline_keyboard":[[{"text":"💸 Перевести <money>","url": app_url || '/k/' || code}]]}`. Telegram errors must never break the reminder (keep the begin/exception block).
- `public.pay_link_open(p_secret text, p_code text, p_open boolean) returns jsonb` — anon, gated by `private.server_secret_ok`. Unknown/expired code → `{state:'expired'}`. Otherwise compute live `v_net := private.pair_net(hh, debtor, creditor)` (after lock_pair when p_open). States: `'paid'` (net <= 0, or there is already a 'marked' settlement debtor→creditor covering it), `'small'` (0 < net < min_transfer), `'pay'`. Return `{state, to_name, to_phone (profiles.kaspi_phone), amount: net, from_name, prompt_id}`. When `p_open` and state='pay': set `opened_at = now()` and create/refresh a paid prompt exactly like `public.open_paid_prompt` does for the debtor (factor the body into a private helper taking the user id, do not duplicate logic loosely) and return its id as prompt_id.
- `public.pay_link_answer(p_secret text, p_code text, p_prompt uuid, p_yes boolean) returns jsonb` — anon, secret-gated; checks the prompt belongs to the link's debtor→creditor pair, then returns `private.paid_prompt_answer(debtor, p_prompt, p_yes)`.
- `public.paid_prompt_notice(secret, prompt)` must be callable from the anon server client too (it is secret-gated): grant it to anon, or add an anon wrapper. Document the new anon surface count in the migration header (was 10).
- Security: the link is a bearer token shared in the roommates' group; that's accepted (the creditor still confirms every transfer). Never return data for other pairs; never accept household/user ids from the client.

App:
- Page `src/app/k/[code]/page.tsx` (public — make sure `src/proxy.ts` / auth redirect does not send it to /login; no app shell, no bottom nav). Server-side it calls `pay_link_open(secret, code, false)` (view only, so link previews don't count as opens). Night & Lime design, same tokens/components as the app (look at SettleScreen's Kaspi bar + Pay.dc.html in docs/design for reference): avatar + «Перевести <имя dative>», big amount (Money), Kaspi phone, one lime button «Скопировать номер и открыть Kaspi». States: paid → «Уже оплачено ✓», small → «Меньше 100 ₸ — добавится к следующему расчёту», expired → «Ссылка устарела», each with a small «Открыть Общак» link to `/`.
- Button handler (inside the click, for iOS clipboard user-activation): copy phone via the existing clipboard helper (`@/lib/clipboard`), POST `/api/k/<code>/open`, then `location.href = KASPI_TRANSFERS_URL`. Do not await the POST before navigating if that breaks the gesture — fire it with `keepalive: true`.
- Route `src/app/api/k/[code]/open/route.ts` (POST, nodejs, `maxDuration = 170` literal): calls pay_link_open(…, true); on state 'pay' schedule `askLater(prompt_id, deps)` via `after()` reusing `src/lib/server/paidHandler.ts` (anon/server repo + Telegram + push deps; mock mode = no wait / no telegram like getPaidDeps). Returns `{state, prompt_id}`.
- «Табличка» on return: when the page becomes visible again after the button (visibilitychange) or on reload with a prompt pending, show a sheet like `PaidPromptSheet`: «Ты перешёл в Kaspi. Ты оплатил <имя dative> <amount>?» with «Да, перевёл» / «Ещё нет». Answers POST `/api/k/<code>/answer` {prompt_id, yes} → pay_link_answer. Result 'marked' → page shows «Отмечено ✓ — <имя> подтвердит»; 'no' → close sheet; 'already'/'stale'/'expired' → matching short text. Reuse PaidPromptSheet visuals.
- The bot DM fallback (~150 s) is the existing slice 17 flow (pp:y/pp:n callbacks) — nothing new in the webhook.
- Repo: add methods to `Repo` (supabaseRepo + mockRepo with an in-memory pay_links table) as the other server-secret RPCs do (see tgAnswerPaid / paidPromptNotice for the pattern). Mock `remind` creates a link too so e2e can find the code in the mock store.

## Tests (lighter checks — no full suite)
- `tests/db/slice19.test.ts` (PGlite, migrations 0001–0017): the live 450/150 case → pair_net = 450 for the debtor; reject → back to 300; confirm → stays settled; re-mark of an existing pending settlement re-records its own shares; remind message contains the «И подтверди» line and builds a pay_link; pay_link_open states (pay / small / paid / expired / wrong secret → unauthorized) and that p_open creates exactly one pending prompt; pay_link_answer yes → settlement marked, wrong prompt → refused.
- Unit tests for the in-flight netting helper.
- `tests/e2e/slice19.spec.ts` (mock mode, WebKit iPhone, like slice17/slice52): Aidos owes, a pending transfer in the opposite direction no longer reduces his amount; open `/k/<code>` (code read from the mock store after a remind) → button → (Kaspi navigation can be intercepted/routed) → return → sheet → «Да, перевёл» → «Отмечено ✓». Screenshots to gan-harness/screenshots/s19-*.png.
- Re-run existing e2e that touch settling: slice3, slice13, slice17, slice18, slice52 and db tests slice3/slice13/slice17/slice18. `npm run typecheck`, `npm run lint`.

## Hard rules
- Do NOT apply any migration to the live Supabase project, do NOT touch `.env*`, do NOT commit or push, no service-role key. Do not edit migrations 0001–0016.
- Russian UI copy; follow existing i18n in `src/lib/i18n/ru.ts` (declension helper for dative names).
- AGENTS.md: this Next.js version differs from training data — read `node_modules/next/dist/docs/` for route handlers, `after()`, dynamic params, page config before writing them.

## Part C — debtors can't find where to pay (home screen)

User (verbatim): «Они говорят, что они не могут найти кнопку оплатить, которая переходит на Каспи.» Today a debtor's home shows only a grey caption «ты должен 325 ₸» inside the «Тебе должны 0 ₸» tile (src/components/app/home/Bento.tsx, OwedTile); the only way to pay is tapping that tile → /settle. Approved mockup:
1. OwedTile flips for a net debtor: when my total owe ≥ 100 ₸ and owe > owed, the tile reads «Ты должен» / big amount / caption «тебе должны N ₸» and has a full-width lime `Pill` «Оплатить» → `/settle` (or straight to `/settle/<id>` when I owe exactly one person — SettleListScreen already redirects in that case, reuse it). Creditor view unchanged («Тебе должны» + «Напомнить»).
2. New home section «К оплате», placed right under the Bento grid (above the duty card), one row per person I owe net ≥ 100 ₸ (from useSettleData counterparties with direction 'i_pay', excluding pairs where I already have a pending outgoing settlement — those show in the existing WaitingSection). Row = pill row like WaitingSection's (avatar 40, name, caption «<amount> · <up to 2 purchase descriptions>»), trailing lime `Pill size="row"` «Перевести» → `/settle/<userId>`. Hidden when empty. Use the same enter/leave presence animation as WaitingSection.
3. The settle screen's Kaspi bar already copies the number + opens Kaspi + asks «Ты перевёл?» (slice 17) — do not change it.
Copy goes into ru.ts (`ru.main.bento.youOwe`, `ru.main.bento.pay`, `ru.main.toPay.title`, `ru.main.toPay.transfer`). Night & Lime tokens only; look at docs/design (Home.dc.html) for spacing.
E2E (in slice19.spec.ts): as Aidos with debt → home shows «Ты должен», «Оплатить», a «К оплате» row «Перевести» → lands on /settle/<Ерасыл id> with the Kaspi bar. Screenshot s19-home-debtor.png.
