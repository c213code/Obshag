# Общак

PWA для общих расходов: покупки, ежемесячные платежи, расчёты «один перевод вместо двух».
Готовы slice 0 (каркас) и slice 1 (вход по коду, квартира, покупка поровну, Главная).

## Запуск в mock-режиме (без секретов)

```bash
npm install
npx playwright install webkit   # один раз, для E2E
NEXT_PUBLIC_DATA_MODE=mock npm run dev
```

Откройте http://localhost:3000: вход и регистрация по почте и паролю (минимум 8 символов), письма не уходят.
Почта `erasyl@obshak.test` с паролем `password123` входит в демо-квартиру «Квартира 42» (код приглашения `KV42AB7K9M3X`); у остальных демо-соседей (`aidos@`, `danya@`, `nurik@obshak.test`) тот же пароль.
Состояние mock-режима хранится в `localStorage`, перезагрузка его не сбрасывает.
Галерея компонентов: http://localhost:3000/kit.

## Реальный Supabase

1. Создайте проект, в `.env.local` задайте `NEXT_PUBLIC_DATA_MODE=supabase`, `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` (см. `.env.example`).
2. Примените по порядку `supabase/migrations/0001_baseline.sql`, `0002_slice1_rpcs.sql`, `0003_slice3_settlements.sql`
   (`supabase db push` или SQL Editor). 0001 и 0002 уже применены в рабочем проекте и не меняются.
3. Authentication → Providers → Email: **Enable Email provider = ON**, **Confirm email = OFF** (иначе регистрация не вернёт сессию
   и приложение покажет ошибку). Шаблоны писем и OTP не нужны: кодов нет. Authentication → Policies (Password): «Minimum password length» не больше 8.
   Site URL = адрес приложения.
4. Фронтенд ходит напрямую в Supabase: чтение через RLS, запись только через RPC.

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
src/app/(shell)/     экраны: login, onboarding, household, join, (app) = Главная, покупки, квартира
src/app/kit/         галерея компонентов
src/proxy.ts         обновление сессии Supabase (в mock-режиме пропускает)
src/components/ui/   UI-кит: Bar, Pill, Fab, Header, Segmented, ListRow, Avatar, Card,
                     BalanceCard, CardStack, Money, Skeleton, Sheet, BottomActions, TabBar, icons
src/lib/format/      formatTenge
src/lib/motion/      кривые, пружины, useReducedMotionSafe, useTapLock
src/lib/i18n/        ru.ts, весь русский текст
src/lib/data/        types, Repo, mockRepo, supabaseRepo, seed, контрактный тест
src/lib/domain/      splitEqual, balance, schemas (zod), guard, summary
src/lib/supabase/    клиенты (browser, server) и обновление сессии
src/components/app/  экраны и провайдеры (AppDataProvider, Guard, Toast)
src/lib/env/public.ts  NEXT_PUBLIC_*; mock в production запрещён (кроме NEXT_PUBLIC_E2E=1)
src/lib/env/server.ts  секреты, `import "server-only"`
src/styles/tokens.css  дизайн-токены (единственное место с hex-цветами)
supabase/migrations/ SQL-схема и RLS
tests/e2e/           Playwright
tests/db/            проверка миграций 0001 и 0002 на PGlite
docs/                SDD и план
```

## Правила

- Анимируем только `transform` и `opacity`; `smooth` по умолчанию, `softSpring` только для успеха и появления.
- Тексты только через `src/lib/i18n/ru.ts`.
- Hex-цвета только в `src/styles/tokens.css`.
