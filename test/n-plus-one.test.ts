import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ApiAccountSettings, ApiSettings } from "../src/api/client.js";
import type { components } from "../src/api/schema.js";
import { API_URL, executeGraphQL } from "./execute.js";

// N+1: запрос accounts { settings } при наивной реализации делает 1 запрос за списком
// и ещё по одному на каждый аккаунт. С DataLoader — 1 за списком и 1 batch за всеми настройками.

const ACCOUNTS = ["acc-a", "acc-b", "acc-c"];

function settingsOf(accountId: string): ApiSettings {
  return { floor_price: 1.5, currency: "USD", blocked_domains: [accountId + ".bad.com"], version: 0 };
}

// Сюда MSW записывает каждый запрос, который BFF отправил в API
let apiCalls: string[] = [];

const server = setupServer(
  http.get(`${API_URL}/accounts`, ({ request }) => {
    apiCalls.push(describeCall(request));
    const accounts: components["schemas"]["Account"][] = ACCOUNTS.map((id) => ({ account_id: id }));
    return HttpResponse.json(accounts);
  }),
  http.get(`${API_URL}/accounts/:accountId/settings`, ({ request, params }) => {
    apiCalls.push(describeCall(request));
    return HttpResponse.json(settingsOf(params.accountId as string));
  }),
  http.get(`${API_URL}/settings`, ({ request }) => {
    apiCalls.push(describeCall(request));
    const ids = new URL(request.url).searchParams.getAll("account_ids");
    const batch: ApiAccountSettings[] = ids.map((id) => ({ account_id: id, ...settingsOf(id) }));
    return HttpResponse.json(batch);
  }),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  apiCalls = [];
});
afterAll(() => server.close());

const QUERY = `query { accounts { id settings { blockedDomains } } }`;
const EXPECTED_DATA = {
  accounts: ACCOUNTS.map((id) => ({ id, settings: { blockedDomains: [id + ".bad.com"] } })),
};

describe("N+1", () => {
  it("without DataLoader: 1 + N requests to API", async () => {
    const result = await executeGraphQL(QUERY, {}, { useDataLoader: false });

    expect(result).toEqual({ data: EXPECTED_DATA });
    expect(apiCalls).toEqual([
      "GET /accounts",
      "GET /accounts/acc-a/settings",
      "GET /accounts/acc-b/settings",
      "GET /accounts/acc-c/settings",
    ]);
  });

  it("with DataLoader: 2 requests to API", async () => {
    const result = await executeGraphQL(QUERY, {}, { useDataLoader: true });

    expect(result).toEqual({ data: EXPECTED_DATA });
    expect(apiCalls).toEqual([
      "GET /accounts",
      "GET /settings?account_ids=acc-a&account_ids=acc-b&account_ids=acc-c",
    ]);
  });
});

afterEach(() => server.resetHandlers());

function describeCall(request: Request) {
  const url = new URL(request.url);
  return `${request.method} ${url.pathname}${url.search}`;
}
