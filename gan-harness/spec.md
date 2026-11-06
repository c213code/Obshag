# GAN spec: Slice 0 "Scaffold" for Общак

Read these first: `docs/SDD.md` (product, design §5, data §8) and `docs/PLAN.md` (Slice 0). This file narrows the work to slice 0 only. Do NOT build slice 1 or later features: no auth flow, no real screens beyond `/kit`.

## Environment facts

- The project root is `/Users/yerasyltoleubek/Change me after`. **The path contains spaces, so always quote it.**
- Node 24 and npm 11 are available. There is no Docker and no Supabase CLI. Credentials don't exist yet, so everything must run offline with mock data.
- The git repo is initialised. **Do NOT commit.** The orchestrator commits after user approval (Gate 2).

## Stack (locked)

- Next.js (latest stable, App Router, `src/` dir, TypeScript strict, ESLint), created non-interactively.
- Tailwind CSS v4 with tokens defined in `@theme` in `src/app/globals.css`, or a dedicated `src/styles/tokens.css` imported there. **No raw hex colors anywhere else in `src/`.**
- `motion` (the motion/react package) for animation.
- `zod` for env and schemas.
- Vitest (+ @vitest/coverage-v8) for unit tests, and Playwright for E2E using the WebKit "iPhone 15" device profile.
- `@electric-sql/pglite` (dev dependency) to apply and validate SQL migrations in tests, with a stub `auth` schema.

## Deliverables

### 1. Design tokens (from SDD §5.1; exact values)

**Colors:**

| Token | Value | Use |
|---|---|---|
| bg | #0E0F13 | |
| card | #1A1C22 | |
| card-2 | #2C2F37 | |
| text | #F2F3F5 | |
| muted | #8B8F98 | |
| lime | #C8F25A | |
| on-lime | #1A2300 | |
| lime-soft | #2A2D1A | |
| orange | #FF8A5B | |
| on-orange | #2B0E02 | |
| hairline | #23262D | card borders |

**Fonts:**
- Sans: `-apple-system, "SF Pro Text", system-ui, sans-serif`.
- Rounded numbers: `ui-rounded, "SF Pro Rounded", -apple-system, system-ui, sans-serif`.

**Type utilities:**

| Utility | Size / weight | Notes |
|---|---|---|
| text-display | 40 / 700 | rounded, tabular-nums, letter-spacing −0.02em, line-height 1.05 |
| text-title | 22 / 700 | |
| text-amount | 20 / 700 | rounded, tabular-nums |
| text-headline | 17 / 600 | |
| text-body | 15 / 400 | |
| text-caption | 13 / 400 | muted |
| text-label | 12 / 500 | |

**Spacing:** 4 / 8 / 12 / 16 / 24.

**Radius:** sm 12, md 20, lg 28, pill 999.

**Global no-lag CSS:**
- body background is bg
- `-webkit-tap-highlight-color: transparent`
- `touch-action: manipulation`
- `overscroll-behavior: none`
- inputs at ≥16px
- `user-select: none` on interactive chrome
- `font-variant-numeric: tabular-nums` for money
- `color-scheme: dark`
- safe-area padding with `env(safe-area-inset-*)`

### 2. Motion foundation (`src/lib/motion/`)

- Easings: `smooth` = cubic-bezier(.22,1,.36,1) is the default; `softSpring` = cubic-bezier(.34,1.18,.64,1).
- Spring presets for motion/react that approximate them: a "snap" preset for tabs and pills, and a "soft" preset for success states and pop-ins.
- A `useReducedMotionSafe()` helper, so that under reduced motion transitions become opacity fades.
- Rule, documented in a comment: animate **only `transform` and `opacity`**. Interactive components must ignore taps while their animation is running.

### 3. UI kit (`src/components/ui/`)

Every component is typed, accessible (real button/a elements, aria-labels on icon-only buttons) and styled only with tokens. Match the approved design: dark theme, capsule style.

