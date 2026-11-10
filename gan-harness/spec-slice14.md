# GAN spec: Slice 14, «Очередь» (duty rotation; cooking first)

**User:**
- «очередь для мусора, для приготовления еды, для приносения воды … основная очередь в приготовлении еды»
- «календарный вид»
- «напоминание каждый день, что ты сегодня повар»
- «возможность поменяться с другим … учесть edge case»
- then «всё делай».

**Visual truth (match 1:1):**
- `docs/design/DutyMain.dc.html`
- `DutyCalendar.dc.html`
- `DutySwap.dc.html`
- `DutyRequest.dc.html`

They are drawn in the light theme; use tokens so dark works too, and add tokens for the «конфорка» card such as `--color-stove-*`. Use the existing capsule and components where they fit.

**Constraints:**
- No commit or stash. Do not touch `.env.local`.
- 0001–0011 are LIVE; new SQL goes only in `supabase/migrations/0012_slice14_duty.sql`.
- Don't apply to the live DB.
- Machine may be loaded: rerun flaky e2e alone.

## Business rules (decided)

1. **Duty**, per household:
   - Fields: `kind` (`cooking` | `trash` | `water` | `custom`), `title`, `start_date`, `active`, plus an ordered rotation of member user_ids.
   - Only **admins** create a duty or edit its order and start date. Default order is the members' join order; start is today.
   - Only «Готовка» needs a UI now, but the model supports several. The chips Мусор/Вода can show «скоро» or open the create flow for admins.
2. **Assignee of a day (Asia/Almaty dates):**
   - An override for that day wins.
   - Otherwise take `rotation[(day − start_date) mod n]`. If that member is away that day (`members.away_until >= day`) or inactive, the next member in rotation order who is available takes it, so the day is skipped for the away person.
   - Computed, not materialised.
   - Leaving or joining members change the rotation from today; past days stay as recorded in `duty_done` / overrides.
3. **Swap request:**
   - Requester A owns `my_day` (the assignee, today or later) and picks B's day `other_day` (B is assignee, today or later, B ≠ A). Any member, any day.
   - Optional `reason` of up to 140 characters.
   - One pending request per day: a day already in a pending request → `busy`.
   - `expires_at` = earlier of the two days at 10:00 Almaty.
   - B accepts: re-check both days' assignees are still A and B (else `stale`), then write two overrides atomically (`source = 'swap'`).
   - B declines: status `declined`.
   - A can cancel while pending. After expiry the status is `expired` (lazily on read and by the morning cron).
   - First accept wins; concurrent requests on the same days get `busy` or `stale`.
   - Lock order: lock the duty row, then the request row.
4. **Done:**
   - The assignee may mark «Приготовил ✓» for today; past days are allowed until the next morning cron, then they lock.
   - Calendar and week show a done day as a check over the person's faded letter.
   - Monthly stats show done/total days per person.
5. **Admin replacement:** an admin can set an override for any future day (`source = 'admin'`), the «Не могу сегодня» fallback.
6. **Reminders:**
   - New cron at 09:00 Almaty (`0 4 * * *` UTC, a second entry in `vercel.json`) → `/api/cron/morning`, using the same Bearer CRON_SECRET check.
   - It runs `run_duty_morning(p_secret)`, server-secret gated, which returns per household and duty today's and tomorrow's assignee, the push subscriptions and `telegram_chat_id`, and expires stale requests.
   - It sends a push to today's cook: «Сегодня готовишь ты 🍳».
   - It posts to the group: «🍳 Сегодня готовит @x · завтра @y», using `tg_tag`.
   - Idempotent per day: track it in `private.duty_morning_log(duty_id, day)`.
7. **Notifications on a swap:**
   - The request sends a push to B, plus a Telegram DM with inline buttons [Согласен `sw:a:<id>`] [Не могу `sw:d:<id>`] if B linked Telegram (reuse the slice 12 webhook).
   - Accept posts to the group: «⇄ @a и @b поменялись: пн 17 ⇄ вт 18».
   - Decline sends a push to A.

## SQL (0012)

**Tables** with RLS (members of the household can select; all writes through RPCs only):
- `duties`
- `duty_members(duty_id, user_id, position)`
- `duty_overrides(duty_id, day, user_id, source, reason)`, PK `(duty_id, day)`
- `duty_done(duty_id, day, user_id, done_at)`
- `duty_swap_requests(id, duty_id, from_user, from_day, to_user, to_day, reason, status, expires_at, created_at, decided_at)`

**Functions:**
- `private.duty_assignee(duty_id, day)`
- public `duty_schedule(p_duty, p_from date, p_to date)`, which returns day, user_id, source (`rotation` | `swap` | `admin` | `skip`), done, and the pending request id. Authenticated and members only.

**RPCs**, authenticated, actor = `auth.uid()`, security definer, `search_path=''`:
- `create_duty`
- `set_duty_order`
- `request_swap`
- `respond_swap`
- `cancel_swap`
- `mark_duty_done`
- `admin_assign_day`

**Server-secret RPCs:**
- `run_duty_morning(secret)`
- `tg_respond_swap(secret, tg_user_id, request_id, accept)`

The anon surface becomes 9; update the anon-surface test.

## App

- **Tab bar:** a new «Очередь» tab between Покупки and Ежемесячно (five tabs; keep the capsule look and the CSS pill animation). Route `/duty`.
- **`/duty`:** as DutyMain:
  - duty chips;
  - the stove hero card with today's cook, tomorrow, «Приготовил» and «Поменяться»;
  - «Эта неделя», 7 cells: past done = check over faded letter, today ring, ⇄ badge on swapped days, plane icon on skipped/away;
  - «Порядок» with next dates.
  - With no duty yet: an admin sees a create flow (title Готовка, order with up/down reorder, start date); others see «Админ ещё не настроил очередь».
- **`/duty/calendar`:** as DutyCalendar, with month navigation and the stats.
- **Swap sheet:** as DutySwap — neighbours before/after, plus «Другой день» picking any day/assignee from the calendar, the reason field, «Отправить запрос».
- **`/duty/request/[id]`:** as DutyRequest, with accept/decline and the expiry countdown. My outgoing pending request shows on `/duty` with «Отменить».
- **Home:** a bento tile «Сегодня у плиты» (dark stove card) linking to `/duty`; hide it when there is no duty.
- **Mock repo:** supports all of it.
- Copy goes in `ru.ts`; tokens only; transform/opacity motion.

## Tests

- **PGlite:**
  - assignee rotation math across a month;
  - the away skip;
  - an override wins;
  - swap happy path;
  - busy / stale / expired / non-assignee / past-day refusals;
  - concurrent accept;
  - `mark_duty_done` rules;
  - admin-only create/order/assign;
  - morning idempotency;
  - `tg_respond_swap` linked-user check;
  - the anon surface.
- **Unit:** the schedule helper, the week/calendar view models, callback parsing `sw:a|d`.
- **E2E:**
  - an admin creates Готовка;
  - the week shows the rotation;
  - A requests a swap with B;
  - B accepts on the request screen;
  - the calendar shows ⇄ and swapped assignees;
  - «Приготовил» puts a check on today.
- `npm run verify` green, new and touched e2e green.
- Before/after screenshots compared with `docs/design/Duty*.dc.html` in `gan-harness/screenshots/duty-*.png`.
- Append «Slice 14» to `generator-state.md`.
