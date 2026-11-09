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

## Забыли пароль: настройка Supabase

Письмо со ссылкой отправляет Supabase Auth, поэтому нужен рабочий SMTP (встроенный почтовый сервис Supabase годится только для пары писем в час).

1. Authentication -> Emails -> SMTP Settings: включить Custom SMTP. Для Gmail: host `smtp.gmail.com`, port `465`, username = адрес Gmail, password = пароль приложения Google **без пробелов** (16 символов), sender email = тот же адрес.
2. Authentication -> URL Configuration: **Site URL** = `https://obshak-gules.vercel.app`; **Redirect URLs** добавить `https://obshak-gules.vercel.app/reset` (для локальной проверки ещё `http://localhost:3000/reset`).
3. Authentication -> Emails -> Templates -> Reset Password: ссылка в шаблоне должна оставаться `{{ .ConfirmationURL }}` (приходит `?code=`) либо вести на `{{ .SiteURL }}/reset?token_hash={{ .TokenHash }}&type=recovery`; `/reset` понимает оба варианта.

Экран `/forgot` всегда отвечает одинаково («Если такая почта есть — мы отправили письмо»), чтобы по нему нельзя было узнать, зарегистрирована ли почта. В mock-режиме письмо не уходит, а `/reset?mock=1` (с необязательным `&email=`) открывает форму нового пароля.

## Офлайн

`public/sw.js` кэширует только неизменяемую статику своего домена (`/_next/static/*`, `/icons/*`, шрифты, manifest) и страницу `/offline`. Никогда не кэшируются: `/api/*`, запросы с `Authorization`, чужие домены (Supabase, kaspi.kz), RSC-ответы, не-GET запросы, ответы с `Cache-Control: no-store`/`private`. Правила лежат в `public/sw-rules.js` и покрыты тестами (`src/lib/swRules.test.ts`). Проверка на реальном телефоне: `docs/DEVICE_CHECKLIST.md`.

## Напоминания: CRON_SECRET

Ежедневные напоминания (19:00 Asia/Almaty, `vercel.json` → `0 14 * * *` UTC) и кнопка «Напомнить» работают без service-role ключа:
сервер передаёт `CRON_SECRET` в RPC, а база хранит только его sha256.

1. Придумай секрет (от 16 символов): `openssl rand -hex 32`.
2. Vercel → Settings → Environment Variables: `CRON_SECRET` = секрет (Production). Vercel Cron сам шлёт `Authorization: Bearer $CRON_SECRET`.
3. Посчитай хеш локально: `printf %s "$CRON_SECRET" | shasum -a 256` (только hex-часть).
4. Supabase → SQL Editor, после применения `0005_slice5_2.sql`:

   ```sql
   insert into private.server_secrets (name, hash) values ('cron', '<sha256-hex>')
   on conflict (name) do update set hash = excluded.hash;
   ```
5. Redeploy. Проверка: `curl -i https://<домен>/api/cron/daily` → 401, с правильным Bearer → 200 `{"ok":true,"reminders":N}`.

Смена секрета: повтори шаги 2–4. Пока строки `cron` нет, `remind` и `run_daily_reminders` отвечают 28000.

## Telegram: уведомления в группу

Бот @obshagk_bot пишет в группу каждую общую покупку (с отметкой должников) и подтверждённый расчёт. Отправка идёт из базы
(отложенные триггеры на `purchases` и `settlements`, миграция `0007_slice9_telegram.sql`), поэтому ловит ручные покупки,
Apple Pay и ежемесячные платежи.

- Токен хранится только в Supabase Vault под именем `telegram_bot_token` (и в локальном `.env.local`). В репозитории токена нет.
- Расширение `pg_net` включается на проекте отдельно (Database -> Extensions); без него и без секрета триггеры тихо ничего не делают.
- Группа задаётся SQL-ом: `update households set telegram_chat_id = <chat id> where id = '<household id>';`
- Ник человека (`@username`) вводится в Квартира -> Профиль; по нему бот отмечает его в группе, иначе пишет имя.

## Telegram: личка с кнопками и дайджест в 19:00

«Потом» больше не шлёт пуш сразу: в 19:00 (тот же cron `/api/cron/daily`) приходит ОДИН пуш «Ждут решения: N покупок» и,
если подключён Telegram, по сообщению на каждую покупку (до 10) с кнопками «Общее» / «Моё». Нажатие решает покупку; «Общее»
делит поровну между теми, кто дома, и дальше срабатывает групповой триггер (0007). Ждущие покупки в группу не попадают.
Старый Shortcut без выбора по-прежнему получает пуш сразу.

1. Миграция `0010_slice12_tg_dm.sql` (применяется отдельно). Строка `cron` в `private.server_secrets` уже нужна (см. выше).
2. Vercel → Environment Variables (значения не коммитить):
   - `TELEGRAM_BOT_TOKEN`: токен бота из @BotFather;
   - `TELEGRAM_WEBHOOK_SECRET`: любой секрет от 16 символов (`openssl rand -hex 24`);
   - `NEXT_PUBLIC_TELEGRAM_BOT`: ник бота без `@` (по умолчанию `obshagk_bot`).
3. Один раз после деплоя зарегистрируй вебхук: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<домен>/api/telegram/setup` → `{"ok":true}`.
   После этого `getUpdates` у бота не работает (так и задумано).
4. В приложении: Квартира → Профиль → «Подключить Telegram» → «Start» в чате с ботом. Ссылка одноразовая, живёт 15 минут.
   «Отключить» там же.

Вебхук `/api/telegram/webhook` проверяет заголовок `X-Telegram-Bot-Api-Secret-Token` (401 при несовпадении), тело до 64 КБ.

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
