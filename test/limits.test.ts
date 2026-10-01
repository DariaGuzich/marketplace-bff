import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { API_URL, executeGraphQL } from "./execute.js";

// GraphQL Armor: лимиты глубины (maxDepth = 6) и сложности (maxCost = 1000) в TEST_OPTIONS.
// Отклонённый запрос не доходит до резолверов, поэтому в API не уходит ни одного запроса.

let apiCalls = 0;

const server = setupServer(
  http.get(`${API_URL}/accounts/:accountId/settings`, () => {
    apiCalls++;
    return new HttpResponse(null, { status: 404 });
  }),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  apiCalls = 0;
});
afterAll(() => server.close());

describe("query limits", () => {
  it("normal query passes", async () => {
    const result = await executeGraphQL(`query { settings(accountId: "acc-1") { floorPrice currency } }`);

    expect(result).toEqual({ data: { settings: null } });
    expect(apiCalls).toBe(1);
  });

  it("query deeper than the limit is rejected before execution", async () => {
    // Цикл Settings.account → Account.settings позволяет строить запрос любой глубины.
    // Armor считает глубину вместе с последним скалярным полем: здесь 8 при лимите 6
    const result = await executeGraphQL(`
      query {
        accounts {                                  # 1
          settings {                                # 2
            account {                               # 3
              settings {                            # 4
                account {                           # 5
                  settings {                        # 6
                    account {                       # 7
                      id                    # 8
                    }
                  }
                }
              }
            }
          }
        }
      }
    `);

    expect(result.data).toBeUndefined();
    expect(result.errors[0].message).toMatch(/depth limit/i);
    expect(apiCalls).toBe(0);
  });

  it("too expensive query is rejected even within the depth limit", async () => {
    // Неглубокий, но широкий запрос: 300 копий одного поля через псевдонимы (aliases).
    // Одна копия стоит 6.5 (объект 2 + 3 скалярных поля × 1.5), 300 копий — 1950 при лимите 1000.
    // Для сравнения: accounts { id settings {...} report {...} } стоит 23
    const fields = Array.from({ length: 300 }, (_, i) => `s${i}: settings(accountId: "acc-${i}") { floorPrice currency blockedDomains }`);
    const result = await executeGraphQL(`query { ${fields.join("\n")} }`);

    expect(result.data).toBeUndefined();
    expect(result.errors[0].message).toMatch(/cost/i);
    expect(apiCalls).toBe(0);
  });
});
