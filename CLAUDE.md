# CLAUDE.md — W2W CRM

CRM отдела продаж Win to Win (заказчик — Nuriddin Abdumalikov, COO). Интерфейс на русском, стиль — «Liquid Glass» сайта w2w.uz (токены, стекло, app-icon, ночные сцены перенесены из репозитория сайта в `assets/css/crm.css`). Подробности для людей — в README.md.

## Архитектура
- Интерфейс: `index.tpl.html` + `assets/` — ванильные ES-модули без сборщика, хеш-маршруты `#/<вид>?d=<id карточки>`. Публикация — GitHub Pages (workflow `pages.yml`, `node scripts/stamp.mjs --out _site` версионирует все import). Netlify проксирует `/`, `/index.html`, `/assets/*`, `/manifest.webmanifest` на Pages (`netlify.toml`).
- API: одна функция `netlify/functions/api.mts` (`config.path = "/api/*"`) → `netlify/lib/routes.mts`. Хранилище — Netlify Blobs через абстракцию `netlify/lib/store.mts` (в тестах `memoryKV`, локально `fileKV`).
- Модель: `netlify/lib/model.mts` — статусы, этапы разработки, поля (`FIELDS`/`OBJECT_FIELDS`), справочники по умолчанию. Новое поле карточки = добавить в `FIELDS` (сервер) и в `assets/js/deal.js` (форма).
- Запись в Blobs — только через `mutate*` из `netlify/lib/db.mts` (оптимистичная блокировка по ETag, повторы). Конфликты правок одного поля — через `fseq` + `baseSeq` (409).
- `getStore()` не кешировать между вызовами функции: токен Blobs выдаётся на вызов и истекает, «тёплый» экземпляр живёт дольше (было: через ~час все запросы → 500 «Token expired»). `store.mts` создаёт store на каждую операцию.

## Инварианты, которые нельзя ломать
- Синхронизация Telegram (`netlify/lib/sync.mts`): не меняет ручные статусы (`MANUAL_STATUSES`), авто-статус только вперёд по `AUTO_CHAIN`, не трогает ответственного и воронку, контакты/риски только дописывает, история без дублей. Скрипт синхронизации — запланированная задача Claude; клиентам ничего не отправляется.
- Воронка `archive` («Архив 2025») — замороженная история старой CRM: не попадает в «Сегодня», «Проекты», счётчики; без сигналов «без движения».
- Ключ подписи сессий — в Blobs (`config`, создаётся сервером; `CRM_SECRET` в окружении — необязательная замена). Ключ установки — только хешем (`SETUP_KEY_SHA256`). Открытые секреты не класть ни в код, ни в несекретные переменные Netlify. Данные клиентов в репозиторий не коммитить (репозиторий публичный).

## Прод живой
- https://w2w-crm.netlify.app, проект Netlify `w2w-crm` (команда abdumalikov-nn, бесплатный тариф: 300 кредитов/мес, production-деплой = 15 кредитов).
- Правки интерфейса — push в `main` (бесплатно через Pages). Деплой Netlify — только при изменениях в `netlify/` или `netlify.toml`, пачкой.
- Перед `POST /api/import` с `mode=replace` или массовыми правками — выгрузить `GET /api/export`. Ежедневная копия: `backup/<дата>` в Blobs (45 дней).

## Команды
- `npm test` — тесты API (node:test, `tests/api.test.mts`); перед коммитом изменений API — обязательно.
- `npm run dev` — локально на :8787 (данные `dev/.data`, ключ установки `dev-setup-key-dev-setup-key-0001`).
- Визуальная проверка — Playwright (Chromium предустановлен): вход, все виды, карточка, тёмная тема, ширина 390px.
