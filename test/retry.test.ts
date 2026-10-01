import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ApiSettings } from "../src/api/client.js";
import { API_URL, executeGraphQL } from "./execute.js";

// Retry мутации addBlockedDomain с Idempotency-Key.
// Мок API ведёт себя как настоящий marketplace-api: хранит ответы по ключу и на повтор с тем же ключом
// возвращает сохранённый ответ, не добавляя домен ещё раз.

let blockedDomains: string[];
let receivedKeys: (string | null)[];
let storedResponses: Map<string, ApiSettings>;
// Как ответить на очередную попытку после того, как домен обработан: "ok" или код ошибки
let responsePlan: ("ok" | 503)[];

const server = setupServer(
  http.post(`${API_URL}/accounts/:accountId/blocked-domains`, async ({ request }) => {
    const key = request.headers.get("Idempotency-Key");
    receivedKeys.push(key);

    let settings = key ? storedResponses.get(key) : undefined;
    if (!settings) {
      const { domain } = (await request.json()) as { domain: string };
      blockedDomains.push(domain);
      settings = { floor_price: 1.5, currency: "USD", blocked_domains: [...blockedDomains], version: blockedDomains.length };
      if (key) storedResponses.set(key, settings);
    }

    const plan = responsePlan.shift() ?? "ok";
    // 503 ПОСЛЕ обработки: API домен добавил, но ответ до BFF не дошёл (например, ошибка прокси)
    return plan === "ok" ? HttpResponse.json(settings) : new HttpResponse(null, { status: plan });
  }),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  blockedDomains = [];
  receivedKeys = [];
  storedResponses = new Map();
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const MUTATION = `mutation { addBlockedDomain(accountId: "acc-1", domain: "bad.com") { blockedDomains } }`;

describe("addBlockedDomain retry", () => {
  it("first response lost, retry with the same key: domain is added once", async () => {
    responsePlan = [503, "ok"];

    const result = await executeGraphQL(MUTATION);

    expect(result).toEqual({ data: { addBlockedDomain: { blockedDomains: ["bad.com"] } } });
    expect(receivedKeys).toHaveLength(2);
    expect(receivedKeys[0]).toBeTruthy();
    expect(receivedKeys[1]).toBe(receivedKeys[0]);
    expect(blockedDomains).toEqual(["bad.com"]);
  });

  it("each mutation gets its own key", async () => {
    responsePlan = ["ok", "ok"];

    await executeGraphQL(MUTATION);
    await executeGraphQL(MUTATION);

    expect(new Set(receivedKeys).size).toBe(2);
    expect(blockedDomains).toEqual(["bad.com", "bad.com"]);
  });

  it("gives up after all attempts and returns an error", async () => {
    responsePlan = [503, 503, 503];

    const result = await executeGraphQL(MUTATION);

    expect(result.errors[0].message).toContain("unavailable after 3 attempts");
    expect(receivedKeys).toHaveLength(3);
  });

  it("4xx is not retried", async () => {
    server.use(http.post(`${API_URL}/accounts/:accountId/blocked-domains`, () => {
      receivedKeys.push("x");
      return new HttpResponse(null, { status: 404 });
    }));

    const result = await executeGraphQL(MUTATION);

    expect(result.errors[0].message).toContain("responded with 404");
    expect(receivedKeys).toHaveLength(1);
  });
});
