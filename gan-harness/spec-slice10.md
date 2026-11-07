# GAN spec: Slice 10, "Decide in the Shortcut" (lean process)

**User request:** buttons «Общее / Моё» right after an Apple Pay payment. iOS web push can't show action buttons, so the iOS Shortcut shows a native «Выбрать из меню» and sends the user's choice along with the capture.

**Before you start:**
- Read `gan-harness/generator-state.md`, `supabase/migrations/0004_slice4_capture.sql` (`capture_purchase`, `resolve_pending`), the 0005 custom/away participant rules, and `src/lib/server/captureHandler.ts`.
- Migrations 0001–0007 are LIVE; never edit them. New SQL goes in `supabase/migrations/0008_slice10_capture_choice.sql`.
- Do not touch `.env.local`. Do not commit or stash. Do not apply anything to the live DB.

## API

POST `/api/capture` accepts an optional `choice` field. Matching is lenient: trim, lowercase, and accept Russian words too.

| `choice` value | Accepted forms | Result |
|---|---|---|
| shared | `"shared"`, `"общее"` | The purchase is created as **shared** immediately: equal split among the default participants, which are the active members not away (the same rule as a manual purchase, slice 2). The payer is the token owner, and description = merchant, else «Покупка». **No push.** The Telegram trigger from 0007 posts it automatically. |
| personal | `"personal"`, `"моё"`, `"мое"` | The purchase is created as **personal**. **No push**, never visible to others. |
| missing, `"later"`, `"потом"`, empty or anything else | — | Exactly today's behaviour: **pending** plus a push. |

The old Shortcut, which sends no `choice`, must keep working unchanged.

## SQL (0008)

Add an overload or a new function `capture_purchase(p_token text, p_amount integer, p_merchant text, p_choice text)`. It must:
- reuse the 0004 token-hash check, rate limits and household resolution;
- create the shares with the existing helpers;
- be security definer with `search_path=''`;
- be granted to anon.

**Anon surface:** if you add an overload, the anon surface becomes 5. Update the anon-surface test explicitly and document why. Prefer replacing the old 3-arg function with a 4-arg one where `p_choice text default null`; then the anon surface stays 4, provided `drop function` + `create` keeps the grants right. Choose whichever keeps it at 4.

**Return value:** `{status: 'pending'|'shared'|'personal', purchase_id}`. The route uses it to decide whether to push.

## Tests (lean)

- **PGlite:**
  - `choice=shared` creates the shares for all non-away members, and the payer's own share follows the existing convention;
  - `personal` creates no shares;
  - `null` gives pending, as before;
  - a bad token is still rejected;
  - the anon surface is still 4.
- **Unit:** the `captureHandler` choice parsing (Russian and English forms), and that there is no push for shared or personal.
- No new e2e is needed. `npm run verify` must be green.

## Done

`npm run verify` is green, nothing is committed, and a short "Slice 10" note is appended to `generator-state.md`. The final report lists the SQL objects and the final anon surface.
