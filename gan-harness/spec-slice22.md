# Slice 22 — no pay button under 100 ₸, dates, and no creditor confirmation

User's words: «например такие которые мин 100 не нужно отправлять, просто след раз добавить нужно, также добавь даты»
and «бот просить у отправителя это норм но пусть подтверждение уберем».

One migration: `supabase/migrations/0020_slice22_small_dates_noconfirm.sql`. Never edit 0001–0019 (live). Do NOT apply
it remotely; no Supabase MCP tools; PGlite tests only. Every replaced function: copy its LATEST body (grep all
migrations, the highest number wins) and change only what is described here. Keep grants/revokes as they were.

## 1. Purchase post: no button when the debtor's total is under 100 ₸ (Kaspi minimum)
`private.tg_on_purchase()` (latest: 0019): add to the debtor loop
`private.pair_net(new.household_id, s.debtor_id, new.payer_id) >= 100` (pair_net(a,b) > 0 = a owes b, netted,
in-flight excluded). A 50 ₸ share still gets a button if that debtor owes the payer ≥ 100 ₸ in total.
If at least one debtor (≠ payer, amount > 0, not settled, active member) got NO button because of this rule, append
`E'\n\nМеньше 100 ₸ переводить не нужно — добавится к следующему разу.'` to the text sent by the trigger (do not
change `private.tg_purchase_message`). No buttons at all → plain `tg_send` (with the footer if it applies).

## 2. Reminder: what the debt is made of, with dates
```
🔔 Nurdaulet, напоминание: ты должен @yeeerosh 325 ₸
• 10 нояб · Ip Mahanova. G — 75 ₸
• 11 нояб · Вода 20 л + 600 ₸ — 250 ₸
```
Opposite-direction shares (netting) appear as `• 9 нояб · нан — −150 ₸ (его долг тебе)`.
- New `private.tg_pair_lines(p_household uuid, p_debtor uuid, p_creditor uuid) returns text`: lines from
  `private.open_pair_shares(household, debtor, creditor)` joined to purchases (title = description, else merchant, else
  «Покупка»; created_at in Asia/Almaty as «10 нояб» with month abbreviations янв фев мар апр мая июн июл авг сен окт
  нояб дек, same as `formatWhen` in src/lib/server/telegram/digest.ts), ordered by created_at, max 8 then `• и ещё N`.
  Titles via `private.tg_esc`, money via `private.tg_money`. Empty → null. revoke from public, anon, authenticated.
- `public.remind(...)`: append `E'\n' || lines` right after `private.tg_remind_message(...)`. Everything else identical.

## 3. No confirmation by the creditor
Today: debtor marks a transfer → settlement `status = 'marked'` → creditor must «Подтвердить» (→ 'confirmed', shares
settled, group gets «рассчитались») or «Не пришло». New rule: **the debtor's «Да, перевёл» is final.**
- Find every path that creates/updates a settlement to 'marked' for a transfer (mark_settlement, mark_settlement_for,
  paid_prompt_answer, pay_link_answer, tg answer paths… — grep `'marked'` in all migrations). Make the end state
  'confirmed' with exactly what the existing confirm function does (shares settled_at/settlement_id, confirmed_at, the
  `tg_on_settlement` «рассчитались» post fires because status becomes 'confirmed'). Prefer ONE choke point: e.g. have
  the shared internal marking routine call the existing confirm internals right after marking, or a small private
  helper `private.finalize_settlement(id)` reused by all paths. Do not duplicate settle logic.
- Write-offs (`kind` other than transfer) keep their current behaviour.
- Data: existing settlements with `status = 'marked'` and kind transfer are finalized the same way at the end of the
  migration (live there is exactly one: 325 ₸ — the user agreed to drop confirmation).
- Leave the confirm/cancel RPCs in place (old clients), but nothing new reaches 'marked' any more.
- The «И подтверди, что @C перевёл тебе N ₸» line in remind disappears by itself (no marked rows) — keep the code.
- Bot/app texts that promise confirmation must change:
  - ru.ts payLink / paid prompt texts like «Если да, отметим оплату — {name} подтвердит, что деньги пришли.» →
    «Если да — долг закроется.»; «Отмечено ✓ — {name} подтвердит» → «Готово ✓ — долг закрыт»; the 0017-era
    «Ты перешёл в Kaspi. Если перевёл, отметим оплату: …» → «Ты перешёл в Kaspi. Если перевёл — долг закроется.»
  - Telegram texts in webhookHandler (`paidMarked` etc.) → «Готово ✓ — долг перед {name} закрыт».
  - Grep ru.ts and src/lib/server/telegram for «подтверд» and fix every user-facing promise of confirmation.
- App UI: the «Подтверди оплату» incoming section and the «перевёл · ждём подтверждения» state stop appearing
  naturally (no marked rows). Do not delete components; just make sure nothing breaks with zero marked rows and that
  the debtor sees the debt closed right after «Да». Mock repo (src/lib/data/mockRepo.ts / mockPaid.ts) must follow
  the same rule so e2e behaves like prod.

## 4. App: dates on the debt screen
`src/components/app/settle/SettleScreen.tsx` `Side`: each row shows the date before the title in caption style
(`10 нояб · Ip Mahanova. G        75`). Show ALL rows (drop MAX_ITEMS and «и ещё N»).
- Add `created_at: string` to `NetItem` (src/lib/domain/netting.ts), fill it where items are built; update tests.
- `formatDayMonth(iso)` in src/lib/format/ (Asia/Almaty, «10 нояб»; reuse an existing one if present). Unit test.
- Keep the existing look; do not redesign.

## Tests
- `tests/db/slice22.test.ts` (PGlite; follow slice21.test.ts for the Telegram fake):
  1. 50 ₸ share, nothing else owed → no button for that debtor, footer present; others ≥ 100 get buttons.
  2. 50 ₸ share but debtor already owes payer 200 ₸ → button, no footer.
  3. All debtors < 100 → plain send with footer.
  4. remind text: dated lines in order, minus lines for the other direction, «и ещё N» after 8, HTML escaped; pay
     button still there.
  5. Every marking path (each RPC found in §3) ends 'confirmed', shares settled, «рассчитались» post queued once.
  6. Migration finalizes a pre-existing 'marked' transfer.
  7. Write-off behaviour unchanged; anon function count still 13.
- Existing db/unit/e2e tests that expect 'marked' / confirmation flows WILL change — update them to the new rule
  (that is intended), don't delete coverage: turn «creditor confirms» tests into «marking closes the debt» tests.
Run `npx tsc --noEmit`, `npx vitest run`, and the e2e specs touching settle/paid/paylink (run whole spec files).
