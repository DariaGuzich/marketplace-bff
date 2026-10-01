import { logUpstreamCall } from "../api/client.js";

// Ответ marketplace-reporting GET /reports/{account_id}.
// У Reporting нет OpenAPI-спецификации, поэтому тип описан руками: если Reporting изменит формат,
// проверка типов этого не заметит (как мок без типов в тестах).
export type ReportingHourlyStats = {
  hour: string;
  requests: number;
  shown: number;
};

export function createReportingClient(baseUrl: string, timeoutMs: number) {
  return {
    async getReport(accountId: string): Promise<ReportingHourlyStats[]> {
      const request = new Request(`${baseUrl}/reports/${encodeURIComponent(accountId)}`);
      logUpstreamCall("reporting", request);
      // Таймаут: без него медленный Reporting задержал бы весь GraphQL-ответ, включая настройки
      const response = await fetch(request, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) {
        throw new Error(`Reporting responded with ${response.status}`);
      }
      return (await response.json()) as ReportingHourlyStats[];
    },
  };
}

export type ReportingClient = ReturnType<typeof createReportingClient>;
