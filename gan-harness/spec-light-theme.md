# GAN spec: Light theme «Белый + фиолет» + lavender card + bento Главная

**User decisions (verbatim):**
- «Лавандовая карта, светлая тема: 1, Белый + фиолет»
- Главная → «Да, как в макете» (bento)
- Тема → «Как на телефоне» (follow iOS appearance)

**Constraints:** no SQL, do not touch `.env.local`, no commit/stash, approved skills only. The dark theme stays exactly as it is today: the current dark colours plus the night-sky card. Other screens keep their layout, only the colours change through tokens.

## 1. Theme switching (tokens only)

In `src/styles/tokens.css`, keep the current values as the dark theme. Add a light set under `@media (prefers-color-scheme: light)` that overrides the same custom properties. `globals.css` currently forces `color-scheme: dark`; make it `light dark`.

**Light values («Белый + фиолет»):**

| Token | Value |
|---|---|
| bg | `#f6f6f9` |
| card | `#ffffff` |
| card-2 | `#eeecf6` |
| bar | `#ffffff` |
| text | `#16132b` |
| muted | `#7c7894` |
| hairline | `#e7e5f0` |
| outline | `#d9d6e6` |
| stack | `#e3d6ff` |
| accent ("lime" token family) | `--color-lime: #6a3fe0`, `--color-on-lime: #ffffff`, `--color-lime-soft: #efe9ff` |

- Pick readable light equivalents for orange, periwinkle, danger, blue and the person colours.
- The `island` sheet stays black, which is fine on light.
- **Lavender card in light:**

  | Token | Value |
  |---|---|
  | night-sky | `#f0e9ff` |
  | night-1 | `#d4c6ff` |
  | night-2 | `#7f56ea` |
  | night-3 | `#4f2fc0` |
  | night-ink | `#2a1660` |
  | night-text | `#22124f` |
  | night-muted | `#6a58a8` |

  The sun is soft violet `#a98cff` and the windows are warm `#ffc85a`. Add tokens such as `--color-card-sun` and `--color-card-window` if needed: in dark they equal the current tone or lime behaviour, in light the values above. Keep the per-flat tone idea working in both themes.
- **Contrast:** check every text/background pair you touch reaches WCAG AA in light mode, for example lime-on-white text must not remain anywhere.

## 2. iOS PWA chrome

- `theme-color` meta gets one value per scheme via `media`.
- The apple status bar style must stay readable in both themes. `black-translucent` gives white status-bar text, which is invisible on a light background. Choose a working approach, for example `default` together with matching `theme-color` and safe areas.
- Verify in WebKit light and dark screenshots that the top of the screen looks right, and document the trade-off.
- The manifest `background_color` and `theme_color` must be sensible.

## 3. Bento Главная (only Home changes layout)

Match the approved mockup:

- **Header:**
  - a flat-switcher pill «9 квартал ▾» (reuse the existing household switching);
  - the bell;
  - your avatar.
  - The greeting row is removed.
- **CardStack:** it stays, with the card in the new style.
- **Bento grid**, 2 columns, gap 10, radius 20, `bg-card`:
  - **«Тебе должны»:** the amount, with «ты должен N ₸» under it. When someone owes you, add a small «Напомнить» link that goes to the existing remind flow.
  - **Next monthly bill** (spans 2 rows): title, date «5 дек», «твоя доля N ₸», and an accent «Рассчитаться» pill that goes to /settle. Without bills, show «Ежемесячно» with «Добавить» going to the bill form.
  - **«Траты»:** the month total plus a mini bar chart of the last 6 weeks of my share. The current week uses the accent colour, the others card-2.
- **The quick-action circle row is removed.** Its actions remain reachable through the Fab menu, the tiles and the tabs.
- **«Последние покупки»** is one rounded card with hairline separators:
  - A coloured category tile icon. Derive it from the description or merchant with a small keyword map: хлеб/нан → bread, овощ/пияз/сабиз → carrot, вода/су → droplet, молоко → milk, мясо/ет → meat, магазин/Magnum/Small/супермаркет → store, monthly bills → home. Fallback is a cart. Tile and icon colours come from tokens, light and dark.
  - Title, «payer · сегодня/вчера/date», the amount, and a small chip «paid/total». The chip is accent-tinted when everyone has paid.
  - «Все» goes to /purchases.
  - Keep swipe-to-delete working on these rows, and keep «Ждут решения» and incoming sections where they are today, restyled with tokens.
- Keep the existing data hooks and the derived settle data. No new network calls; the bill tile uses the bills already loaded or the existing repo method.

## 4. Verify

- `npm run verify` is green.
- Run e2e for the touched specs (kit, slice1, slice3, slice4, slice52, slice67, slice11, slice8). Update assertions that depended on removed Home elements, such as the quick-action circles or greeting, to the new equivalents without weakening them.
- Playwright WebKit has `colorScheme`, so run them in the default and spot-check light.
- Screenshots in light and dark of Главная, Покупки, Расчёт, Ежемесячно, Квартира, the island sheet and the Fab menu: `gan-harness/screenshots/theme-{light,dark}-*.png`. Compare light Главная with the mockup description and dark screens with the current look.
- Append «Light theme» to `generator-state.md`.
- The final report lists the token map, the status-bar decision, what changed on Home, and any contrast compromises.
