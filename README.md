# Общак

PWA для общих расходов: покупки, ежемесячные платежи, расчёты «один перевод вместо двух».
Сейчас готов slice 0 (каркас): UI-кит, мок-данные, SQL-схема с RLS, тесты.

## Запуск в mock-режиме (без секретов)

```bash
npm install
npx playwright install webkit   # один раз, для E2E
NEXT_PUBLIC_DATA_MODE=mock npm run dev
```

Откройте http://localhost:3000/kit, там галерея всех компонентов.

## Скрипты

| Команда | Что делает |
|---|---|
| `npm run dev` | dev-сервер Next.js |
| `npm run build` | production-сборка |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest с покрытием (порог 80% строк для `src/lib/**`), включая миграцию на PGlite |
| `npm run test:e2e` | Playwright (WebKit, iPhone 15); собирает приложение (`build && start`, mock + NEXT_PUBLIC_E2E=1) и поднимает его на порту 3100 |
| `npm run verify` | lint, typecheck, test, build |

## Структура

```
src/app/             страницы App Router (/ и /kit)
src/components/ui/   UI-кит: Bar, Pill, Fab, Header, Segmented, ListRow, Avatar, Card,
                     BalanceCard, CardStack, Money, Skeleton, Sheet, BottomActions, TabBar, icons
src/lib/format/      formatTenge
src/lib/motion/      кривые, пружины, useReducedMotionSafe, useTapLock
src/lib/i18n/        ru.ts, весь русский текст
src/lib/data/        types, Repo, mockRepo, seed
src/lib/env/public.ts  NEXT_PUBLIC_*; mock в production запрещён (кроме NEXT_PUBLIC_E2E=1)
src/lib/env/server.ts  секреты, `import "server-only"`
src/styles/tokens.css  дизайн-токены (единственное место с hex-цветами)
supabase/migrations/ SQL-схема и RLS
tests/e2e/           Playwright
tests/db/            проверка миграции на PGlite
docs/                SDD и план
```

## Правила

- Анимируем только `transform` и `opacity`; `smooth` по умолчанию, `softSpring` только для успеха и появления.
- Тексты только через `src/lib/i18n/ru.ts`.
- Hex-цвета только в `src/styles/tokens.css`.
