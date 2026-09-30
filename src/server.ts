import { readFileSync } from "node:fs";
import { createSchema, createYoga } from "graphql-yoga";
import { createApiClient } from "./api/client.js";
import { createResolvers } from "./resolvers.js";

const typeDefs = readFileSync(new URL("../schema.graphql", import.meta.url), "utf8");

// Собирает GraphQL-сервер. Адрес API передаётся снаружи, чтобы в тестах
// подставить адрес, который перехватывает MSW.
// Когда появится авторизация, здесь в context попадёт токен из запроса,
// а резолверы будут передавать его в Marketplace API.
export function createBff(apiUrl: string) {
  const api = createApiClient(apiUrl);
  return createYoga({
    schema: createSchema({ typeDefs, resolvers: createResolvers(api) }),
  });
}
