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

## Apple Pay → Общак: как настроить

После оплаты картой Kaspi Gold iOS-команда отправляет сумму и продавца в Общак. Появляется «Ждут решения» (видно только тебе) и приходит уведомление «Magnum · 6 000 ₸ — Что купил? Общее или моё».

1. Добавь Общак на экран Домой (Safari → «Поделиться» → «На экран Домой») и открой его оттуда. Push на iPhone работает только так.
2. Квартира → «Apple Pay → Общак» → «Включить уведомления» (разреши в окне iOS).
3. Там же нажми «Создать ключ» и сохрани его: второй раз он не показывается. «Создать новый» заменяет ключ, старый перестаёт работать.
4. Команды → Автоматизация → «+» → Кошелёк (Wallet) → выбери карту Kaspi Gold → «Запускать сразу».
5. Добавь действие «Получить содержимое URL»: адрес `https://<твой-домен>/api/capture`, метод POST, тело JSON с ключами `token` (текст ключа), `amount` (переменная «Ввод команды → Сумма»), `merchant` (переменная «Ввод команды → Продавец»).
6. Оплати что-нибудь: в Общаке появится покупка, нажми «Общее» или «Моё».

Ответы `/api/capture`: 201 принято, 400 плохое тело или сумма, 401 неверный ключ, 429 больше 30 в час, 500 ошибка сервера.

Для сервера (Vercel → Environment Variables), ключи генерирует `npx web-push generate-vapid-keys`:

- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` публичный ключ (нужен при сборке),
- `VAPID_PRIVATE_KEY` приватный ключ (только сервер),
- `VAPID_SUBJECT` например `mailto:you@example.com`.

Без них capture всё равно сохраняет покупку, просто уведомления не приходят. Ключ service-role для этого не нужен: `/api/capture` ходит в базу с anon-ключом через функцию `capture_purchase`. Миграция `supabase/migrations/0004_slice4_capture.sql` применяется поверх 0001–0003.

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
