import { readFileSync } from "node:fs";
import { costLimitPlugin } from "@escape.tech/graphql-armor-cost-limit";
import { maxDepthPlugin } from "@escape.tech/graphql-armor-max-depth";
import { createSchema, createYoga } from "graphql-yoga";
import { createApiClient } from "./api/client.js";
import { createReportingClient } from "./reporting/client.js";
import { type Context, createResolvers } from "./resolvers.js";
import { createSettingsLoader } from "./settings-loader.js";

const typeDefs = readFileSync(new URL("../schema.graphql", import.meta.url), "utf8");

export type BffOptions = {
  apiUrl: string;
  reportingUrl: string;
  apiTimeoutMs: number;
  reportingTimeoutMs: number;
  useDataLoader: boolean;
  retryAttempts: number;
  retryDelayMs: number;
  maxDepth: number;
  maxCost: number;
};

// Собирает GraphQL-сервер. Адреса соседей передаются снаружи, чтобы в тестах
// подставить адреса, которые перехватывает MSW.
export function createBff(options: BffOptions) {
  const api = createApiClient(options.apiUrl, options.apiTimeoutMs);
  const reporting = createReportingClient(options.reportingUrl, options.reportingTimeoutMs);

  return createYoga<Context>({
    schema: createSchema<Context>({
      typeDefs,
      resolvers: createResolvers({ api, reporting, ...options }),
    }),
    // Новый контекст (и новый DataLoader) на каждый запрос.
    // Когда появится авторизация, сюда же попадёт токен из заголовка запроса.
    context: () => ({ settingsLoader: createSettingsLoader(api) }),
    // GraphQL Armor: запрос проверяется ДО выполнения резолверов и отклоняется, если он
    // слишком глубокий или слишком «дорогой». Без этого клиент одним запросом
    // account { settings { account { settings ... } } } может нагрузить BFF и API сколько угодно.
    plugins: [
      maxDepthPlugin({ n: options.maxDepth }),
      costLimitPlugin({ maxCost: options.maxCost }),
    ],
  });
}
