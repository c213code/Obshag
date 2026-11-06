# Evaluation rubric: Slice 0 "Scaffold"

Score each criterion from 0 to 10. The weighted total must be ≥ 7.0 to pass. Be strict and concrete: cite file paths, commands and observed output.

## How to evaluate

The project path contains spaces, so quote it: `cd "/Users/yerasyltoleubek/Change me after"`.

1. Run `npm run verify` and `npm run test:e2e`, and record pass/fail with the key output lines.
2. Start the app in mock mode (`NEXT_PUBLIC_DATA_MODE=mock npm run dev -- -p 3100` or `npm run start` after build) and inspect `/kit`:
   - with Playwright MCP tools if available,
   - otherwise with a quick Playwright script (`npx playwright` in WebKit, iPhone 15 viewport) that screenshots `/kit` into `gan-harness/screenshots/` and clicks through the tabs, the Fab menu, the CardStack and the Money demo.
3. Grep for raw hex colors outside the token file and SQL:

   ```
   grep -rnE '#[0-9A-Fa-f]{3,8}\b' src --include=*.ts --include=*.tsx --include=*.css
   ```

   Exclude the tokens file.
4. Grep the motion code for animated `width|height|boxShadow|filter|top|left` properties.
5. Stop the dev server you started.

## Criteria

### 1. Functionality: weight 0.35

- `verify` is green: lint, typecheck, unit tests with coverage ≥ 80% on `src/lib/**`, and build.
- `test:e2e` is green.
- The migration test passes: RLS is enabled on all tables, and the cross-household and personal-purchase isolation is proven.
- Every deliverable in spec §1–§7 exists and works: TabBar pill slides, Fab menu, CardStack, Money ends exactly at "200 ₸", Sheet, Segmented.

Scoring: 10 = all of the above; 7 = minor gaps; ≤4 = verify or e2e failing.

### 2. Design fidelity: weight 0.30

- Exact token values are used.
- Capsule style is applied consistently (Bar/Pill/Fab/ListRow/Header).
- Typography follows the scale, with SF Pro and rounded tabular money.
- The dark theme matches SDD §5.
- No raw hex outside the tokens file.
- Copy is in Russian via i18n.

Scoring: 10 = indistinguishable from the approved canvas style; 5 = generic or off-token.

### 3. Motion and craft: weight 0.20

- Only transform and opacity are animated.
- The smooth curve is the default and the soft spring is used only for success and pop-ins.
- The Fab does not rotate.
- Taps are ignored mid-animation.
- Reduced motion falls back to fades.
- No-lag CSS rules are present (tap highlight, touch-action, overscroll, 16px inputs, safe areas).
- Accessibility: buttons, aria-labels and aria-current.

### 4. Code quality and architecture: weight 0.15

- TypeScript strict with no `any` leaks.
- Clean folder structure as in the spec.
- The repo interface and mockRepo are cleanly separated.
- Env is validated with zod.
- `.gitignore` and `.env.example` are correct.
- The README is accurate.
- No dead code and no secrets.

## Output format

Write the feedback to `gan-harness/feedback/feedback-NNN.md` (3-digit iteration number). It must contain:
- a table of the 4 criteria with score, weight and a one-line reason
- `**Weighted total: X.X**`
- the commands run and their results
- a prioritized list of concrete fixes (file, problem, expected outcome) for the generator
