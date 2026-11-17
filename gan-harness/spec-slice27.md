# Slice 27 — simplify: one number on home, fewer buttons and texts

User: «система стала сложной и нам самим уже начало быть сложно всё считать, нужно упростить». Picked:
«Убрать лишние кнопки и тексты» + «Одна цифра на главной». Netting rules, settle screens, the pay flow (/k page, «Ты
перевёл?»), duty, away, Apple Pay stay as they are — this slice only REMOVES noise and merges the money summary.

## A. Home: one number
Today the home shows a hero «Баланс +614 ₸» AND a tile «Тебе должны 555 ₸ / ты должен 0 ₸ / копится 59 ₸ / Напомнить»
(src/components/app/home/HomeScreen.tsx, Bento.tsx, householdCards.ts, ToPaySection.tsx). Three different numbers for
one question. New:
- Payable pairs only: a pair counts when its net is ≥ the Kaspi minimum (100 ₸; there is a constant already — grep).
  Smaller nets are simply not shown anywhere on home (no «копится» text).
- Hero card (keep its look/illustration; replace the «Баланс» label + big number):
  - I owe anyone ≥100 → label «Ты должен», big number = sum of what I owe (payable pairs), lime «Оплатить» pill →
    the «К оплате» section (or /settle/<id> when only one pair — reuse the existing link logic).
  - else they owe me → label «Тебе должны», big number = sum owed to me (payable pairs), secondary «Напомнить» link
    (existing remind entry).
  - else → «Всё ровно» with a ✓, no number.
  - The avatars row and the month label stay.
- Remove the separate «Тебе должны / ты должен / копится / Напомнить» tile from the bento. Re-flow the remaining
  bento tiles (Траты, Ежемесячно) so the grid has no hole — use the existing tile sizes, no new design.
- «К оплате» section stays as THE one place to pay (rows «Перевести» per creditor) — list only payable pairs.

## B. Remove extra buttons / texts
1. Telegram purchase post: no per-debtor «💸 <имя> → перевести» buttons and no «Меньше 100 ₸ переводить не нужно…»
   footer. `private.tg_on_purchase()` back to a plain `private.tg_send(v_chat, private.tg_purchase_message(new.id))`
   (keep the telegram_sent dedupe and the exception guards). New migration
   `supabase/migrations/0025_slice27_simplify.sql`; copy the latest definition (0020) and strip the links part.
   Existing pay_links stay valid (old buttons keep working).
2. Telegram reminder: no dated «• 10 нояб · …» lines. `public.remind` (latest 0020): drop the `tg_pair_lines` append
   (keep the function itself, unused). Keep the single «💸 Перевести N ₸» button and everything else.
3. Purchase detail screen: remove the «Оплатить {имя} N ₸» pill and its netting caption / netted note
   (PurchaseDetailScreen.tsx). Paying happens from home «К оплате» / the reminder button. Remove the «перевёл · ждём
   подтверждения» state there too if it is dead code after slice 22 (no new 'marked' settlements exist).
4. Remove the «копится N ₸» texts anywhere in the app UI (home, settle list) — small pairs are just not listed on home;
   on the settle list keep the pair but without the «копится» wording (show the amount muted).
5. ru.ts: delete strings that become unused; don't leave dead keys.

## Rules
Never edit 0001–0024 (live). Do NOT apply remotely; no Supabase MCP tools; PGlite tests only. Copy LATEST function
definitions, change only what is described, keep grants. Follow the existing design tokens/components; no new design.

## Tests
- Unit tests for the home selectors (owe-first, then owed, then «Всё ровно»; pairs < 100 ignored).
- `tests/db/slice27.test.ts` (PGlite): purchase post has no reply_markup and no footer; remind text has no «•» lines
  and still has the pay button; anon count 13. Adjust slice 21/22 db tests only if they load later migrations.
- Update e2e that asserted the removed UI. New e2e screenshots of home in three states: `s27-home-owe.png`,
  `s27-home-owed.png`, `s27-home-even.png` in gan-harness/screenshots.
Run `npx tsc --noEmit`, `npx vitest run`, and home/settle/purchase e2e (whole files, `--workers=1`) IF WebKit is
installed (`~/Library/Caches/ms-playwright/webkit-*` matching the installed Playwright); if it is not, say so — do NOT
download it.
