# GAN spec — Slice 15: «Мусор» и «Вода» (event-based duties)
User: «дизайн для мусора и воды» → «Да, делай». Visual truth (1:1): docs/design/DutyTrash.dc.html, docs/design/DutyWater.dc.html (light mockups; tokens so dark works). Read generator-state.md (Slice 14 «Очередь»). 0001–0012 LIVE; new SQL only supabase/migrations/0013_slice15_trash_water.sql; don't apply live; no commit/stash; don't touch .env.local.

## Model
Reuse `duties` (kind 'trash' | 'water', same rotation `duty_members`, admin creates via the existing create flow; Мусор/Вода chips stop showing «скоро»). These duties are EVENT-based, not dated: new table `duty_events(id, duty_id, kind in ('done','ping','empty'), user_id, partner_id null, liters int null, purchase_id null, created_at)`; RLS members select, writes via RPCs.
Current person = the member after the last `done` carrier in rotation order (first member if none); away/inactive skipped. For water done-by-two, the pointer moves past both (after the later one in order).

## Мусор
- `duty_done_event(duty)` «Вынес я» — any member; records done by actor, pointer moves past actor.
- `duty_ping(duty)` «Пакет полный» — any member; records ping; push to current person (+ Telegram group line «🗑 @current, пакет полный» if chat set). Cooldown 2 h per duty.
- Screen: dark green bin card (current, last done by + time), «Кто следующий» chain (сейчас → потом → через 2 → …), «История» (done/ping events, week count).

## Вода (5 L bottles, 4 max, price per liter default 20 ₸ — add `duties.price_per_liter int`, `bottle_liters int default 5`, `bottles_total int default 4`, `bottles_full int`, admin-editable)
- `water_empty(duty)` «Вода кончилась» — any member; push to current + group «💧 Вода кончилась, несёт @current»; cooldown 1 h; sets bottles_full = 0.
- `water_brought(duty, p_partner uuid null)` «Принёс»: alone → 2 bottles (10 L), with partner → 4 bottles (20 L); amount = liters × price_per_liter; creates a SHARED purchase (payer = actor, description «Вода 20 л», equal split among default participants via existing helpers so netting / Telegram purchase post / min-100 rules apply); records done event with partner & purchase_id; sets bottles_full = 2 or 4; pointer moves past actor (and partner).
- `water_bottle_used(duty)` decrement (−1 full bottle, floor 0) — small control on the card.
- Screen: navy card with 4 bottle glyphs filled per bottles_full, «Осталось N из 4 · 5 л», «Следующий несёт», buttons; «Кто идёт» two tiles (Один · 2 бутылки · 10 л · 200 ₸ / Вдвоём · 4 бутылки · 20 л · 400 ₸ + partner picker), hint «запишет общей покупкой: по N ₸ каждому»; widgets «За месяц» (liters, ₸, weekly bars) and «Кто сколько ходил».

## Rules / security
All RPCs security definer, search_path='', auth.uid(), members only, lock duty row first. Notices server-side like slice 14 (push endpoints never reach the browser). Anon surface unchanged (9). Morning cron unchanged.

## Tests
PGlite: pointer math (incl. away skip, two-person water), ping/empty cooldowns, water_brought amount/shares, admin-only settings, anon surface. Unit: view models. E2E: create Мусор → «Вынес я» moves queue; Вода → «Принёс» вдвоём creates 400 ₸ purchase in Покупки. verify green, touched e2e green, screenshots vs mockups in gan-harness/screenshots/duty15-*.png. Append «Slice 15».
