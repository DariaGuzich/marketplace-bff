import createClient from "openapi-fetch";
import type { components, paths } from "./schema.js";

// Тип настроек в том виде, в каком их отдаёт Marketplace API (snake_case).
// Берётся из сгенерированного schema.d.ts, руками не описывается.
export type ApiSettings = components["schemas"]["Settings"];

// Клиент знает все пути, параметры и тела запросов API из openapi.json:
// опечатка в пути или неверное поле в теле — ошибка компиляции.
export function createApiClient(baseUrl: string) {
  return createClient<paths>({ baseUrl });
}

export type ApiClient = ReturnType<typeof createApiClient>;
