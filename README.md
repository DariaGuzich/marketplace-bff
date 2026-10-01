# marketplace-bff

GraphQL-слой (Backend For Frontend) между UI и Marketplace API. Изолирует UI от изменений API:
UI видит только GraphQL-схему (`schema.graphql`). Изменения REST API BFF поглощает в резолверах.

```
marketplace-ui  →  marketplace-bff (этот репозиторий)  →  marketplace-api        (настройки, REST, snake_case)
                   GraphQL, camelCase                  →  marketplace-reporting  (статистика, Account.report)
```

## Как устроено

| Файл | Что это | Кто создаёт |
|---|---|---|
| `schema.graphql` | GraphQL-схема — контракт с UI | руками |
| `src/api/schema.d.ts` | TypeScript-типы REST API | **генерируется** `npm run gen:api`, руками не править |
| `src/api/client.ts` | типизированный клиент API (openapi-fetch) с таймаутом | руками |
| `src/reporting/client.ts` | клиент Reporting с таймаутом (тип ответа описан руками) | руками |
| `src/settings-loader.ts` | DataLoader: настройки многих аккаунтов одним batch-запросом | руками |
| `src/resolvers.ts` | резолверы: вызывают API и Reporting, snake_case ↔ camelCase, retry мутации | руками |
| `src/server.ts` | сборка GraphQL-сервера (Yoga), контекст запроса, лимиты GraphQL Armor | руками |
| `src/index.ts` | точка входа: порт и адрес API из переменных окружения | руками |

## Запуск

Нужен Node.js 22. Сначала запусти marketplace-api (порт 8080), затем:

```bash
npm install
npm start
```

| Переменная | По умолчанию | Что это |
|---|---|---|
| `PORT` | `4000` | порт BFF |
| `API_URL` | `http://localhost:8080` | адрес marketplace-api |
| `REPORTING_URL` | `http://localhost:8082` | адрес marketplace-reporting |
| `API_TIMEOUT_MS` / `REPORTING_TIMEOUT_MS` | `2000` / `1000` | таймауты вызовов |
| `USE_DATALOADER` | `true` | `false` — наивная реализация `Account.settings` (N+1) |
| `RETRY_ATTEMPTS` / `RETRY_DELAY_MS` | `3` / `200` | повторы мутации `addBlockedDomain` |
| `MAX_DEPTH` / `MAX_COST` | `6` / `1000` | лимиты GraphQL Armor |

PowerShell: `$env:PORT=4001; $env:API_URL="http://localhost:9090"; npm start`

Проверка: открой http://localhost:4000/graphql. Там GraphiQL, в нём можно выполнять запросы:

```graphql
mutation {
  updateSettings(accountId: "acc-1", input: { floorPrice: 1.5, currency: "USD", blockedDomains: ["bad.com"] }) {
    floorPrice currency blockedDomains
  }
}

query {
  settings(accountId: "acc-1") { floorPrice currency blockedDomains }
}
```

Для аккаунта без сохранённых настроек `settings` вернёт `null` (API в этом случае отвечает 404).

## N+1, лимиты, отказ сервиса, retry

Каждый вызов API и Reporting пишется в лог BFF: `[api] GET /accounts`, `[reporting] GET /reports/acc-1`.

### N+1 и DataLoader

Запрос `accounts { id settings { ... } }`: резолвер `Account.settings` вызывается **для каждого аккаунта
отдельно**. Наивно каждый вызов — запрос в API: 1 запрос за списком + N за настройками (**N+1**).
На 1000 аккаунтов — 1001 HTTP-запрос на один GraphQL-запрос.

**DataLoader** (`src/settings-loader.ts`) собирает все `load(accountId)`, сделанные в одном «тике» выполнения,
и вызывает batch-функцию один раз: `GET /settings?account_ids=a&account_ids=b&...`. Итог — **2 запроса**
при любом N. Для этого в API нужен batch-эндпоинт. DataLoader создаётся заново на каждый GraphQL-запрос
(в `context`), чтобы его кэш не смешивал данные разных запросов и пользователей.

`USE_DATALOADER=false` включает наивный вариант, чтобы сравнить. Автотест `test/n-plus-one.test.ts` считает
запросы, которые получил мок API: 1 + 3 против 2.

У `Account.report` тот же N+1 (запрос в Reporting на каждый аккаунт): batch-эндпоинта у Reporting нет,
это оставлено как есть.

### Лимиты глубины и сложности (GraphQL Armor)

