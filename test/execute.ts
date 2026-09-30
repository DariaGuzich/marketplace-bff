import { createBff } from "../src/server.js";

// Ненастоящий адрес: запросы на него перехватывает MSW
export const API_URL = "http://marketplace-api.test";

// Отправляет GraphQL-запрос в BFF без поднятия HTTP-сервера (yoga.fetch)
export async function executeGraphQL(query: string, variables: Record<string, unknown> = {}) {
  const bff = createBff(API_URL);
  const response = await bff.fetch("http://bff.test/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  return response.json();
}
