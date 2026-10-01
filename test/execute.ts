import { type BffOptions, createBff } from "../src/server.js";

// Ненастоящие адреса: запросы на них перехватывает MSW
export const API_URL = "http://marketplace-api.test";
export const REPORTING_URL = "http://marketplace-reporting.test";

export const TEST_OPTIONS: BffOptions = {
  apiUrl: API_URL,
  reportingUrl: REPORTING_URL,
  apiTimeoutMs: 500,
  reportingTimeoutMs: 200,
  useDataLoader: true,
  retryAttempts: 3,
  retryDelayMs: 1,
  maxDepth: 6,
  maxCost: 1000,
};

// Отправляет GraphQL-запрос в BFF без поднятия HTTP-сервера (yoga.fetch).
// options — что поменять относительно TEST_OPTIONS (например, { useDataLoader: false })
export async function executeGraphQL(
  query: string,
  variables: Record<string, unknown> = {},
  options: Partial<BffOptions> = {},
) {
  const bff = createBff({ ...TEST_OPTIONS, ...options });
  const response = await bff.fetch("http://bff.test/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  return response.json();
}
