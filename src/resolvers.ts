import { GraphQLError } from "graphql";
import type { ApiClient, ApiSettings } from "./api/client.js";

// Настройки в том виде, в каком их видит GraphQL (camelCase), см. schema.graphql
type Settings = {
  floorPrice: number;
  currency: string;
  blockedDomains: string[];
};

// Единственное место, где snake_case из API превращается в camelCase для GraphQL.
// Если API переименует поле, после npm run gen:api здесь упадёт проверка типов.
function fromApi(settings: ApiSettings): Settings {
  return {
    floorPrice: settings.floor_price,
    currency: settings.currency,
    blockedDomains: settings.blocked_domains,
  };
}

function toApi(settings: Settings): ApiSettings {
  return {
    floor_price: settings.floorPrice,
    currency: settings.currency,
    blocked_domains: settings.blockedDomains,
  };
}

export function createResolvers(api: ApiClient) {
  return {
    Query: {
      settings: async (_parent: unknown, args: { accountId: string }) => {
        const { data, response } = await api.GET("/accounts/{account_id}/settings", {
          params: { path: { account_id: args.accountId } },
        });
        if (response.status === 404) {
          return null;
        }
        if (!data) {
          throw new GraphQLError(`Marketplace API responded with ${response.status}`);
        }
        return fromApi(data);
      },
    },
    Mutation: {
      updateSettings: async (_parent: unknown, args: { accountId: string; input: Settings }) => {
        const { data, response } = await api.PUT("/accounts/{account_id}/settings", {
          params: { path: { account_id: args.accountId } },
          body: toApi(args.input),
        });
        if (!data) {
          throw new GraphQLError(`Marketplace API responded with ${response.status}`);
        }
        return fromApi(data);
      },
    },
  };
}
