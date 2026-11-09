# GAN spec: Slice 11, "Swipe left to delete" (lean process)

**User request (verbatim):** «добавь для админа функ с свайпа на лево можно было удалить». Swiping a purchase row to the left deletes it, and admins can delete any shared purchase in the flat.

**Before you start:**
- Read `gan-harness/generator-state.md`, `supabase/migrations/0005_slice5_2.sql` (`delete_purchase`, around line 264) and the admin/role helpers from 0006.
- Migrations 0001–0008 are LIVE; never edit them. New SQL goes in `supabase/migrations/0009_slice11_admin_delete.sql`.
- Do not touch `.env.local`. Do not commit or stash. Do not apply anything to the live DB.
- **Visual truth:** `docs/design/*.dc.html` and the capsule kit. The user rejects drift.

## SQL (0009)

Replace `public.delete_purchase(p_id uuid)` with the same signature and the same grants (authenticated only):
- **Who can delete:**
  - the payer, as before;
  - OR an **active admin** of the purchase's household, but only when `status = 'shared'`. An admin must never see or delete someone else's pending or personal purchase.
- **Keep every other rule unchanged:**
  - membership check;
  - `purchase not found` for invisible rows;
  - the `has_payments` block (settled shares from others, or non-cancelled `settlement_shares`);
  - `for update` and the lock order already used.
- **Admin check:** use the existing helper if there is one, else `exists(select 1 from public.members m where m.household_id = … and m.user_id = auth.uid() and m.active and m.role = 'admin')`. Use the real column names.
- Keep security definer with `search_path=''`. The anon surface stays 4.

## App

- **`canDelete(purchase)`:** true when `payer_id = me`, or (`status = 'shared'` and I am an admin of that household). Use it in the UI and in the optimistic `deletePurchase` action, which is currently payer-only on the client.
- **Swipe-left on purchase rows:** on Главная «Последние покупки» and on the Покупки list.
  - Only rows where `canDelete` is true can be swiped.
  - Use motion/react drag on x: drag left reveals a red/orange (token) capsule «Удалить» behind the row.
  - Releasing past the threshold, or tapping «Удалить», opens a confirm sheet: «Удалить «нан» · 600 ₸? Доли у всех исчезнут.» with «Удалить» / «Отмена».
  - Then call the existing optimistic delete. Errors use the existing notices (for example «Уже есть оплаты — удалить нельзя»).
  - The row snaps back on cancel.
- **Gesture rules:**
  - Vertical scrolling must keep working: use `dragDirectionLock`, and only horizontal intent drags.
  - Tapping a row still opens it.
  - Animate transform and opacity only.
  - Respect reduced motion: no drag, show a «⋯ → Удалить» path instead, or rely on the existing detail-screen delete.
- **Purchase detail screen:** if it has a payer-only delete button, show it for admins too, using the same `canDelete`.
- Copy goes in `ru.ts`, colours are tokens only.

## B. «Напомнить» also posts to the Telegram group

**User request (verbatim):** «также если напомнить отправил то давай сразу писал и отмечал в тг».

When a member sends a manual reminder (the «Напомнить» flow, which uses the `remind` RPC from 0005 or its route), also post to the household's Telegram group and tag both people. Use the 0007 helpers `private.tg_tag`, `tg_money`, `tg_send` and `households.telegram_chat_id`. The message:

```
🔔 @debtor, напоминание: ты должен @creditor 1 200 ₸
```

The amount is the current pair net, the same value the push uses.

**Rules:**
- **Manual only.** Only reminders the user sends by hand post here. Do NOT post the automatic daily 19:00 cron reminders, which would spam the group.
- **Implementation:** do it in SQL inside `remind`, or via a trigger on the reminder-log insert that can tell manual from cron. Choose what the 0005 code supports cleanly.
- **Rate limiting:** respect the existing 6-hour cooldown, so a reminder blocked by the cooldown posts nothing.
- **Failure safety:** wrap the send in `begin … exception when others then null` so Telegram can never break the reminder.
- If the household has no chat id, or pg_net or the vault secret is missing, do nothing.

**PGlite tests:**
- the message builder output (tags, amount);
- cron reminders produce no Telegram attempt;
- a cooldown-blocked remind produces none;
- remind still works when pg_net is absent.

## Tests (lean)

- **PGlite:**
  - an admin deletes another member's shared purchase;
  - a non-admin non-payer is refused with 42501;
  - an admin cannot delete someone's pending or personal purchase (not found);
  - `has_payments` still blocks an admin;
  - a former admin who is now inactive is refused;
  - the anon surface is 4.
- **Unit:** `canDelete`.
- **E2E (once):**
  - an admin swipes left on another member's purchase, confirms, and the row disappears;
  - a non-admin can't swipe another member's row.
- `npm run verify` is green, `npm run test:e2e` is green once, and nothing is committed.
- Append a "Slice 11" note to `generator-state.md`.
- The final report lists the SQL objects and the results.