Связь `Settings.account` и `Account.settings` образует цикл, поэтому клиент может прислать запрос любой
глубины: `accounts { settings { account { settings { account { ... } } } } }`. А с помощью псевдонимов
(aliases) — запрос любой ширины: `a1: settings(...) {...} a2: settings(...) {...} ...`. Один такой запрос
способен нагрузить BFF и API. Плагины GraphQL Armor проверяют запрос **до выполнения** и отклоняют его:

| Плагин | Лимит | Как считает |
|---|---|---|
| `maxDepthPlugin` | глубина 6 | число уровней вложенности, включая последнее скалярное поле |
| `costLimitPlugin` | стоимость 1000 | объект 2, скалярное поле 1, с множителем 1.5 за глубину. `settings(...) { 3 поля }` = 6.5, `accounts { id settings {3 поля} report {3 поля} }` = 23 |

Ответ на отклонённый запрос: `Syntax Error: Query depth limit of 6 exceeded, found 8.` или
`Query Cost limit of 1000 exceeded, found 1950.`. В API при этом не уходит ни одного запроса.
Introspection (её делает GraphiQL) лимитами не ограничивается.

Стоимость оценивается по запросу, а не по данным: `accounts` стоит одинаково для 3 и для 3000 аккаунтов.
Чтобы учитывать размер списков, нужна пагинация с лимитом (`accounts(first: 50)`).

### Отказ сервиса за BFF и таймауты

`Account.report` берётся из Reporting. Если Reporting упал или не ответил за `REPORTING_TIMEOUT_MS`,
резолвер бросает ошибку. Поле `report` nullable, поэтому GraphQL возвращает **частичный ответ**: настройки
в `data`, `report: null`, а ошибка — в `errors` с путём `["accounts", 0, "report"]`. Если бы поле было
`[HourlyStats!]!` (non-null), `null` поднялся бы до ближайшего nullable-родителя. Здесь `Account` в `[Account!]!`
и `accounts` тоже non-null, поэтому пропал бы весь ответ (`data: null`) из-за одного недоступного сервиса.
Nullable-поля — это места, где GraphQL может отдать частичный результат.

Без таймаута медленный Reporting задержал бы весь ответ, включая настройки. Автотест
`test/reporting-failure.test.ts`: Reporting отвечает 500 или через 1 с при таймауте 200 мс.

### Retry и идемпотентность (`addBlockedDomain`)

Добавление домена в API неидемпотентно. Если повторить запрос после таймаута, а первая попытка на самом
деле дошла, домен добавится дважды. Поэтому BFF:
- создаёт `Idempotency-Key` (UUID) **один раз на мутацию**;
- при сетевой ошибке, таймауте или 5xx повторяет запрос **с тем же ключом** (`RETRY_ATTEMPTS` попыток);
- 4xx не повторяет: повтор не исправит «нет настроек» или конфликт.

API по ключу узнаёт повтор и возвращает сохранённый ответ. Автотест `test/retry.test.ts`: первая попытка
дошла до API (домен добавлен), но ответ потерялся (503). Повтор с тем же ключом → домен добавлен один раз.

`updateSettings` (PUT) не повторяется автоматически. PUT идемпотентен, но повтор после потерянного ответа
может перезаписать чужое изменение, сделанное между попытками. Решение — передавать `version`, это
оставлено на потом.

## Команды

| Команда | Что делает |
|---|---|
| `npm start` | запускает BFF |
| `npm run gen:api` | скачивает `openapi.json` из main marketplace-api и генерирует `src/api/schema.d.ts` |
| `npm run typecheck` | проверка типов (`tsc`) всего кода, включая тесты |
| `npm test` | тесты (vitest) |
| `npm run schema:diff` | GraphQL Inspector: сравнить `schema.graphql` с версией в `origin/main` |

Тесты (все с MSW): `resolvers.*-mock.test.ts` (базовые, два варианта моков), `n-plus-one.test.ts`,
`limits.test.ts`, `reporting-failure.test.ts`, `retry.test.ts`.

После `npm run gen:api` посмотри `git diff src/api/schema.d.ts`: там видно, что поменялось в контракте API.
Если что-то поменялось, закоммить файл.

## Тесты: два варианта моков

Резолверы тестируются без настоящего API: MSW перехватывает HTTP-запросы BFF и отдаёт заготовленные ответы.
Одни и те же три теста написаны дважды:

- `test/resolvers.untyped-mock.test.ts` — ответ API в моке записан обычным JSON-объектом, без типов.
- `test/resolvers.typed-mock.test.ts` — ответ API в моке объявлен как `ApiSettings` (тип из сгенерированного `schema.d.ts`).

