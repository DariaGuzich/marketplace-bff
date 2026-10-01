import createClient from "openapi-fetch";
import type { components, paths } from "./schema.js";

// Типы Marketplace API (snake_case). Берутся из сгенерированного schema.d.ts, руками не описываются.
export type ApiSettings = components["schemas"]["Settings"];
export type ApiSettingsValues = components["schemas"]["SettingsValues"];
export type ApiAccountSettings = components["schemas"]["AccountSettings"];

// Клиент знает все пути, параметры и тела запросов API из openapi.json:
// опечатка в пути или неверное поле в теле — ошибка компиляции.
// Каждый запрос ограничен по времени: если API не ответил за timeoutMs, запрос прерывается с ошибкой.
export function createApiClient(baseUrl: string, timeoutMs: number) {
  return createClient<paths>({
    baseUrl,
    fetch: (request) => {
      logUpstreamCall("api", request);
      return fetch(request, { signal: AbortSignal.timeout(timeoutMs) });
    },
  });
}

export type ApiClient = ReturnType<typeof createApiClient>;

// Каждый вызов соседнего сервиса — строка в логе: так при ручной проверке видно N+1 и повторы.
// В тестах (vitest выставляет NODE_ENV=test) лог отключён, запросы там считает MSW.
export function logUpstreamCall(service: string, request: Request) {
  if (process.env.NODE_ENV !== "test") {
    const url = new URL(request.url);
    console.log(`[${service}] ${request.method} ${url.pathname}${url.search}`);
  }
}
