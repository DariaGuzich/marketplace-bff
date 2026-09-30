# marketplace-bff

GraphQL-слой (Backend For Frontend) между UI и Marketplace API. Изолирует UI от изменений API:
UI видит только GraphQL-схему (`schema.graphql`). Изменения REST API BFF поглощает в резолверах.

```
marketplace-ui  →  marketplace-bff (этот репозиторий)  →  marketplace-api
                   GraphQL, camelCase                     REST, snake_case
```

## Как устроено

| Файл | Что это | Кто создаёт |
|---|---|---|
| `schema.graphql` | GraphQL-схема — контракт с UI | руками |
| `src/api/schema.d.ts` | TypeScript-типы REST API | **генерируется** `npm run gen:api`, руками не править |
| `src/api/client.ts` | типизированный клиент API (openapi-fetch) | руками |
| `src/resolvers.ts` | резолверы: вызывают API, snake_case ↔ camelCase | руками |
| `src/server.ts` | сборка GraphQL-сервера (Yoga) | руками |
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

## Команды

| Команда | Что делает |
|---|---|
| `npm start` | запускает BFF |
| `npm run gen:api` | скачивает `openapi.json` из main marketplace-api и генерирует `src/api/schema.d.ts` |
| `npm run typecheck` | проверка типов (`tsc`) всего кода, включая тесты |
| `npm test` | тесты (vitest) |
| `npm run schema:diff` | GraphQL Inspector: сравнить `schema.graphql` с версией в `origin/main` |

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

## Куда встроится то, что будет позже

- **Auth** — в `src/server.ts` в `context` Yoga попадёт токен из заголовка запроса, резолверы передадут его в API.
- **Pact** — тесты BFF будут записывать ожидания к API в контракт, API будет проверять его в своём CI.
- **Reporting** — ещё один клиент рядом с `src/api/` и новые поля/резолверы в схеме.

## Эксперименты

См. [EXPERIMENTS.md](https://github.com/DariaGuzich/marketplace-api/blob/main/EXPERIMENTS.md) в marketplace-api.
