import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { API_URL, executeGraphQL } from "./execute.js";

// Вариант 1: мок API — обычный JSON без типов.
// TypeScript не знает, как должен выглядеть ответ API, поэтому если API изменится,
// мок останется старым, а тесты продолжат проходить.

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("resolvers (untyped mock)", () => {
  it("settings: maps API response to camelCase", async () => {
    server.use(
      http.get(`${API_URL}/accounts/:accountId/settings`, () =>
        HttpResponse.json({ floor_price: 1.5, currency: "USD", blocked_domains: ["bad.com"] }),
      ),
    );

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
    let receivedBody: unknown;
    server.use(
      http.put(`${API_URL}/accounts/:accountId/settings`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({ floor_price: 2, currency: "EUR", blocked_domains: [] });
      }),
    );

    const result = await executeGraphQL(
      `mutation($input: SettingsInput!) {
        updateSettings(accountId: "acc-1", input: $input) { floorPrice currency blockedDomains }
      }`,
      { input: { floorPrice: 2, currency: "EUR", blockedDomains: [] } },
    );

    expect(receivedBody).toEqual({ floor_price: 2, currency: "EUR", blocked_domains: [] });
    expect(result).toEqual({
      data: { updateSettings: { floorPrice: 2, currency: "EUR", blockedDomains: [] } },
    });
  });
});
