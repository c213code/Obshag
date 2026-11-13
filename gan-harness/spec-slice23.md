# Slice 23 — mark a housemate «в отъезде» (skip their cooking days)

User: «нужно добавить функ типа пропустить готовку, типа например нурда теперь не в городе и нужно ему пропустить».

## What exists
- `members.away_until` (date). The duty rotation already skips a member who is away (`src/lib/domain/duty.ts`
  `assignee`, SQL in 0012/0014: «away (away_until >= day) or inactive is skipped: the next available member in rotation
  order takes the day»). The week/calendar already show «в отъезде».
- But only the person themself can set it: `public.set_away(p_household, p_until)` (0006) updates `auth.uid()`'s row,
  UI = Профиль → «Я уезжаю» (`src/components/app/flat/AwaySheet.tsx`). Nurdaulet is out of town and won't do it.

## Change
Any active member of the household can set / clear `away_until` for ANY active member (roommates trust each other;
the group sees it in Telegram, so it's transparent).

### A. Database — `supabase/migrations/0021_slice23_away_for.sql`
Never edit 0001–0020 (live). Do NOT apply remotely; no Supabase MCP tools; PGlite tests only.
- New `public.set_member_away(p_household uuid, p_user uuid, p_until date) returns void`, security definer,
  `search_path = ''`:
  - caller authenticated and an active member of p_household; p_user an active member of p_household (else 42501).
  - same date rule as set_away: null (= «дома») or today..today+366 (Asia/Almaty), else 23514.
  - updates `members.away_until`.
  - Telegram (only when the value actually changes and the household has `telegram_chat_id`), via `private.tg_send`,
    inside `begin … exception when others then null; end` (never breaks the update):
    - set: `'✈️ ' || private.tg_tag(p_user) || ' в отъезде до ' || <«20 нояб»> || ' — готовка идёт дальше по кругу'`
      (+ `' · отметил ' || private.tg_tag(caller)` when caller ≠ p_user)
    - clear: `'🏠 ' || private.tg_tag(p_user) || ' снова дома'` (+ same «· отметил» suffix)
    - date format: day + month abbreviation (янв фев мар апр мая июн июл авг сен окт нояб дек), same as
      `private.tg_pair_lines` in 0020 — reuse that expression style.
  - revoke from public, anon, authenticated; grant execute to authenticated. Anon surface stays 13.
- Leave `public.set_away` as is (old clients).

### B. App
- Repo: `setMemberAway(householdId, userId, until: string | null)` in `src/lib/data/repo.ts`, supabaseRepo (RPC
  `set_member_away`), mockRepo (same rules), contract tests. Refresh app data afterwards the same way the existing
  `setAway` flow does.
- `AwaySheet.tsx`: accept an optional target member (name + id). Title for someone else: «{Имя} в отъезде»;
  label «Вернётся»; clear button «{Имя} дома»; hint «Пока его нет, его дни готовки берёт следующий по кругу.»
  Own-profile behaviour and texts unchanged (it may call setMemberAway with my own id, or keep setAway — your choice,
  as long as both work).
- Entry points (reuse the sheet, no new design):
  1. Duty screen «Порядок» card (`OrderCard.tsx`): tapping a member row opens the sheet for that member (my own row
     opens it for me). Rows of away members already show «в отъезде» — keep it, add the date if the card has room in the
     same caption style («в отъезде до 20 нояб»).
  2. Квартира → neighbor (`MemberSheet.tsx`): add an action «В отъезде…» for every member (not admin-only), next to
     the existing actions, same ActionRow style.
- After saving, the week card / today's cook update immediately (the rotation already skips away members).
- ru.ts: all new strings in `ru.flat.away` (or a new `ru.flat.awayFor` block). Russian, short.

### C. Tests
- `tests/db/slice23.test.ts` (PGlite; Telegram fake as in slice21/22 tests):
  1. member A sets B away → B.away_until set; one ✈️ post with B's tag, the date and «· отметил @A».
  2. self → no «отметил» suffix; clear → 🏠 post; same value twice → no second post.
  3. not a member / target not active / bad date → errors; anon cannot execute; anon count 13.
  4. duty assignee for a day inside the away range is the next member (call the existing SQL assignee function).
- Unit/contract tests for the repo method; an e2e in mock mode: open «Порядок», tap a neighbor, set a date → the week
  shows «в отъезде» for them and the next person on their day. Screenshot `s23-away-for.png` in gan-harness/screenshots.
Run `npx tsc --noEmit`, `npx vitest run`, the new e2e and the existing duty e2e specs (whole files).
