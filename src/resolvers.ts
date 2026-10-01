import { randomUUID } from "node:crypto";
import { createGraphQLError } from "graphql-yoga";
import type { ApiClient, ApiSettings, ApiSettingsValues } from "./api/client.js";
import type { ReportingClient } from "./reporting/client.js";
import type { SettingsLoader } from "./settings-loader.js";

// Настройки в том виде, в каком их видит GraphQL (camelCase), см. schema.graphql.
// accountId в схеме у Settings нет: он нужен резолверу Settings.account, чтобы вернуться к аккаунту
type Settings = {
  floorPrice: number;
  currency: string;
  blockedDomains: string[];
  accountId: string;
};

type SettingsInput = Omit<Settings, "accountId">;

type Account = { id: string };

// Контекст создаётся заново на каждый GraphQL-запрос (server.ts)
export type Context = { settingsLoader: SettingsLoader };

export type ResolverOptions = {
  api: ApiClient;
  reporting: ReportingClient;
  // false — наивная реализация Account.settings: отдельный запрос в API на каждый аккаунт (N+1)
  useDataLoader: boolean;
  retryAttempts: number;
  retryDelayMs: number;
};

// Единственное место, где snake_case из API превращается в camelCase для GraphQL.
// Если API переименует поле, после npm run gen:api здесь упадёт проверка типов.
function fromApi(settings: Omit<ApiSettings, "version">, accountId: string): Settings {
  return {
    floorPrice: settings.floor_price,
    currency: settings.currency,
    blockedDomains: settings.blocked_domains,
    accountId,
  };
}

function toApi(settings: SettingsInput): ApiSettingsValues {
  return {
    floor_price: settings.floorPrice,
    currency: settings.currency,
    blocked_domains: settings.blockedDomains,
  };
}

export function createResolvers({ api, reporting, useDataLoader, retryAttempts, retryDelayMs }: ResolverOptions) {
  async function getSettings(accountId: string): Promise<Settings | null> {
    const { data, response } = await api.GET("/accounts/{account_id}/settings", {
      params: { path: { account_id: accountId } },
    });
    if (response.status === 404) {
      return null;
    }
    if (!data) {
      throw createGraphQLError(`Marketplace API responded with ${response.status}`);
    }
    return fromApi(data, accountId);
  }

  return {
    Query: {
      settings: (_parent: unknown, args: { accountId: string }) => getSettings(args.accountId),

      accounts: async (): Promise<Account[]> => {
        const { data, response } = await api.GET("/accounts");
        if (!data) {
          throw createGraphQLError(`Marketplace API responded with ${response.status}`);
        }
        return data.map((account) => ({ id: account.account_id }));
      },
    },

    Account: {
      settings: async (account: Account, _args: unknown, context: Context) => {
        if (!useDataLoader) {
          // Наивно: этот резолвер вызывается для КАЖДОГО аккаунта из списка, и каждый раз — запрос в API
          return getSettings(account.id);
        }
        // С DataLoader: вызовы для всех аккаунтов собираются в один batch-запрос
        const settings = await context.settingsLoader.load(account.id);
        return settings && fromApi(settings, account.id);
      },

      // Ошибка здесь не ломает весь ответ: поле report nullable, GraphQL вернёт report = null,
      // ошибку положит в errors, а остальные поля (id, settings) останутся в data
      report: async (account: Account) => {
        try {
          return await reporting.getReport(account.id);
        } catch (error) {
          throw createGraphQLError(`Reporting unavailable: ${(error as Error).message}`);
        }
      },
    },

    Settings: {
      account: (settings: Settings): Account => ({ id: settings.accountId }),
    },

    Mutation: {
      updateSettings: async (_parent: unknown, args: { accountId: string; input: SettingsInput }) => {
        const { data, response } = await api.PUT("/accounts/{account_id}/settings", {
          params: { path: { account_id: args.accountId } },
          body: toApi(args.input),
        });
        if (!data) {
          throw createGraphQLError(`Marketplace API responded with ${response.status}`);
        }
        return fromApi(data, args.accountId);
      },

      /**
       * Неидемпотентная операция в API, поэтому повторять её можно только с Idempotency-Key.
       * Ключ создаётся один раз на мутацию и одинаковый во всех попытках: если первая попытка дошла до API
       * и домен добавился, а ответ потерялся (таймаут, 5xx от прокси), повтор вернёт сохранённый ответ,
       * а не добавит домен второй раз.
       */
      addBlockedDomain: async (_parent: unknown, args: { accountId: string; domain: string }) => {
        const idempotencyKey = randomUUID();
        let lastError = "";

        for (let attempt = 1; attempt <= retryAttempts; attempt++) {
          let result;
          try {
            result = await api.POST("/accounts/{account_id}/blocked-domains", {
              params: { path: { account_id: args.accountId }, header: { "Idempotency-Key": idempotencyKey } },
              body: { domain: args.domain },
            });
          } catch (error) {
            lastError = (error as Error).message; // сетевая ошибка или таймаут — повторяем
          }
          if (result?.data) {
            return fromApi(result.data, args.accountId);
          }
          if (result && result.response.status < 500) {
            // 4xx (нет настроек, конфликт) повтор не исправит
            throw createGraphQLError(`Marketplace API responded with ${result.response.status}`);
          }
          if (result) {
            lastError = `status ${result.response.status}`; // 5xx — повторяем
          }
          console.warn(`addBlockedDomain attempt ${attempt}/${retryAttempts} failed (${lastError}), key ${idempotencyKey}`);
          if (attempt < retryAttempts) {
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          }
        }
        throw createGraphQLError(`Marketplace API unavailable after ${retryAttempts} attempts: ${lastError}`);
      },
    },
  };
}
