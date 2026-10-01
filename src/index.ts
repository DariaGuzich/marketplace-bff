import { createServer } from "node:http";
import { createBff } from "./server.js";

const port = Number(process.env.PORT ?? 4000);
const options = {
  apiUrl: process.env.API_URL ?? "http://localhost:8080",
  reportingUrl: process.env.REPORTING_URL ?? "http://localhost:8082",
  apiTimeoutMs: Number(process.env.API_TIMEOUT_MS ?? 2000),
  reportingTimeoutMs: Number(process.env.REPORTING_TIMEOUT_MS ?? 1000),
  useDataLoader: (process.env.USE_DATALOADER ?? "true") === "true",
  retryAttempts: Number(process.env.RETRY_ATTEMPTS ?? 3),
  retryDelayMs: Number(process.env.RETRY_DELAY_MS ?? 200),
  maxDepth: Number(process.env.MAX_DEPTH ?? 6),
  maxCost: Number(process.env.MAX_COST ?? 1000),
};

createServer(createBff(options)).listen(port, () => {
  console.log(`BFF: http://localhost:${port}/graphql`);
  console.log(options);
});
