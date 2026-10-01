import createClient from "openapi-fetch";
import type { components, paths } from "./schema.js";

// Типы Marketplace API (snake_case): ответ с настройками (значения + version) и тело запроса PUT.
// Берётся из сгенерированного schema.d.ts, руками не описывается.
export type ApiSettings = components["schemas"]["Settings"];
export type ApiSettingsValues = components["schemas"]["SettingsValues"];

// Клиент знает все пути, параметры и тела запросов API из openapi.json:
// опечатка в пути или неверное поле в теле — ошибка компиляции.
export function createApiClient(baseUrl: string) {
  return createClient<paths>({ baseUrl });
}

export type ApiClient = ReturnType<typeof createApiClient>;
