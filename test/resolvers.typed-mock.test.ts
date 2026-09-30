import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ApiSettings } from "../src/api/client.js";
import { API_URL, executeGraphQL } from "./execute.js";

// Вариант 2: мок API на сгенерированных OpenAPI-типах.
// Данные мока объявлены как ApiSettings. Если API изменится и после npm run gen:api
// тип станет другим, npm run typecheck упадёт прямо на этих объектах.
// Важно: vitest сам типы не проверяет, эту работу делает tsc.

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("resolvers (typed mock)", () => {
  it("settings: maps API response to camelCase", async () => {
    const apiSettings: ApiSettings = { floor_price: 1.5, currency: "USD", blocked_domains: ["bad.com"] };
    server.use(http.get(`${API_URL}/accounts/:accountId/settings`, () => HttpResponse.json(apiSettings)));

    const result = await executeGraphQL(`
      query { settings(accountId: "acc-1") { floorPrice currency blockedDomains } }
    `);

    expect(result).toEqual({
      data: { settings: { floorPrice: 1.5, currency: "USD", blockedDomains: ["bad.com"] } },
    });
  });

  it("settings: returns null when API responds 404", async () => {
    server.use(
      http.get(`${API_URL}/accounts/:accountId/settings`, () => new HttpResponse(null, { status: 404 })),
    );

    const result = await executeGraphQL(`query { settings(accountId: "acc-1") { currency } }`);

    expect(result).toEqual({ data: { settings: null } });
  });

  it("updateSettings: sends snake_case body to API", async () => {
    const expectedBody: ApiSettings = { floor_price: 2, currency: "EUR", blocked_domains: [] };
    let receivedBody: unknown;
    server.use(
      http.put(`${API_URL}/accounts/:accountId/settings`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(expectedBody);
      }),
    );

    const result = await executeGraphQL(
      `mutation($input: SettingsInput!) {
        updateSettings(accountId: "acc-1", input: $input) { floorPrice currency blockedDomains }
      }`,
      { input: { floorPrice: 2, currency: "EUR", blockedDomains: [] } },
    );

    expect(receivedBody).toEqual(expectedBody);
    expect(result).toEqual({
      data: { updateSettings: { floorPrice: 2, currency: "EUR", blockedDomains: [] } },
    });
  });
});
