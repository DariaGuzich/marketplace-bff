import { delay, http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ApiAccountSettings } from "../src/api/client.js";
import type { components } from "../src/api/schema.js";
import type { ReportingHourlyStats } from "../src/reporting/client.js";
import { API_URL, executeGraphQL, REPORTING_URL } from "./execute.js";

// Отказ одного из сервисов за BFF: Reporting падает или отвечает дольше таймаута (200 мс в TEST_OPTIONS).
// Ответ всё равно содержит настройки из API, а report = null с ошибкой в errors (частичный ответ).

const accounts: components["schemas"]["Account"][] = [{ account_id: "acc-a" }];
const settings: ApiAccountSettings[] = [
  { account_id: "acc-a", floor_price: 1.5, currency: "USD", blocked_domains: [], version: 0 },
];
const report: ReportingHourlyStats[] = [{ hour: "2026-10-01T10:00:00Z", requests: 3, shown: 2 }];

const server = setupServer(
  http.get(`${API_URL}/accounts`, () => HttpResponse.json(accounts)),
  http.get(`${API_URL}/settings`, () => HttpResponse.json(settings)),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const QUERY = `query { accounts { id settings { floorPrice } report { hour requests shown } } }`;

describe("Reporting failure", () => {
  it("report is returned when Reporting works", async () => {
    server.use(http.get(`${REPORTING_URL}/reports/:accountId`, () => HttpResponse.json(report)));

    const result = await executeGraphQL(QUERY);

    expect(result).toEqual({
      data: { accounts: [{ id: "acc-a", settings: { floorPrice: 1.5 }, report }] },
    });
  });

  it("Reporting error: settings are returned, report is null with an error", async () => {
    server.use(http.get(`${REPORTING_URL}/reports/:accountId`, () => new HttpResponse(null, { status: 500 })));

    const result = await executeGraphQL(QUERY);

    expect(result.data).toEqual({ accounts: [{ id: "acc-a", settings: { floorPrice: 1.5 }, report: null }] });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].path).toEqual(["accounts", 0, "report"]);
    expect(result.errors[0].message).toContain("Reporting unavailable");
  });

  it("Reporting slower than timeout: same partial response", async () => {
    server.use(
      http.get(`${REPORTING_URL}/reports/:accountId`, async () => {
        await delay(1000);
        return HttpResponse.json(report);
      }),
    );

    const startedAt = Date.now();
    const result = await executeGraphQL(QUERY);

    expect(result.data.accounts[0].settings).toEqual({ floorPrice: 1.5 });
    expect(result.data.accounts[0].report).toBeNull();
    expect(result.errors[0].path).toEqual(["accounts", 0, "report"]);
    // BFF не ждал секунду: ответ пришёл примерно через таймаут (200 мс)
    expect(Date.now() - startedAt).toBeLessThan(900);
  });
});