- **Bar:** a capsule with a 94% card background (card at 0.94 alpha), a 1px card-2 border, padding 6, radius pill, flex row with gap 6.
- **Pill:** variants `ghost` (muted text), `on` (card-2 background, text color) and `lime` (lime background, on-lime text); sizes sm and md; rendered as a button or link.
- **Fab:** a 58px lime circle with on-lime icon color, used next to a Bar. It must not rotate on press. On press it scales to 0.94 with the smooth curve.
- **Header:** a Bar holding a circular back button (44px card-2 circle) and the title (headline). An optional right-side Bar with a circular icon button.
- **Segmented:** a Bar with Pills; the active Pill is highlighted (`on` or `lime` variant prop). The active indicator slides with a motion `layoutId` (shared layout).
- **ListRow:** pill-shaped (card background, hairline border, radius pill, padding 6), with a round Avatar on the left, title and caption, and a trailing slot.
- **Avatar:** a round initial with a background color from a person color list (#2F5D8A, #8A5A2F, #6B4C8A, and lime for "me"). Add these person colors as tokens too. Sizes 26, 40, 44 and 52.
- **Card:** card background, hairline border, radius lg. **BalanceCard:** a lime card with the decorative rings (an SVG at low opacity), the household name, a "N из M" pill and the balance in display type.
- **CardStack:** 2–3 BalanceCards stacked. Tapping sends the front card to the back with the smooth curve, transform only.
- **Money:** formats integer tenge as "6 000 ₸", with a non-breaking thin or normal space as thousands separator and a sign option ("+7 550 ₸"). Animated rolling when the value changes (count with an easeOut curve, via `requestAnimationFrame` or motion's `animate`); the final value is always exact. Pure formatter: `formatTenge(n, {sign?})`.
- **Skeleton:** a shimmering placeholder (opacity animation only).
- **Sheet:** a bottom sheet (radius lg at the top, card background) that opens from a small pill shape. Implement the "island" motion with a transform scale and a layout animation, with content fading in late, and close on backdrop tap.
- **BottomActions:** a floating container fixed at the bottom with safe-area padding. It takes a Bar plus an optional Fab or lime Pill.
- **TabBar:** floating at the bottom: a Bar with 4 tabs (Главная, Покупки, Ежемесячно, Квартира; the active tab shows icon plus label in an `on` pill, inactive tabs show the icon only in muted color) and a separate lime Fab "+". The active pill slides between tabs via `layoutId`.
  - The Fab opens a small menu that morphs out of the Fab (scale from its bottom-right corner, smooth curve) with the options "Покупка" and "Ежемесячный платёж". No rotation.
- **Icons:** inline stroke SVG components (home, list, calendar, users, plus, back chevron, check, bell, cart, transfer arrows, external arrow, copy). No icon fonts and no emoji.

### 4. `/kit` gallery page (`src/app/kit/page.tsx`)

A dev gallery that renders every component and its variants on the dark background, inside a 390px-wide phone frame column, titled with labels.

It must include:
- the TabBar with a working sliding pill and the Fab menu
- a Segmented control (Поровну / Свои суммы) and a payer Segmented (Я / Айдос / Даня / Нурик, lime active)
- Header examples
- 3 ListRows (received ✓, waiting with a "Напомнить" pill, missing Kaspi in orange)
- a CardStack (Квартира 42 +7 550 ₸, Дача −1 200 ₸, Поездка +3 400 ₸)
- a Money demo button that changes 2 000 → 200
- a Sheet demo button
- Skeletons
- BottomActions (Я оплатил + lime "Перевести 200 ₸")

All copy is in Russian, through `src/lib/i18n/ru.ts`.

`/` can temporarily redirect to `/kit` or show a minimal placeholder that links to `/kit`.

### 5. Data layer skeleton

- `src/lib/data/types.ts`: TypeScript types mirroring SDD §8: Profile, Household, Member, Purchase, Share, Settlement, Bill.
- `src/lib/data/repo.ts`: a `Repo` interface (methods slice 1 will need: getMe, listHouseholds, listMembers, listPurchases, createHousehold, joinHousehold, createPurchase). Plus `src/lib/data/mockRepo.ts`, an in-memory implementation with seed data (`src/lib/data/seed.ts`: household "Квартира 42" and members Ерасыл (me), Айдос, Даня, Нурик), selected when `NEXT_PUBLIC_DATA_MODE=mock`.
- `src/lib/env.ts`: zod-validated env. Mock mode needs no secrets. Supabase vars are optional in mock mode and required otherwise.
- `.env.example` documents every var without values. Add `.gitignore` entries for `.env*` (except `.env.example`), `node_modules`, `.next`, `gan-harness/screenshots`, `playwright-report` and `test-results`.

### 6. SQL baseline (`supabase/migrations/0001_baseline.sql`)

- All SDD §8 tables with sensible types, constraints (amount > 0, day_of_month 1–28, enums via check constraints) and indexes on foreign keys.
- RLS enabled on every table.
- A `public.is_member(household uuid)` security-definer helper that uses `auth.uid()`.
- Policies:
  - Members can read and write the rows of their own households.
  - A purchase with status `personal` is visible only to its payer, and so are its shares.
  - `push_subscriptions`, `capture_tokens` and `reminder_log` are owner-only.
  - `profiles` can be read by members who share a household; each user can update only their own profile.

**Test (`tests/db/migration.test.ts`):**
- Use PGlite.
- Create a stub schema: `create schema auth; create table auth.users(id uuid primary key);` and `auth.uid()` reading a `request.jwt.claim.sub` setting. Also create the roles `authenticated`/`anon` if needed, or apply the policies to `public` and test with `set role`.
- Apply the migration, then assert:
  - every public table has RLS enabled
  - user A cannot select household B's purchases
  - a personal purchase is hidden from other members

### 7. Tooling and scripts

- `npm run dev`
- `npm run build`
- `npm run lint`
- `npm run typecheck` (`tsc --noEmit`)
- `npm run test` (Vitest)
- `npm run test:e2e` (Playwright; its webServer starts the app in mock mode on port 3100)
- `npm run verify`: lint, typecheck, test with coverage, then build.

Vitest coverage thresholds: ≥80% lines for `src/lib/**` (domain, data/mock and format code).

**Tests written FIRST (TDD):**
- `src/lib/format/money.test.ts`: 0, 1500, 6000, 7550 with sign, negative, large numbers, and that the output uses the ₸ suffix.
- `tests/e2e/kit.spec.ts`:
  - `/kit` loads with no console errors
  - tapping the "Покупки" tab moves the active pill (the active tab gets `aria-current`)
  - the Fab opens the menu and the menu has both options
  - tapping a CardStack card changes the front card
  - the Money demo ends at exactly "200 ₸"

### 8. Docs

`README.md` (Russian is fine) covering: how to run in mock mode, the scripts, and the folder map.

## Out of scope for slice 0

- Supabase client wiring, auth and real pages (slice 1).
- Push, Service Worker and the manifest (slice 4/8).
- Vercel deploy.

## Definition of done

- `npm run verify` and `npm run test:e2e` both pass locally.
- `/kit` visually matches the approved style: dark background, lime accents, capsule bars, SF Pro, rounded tabular money.
- No raw hex colors outside the token file. Check with grep, excluding the token file and the SQL.
- Motion uses only transform and opacity.
