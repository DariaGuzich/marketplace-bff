import DataLoader from "dataloader";
import { createGraphQLError } from "graphql-yoga";
import type { ApiAccountSettings, ApiClient } from "./api/client.js";

/**
 * DataLoader для настроек аккаунтов. Резолвер Account.settings вызывается отдельно для каждого аккаунта,
 * но вызовы load(id) в рамках одного «тика» собираются вместе, и в API уходит ОДИН batch-запрос:
 * GET /settings?account_ids=a,b,c. Без этого был бы запрос на каждый аккаунт (N+1).
 *
 * Создаётся заново на каждый GraphQL-запрос (см. context в server.ts): кэш DataLoader не должен
 * переживать запрос, иначе один пользователь увидел бы данные, закэшированные для другого.
 */
export function createSettingsLoader(api: ApiClient) {
  return new DataLoader<string, ApiAccountSettings | null>(async (accountIds) => {
    const { data, response } = await api.GET("/settings", {
      params: { query: { account_ids: [...accountIds] } },
    });
    if (!data) {
      throw createGraphQLError(`Marketplace API responded with ${response.status}`);
    }
    // DataLoader требует ответ той же длины и в том же порядке, что и ключи;
    // аккаунты без настроек API не вернул — для них null
    const byId = new Map(data.map((settings) => [settings.account_id, settings]));
    return accountIds.map((id) => byId.get(id) ?? null);
  });
}

export type SettingsLoader = ReturnType<typeof createSettingsLoader>;