Разница видна только при проверке типов. Если API поменяет поле, то после `npm run gen:api`:
- `npm run typecheck` упадёт на моке с типами: он больше не соответствует API;
- мок без типов останется старым и ничего не скажет;
- `npm test` может остаться зелёным в **обоих** вариантах: vitest выполняет TypeScript, но типы не проверяет.

Какой вариант что ловит в каждом конкретном случае — см. `EXPERIMENTS.md` в marketplace-api.

## CI (`.github/workflows/ci.yml`)

| Job | Когда | Что делает |
|---|---|---|
| `check` | push в main, PR, вручную, раз в сутки | `npm ci` → `gen:api` (свежая спецификация) → предупреждение, если контракт изменился → `typecheck` → `test` |
| `schema-breaking-changes` | только PR | GraphQL Inspector сравнивает `schema.graphql` ветки PR со схемой в main |

### Почему изменение в API само не запускает CI BFF

GitHub Actions запускает workflow по событиям **своего** репозитория: push, PR, ручной запуск, расписание.
Push в marketplace-api — событие другого репозитория, CI BFF о нём не знает. Поэтому возможна ситуация:
API поменяли, CI API зелёный, main BFF уже не работает с новым API, но никто этого не видит.

Как с этим справляемся:
- **расписание** (`schedule`, раз в сутки) — поломка найдётся не позже чем через сутки;
- **ручной запуск** (`workflow_dispatch`, кнопка *Run workflow* на вкладке Actions) — проверить сразу после изменения API.

Как ещё это решают (не сделано, чтобы не усложнять): CI API после merge вызывает CI BFF через
`repository_dispatch` (нужен токен с доступом к другому репозиторию), или контрактные тесты (Pact) —
тогда API сам проверяет ожидания BFF до merge.

GitHub отключает `schedule` в публичном репозитории, если в нём 60 дней не было активности. Тогда его
включают снова на вкладке Actions.

## Инструменты: зачем каждый

- **GraphQL Yoga** — GraphQL-сервер. Выбран вместо Apollo Server, потому что проще: одна функция `createYoga`,
  работает поверх стандартных `Request`/`Response`, поэтому в тестах запрос отправляется через `yoga.fetch()`
  без поднятия HTTP-сервера, а GraphiQL встроен. Возможности Apollo (федерация, Apollo Studio) нам не нужны.
- **openapi-typescript** — превращает `openapi.json` в TypeScript-типы. Проблема, которую решает: типы ответа
  API, описанные руками, устаревают незаметно, а сгенерированные всегда совпадают со спецификацией.
- **openapi-fetch** — тонкая обёртка над `fetch`, использующая эти типы: путь, параметры и тело запроса проверяются
  компилятором, а `data` в ответе имеет правильный тип.
- **TypeScript (`tsc --noEmit`)** — место, где изменение API превращается в красный CI.
- **Vitest** — запуск тестов. Типы не проверяет, это делает `tsc`.
- **MSW (Mock Service Worker)** — перехватывает настоящие HTTP-запросы на уровне `fetch`. Код BFF не знает,
  что его тестируют: он ходит в «API» как обычно, мок подставляется снаружи.
- **GraphQL Inspector** — знает правила совместимости GraphQL: удалить поле, сделать поле ответа nullable,
  добавить обязательный аргумент — breaking change; добавить поле или пометить `@deprecated` — нет.
  Проблема, которую решает: CI BFF зелёный, а UI, который использует удалённое поле, ломается.
- **tsx** — запускает TypeScript напрямую, без отдельного шага сборки.
- **DataLoader** — группирует загрузки в batch-запросы (N+1 → 2).
- **GraphQL Armor** (`max-depth`, `cost-limit`) — отклоняет слишком глубокие и слишком дорогие запросы до выполнения.

**Почему graphql 16, а не 17.** Плагины GraphQL Armor зависят от graphql 16 как от обычной зависимости. С graphql 17
в проекте оказались бы две копии библиотеки, и проверка запроса падала бы на объектах «из чужой копии».
Отсюда же `createGraphQLError` из `graphql-yoga` вместо `new GraphQLError` из `graphql`: у graphql 16 есть
две сборки (CommonJS и ESM), и Yoga, проверяя тип ошибки, не узнавал ошибку из другой сборки. Он заменял её
текст на `Unexpected error.`.

## Куда встроится то, что будет позже

- **Auth** — в `src/server.ts` в `context` Yoga попадёт токен из заголовка запроса, резолверы передадут его в API.
- **Pact** — тесты BFF будут записывать ожидания к API в контракт, API будет проверять его в своём CI.

## Эксперименты

См. [EXPERIMENTS.md](https://github.com/DariaGuzich/marketplace-api/blob/main/EXPERIMENTS.md) в marketplace-api.
