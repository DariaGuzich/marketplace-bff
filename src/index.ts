import { createServer } from "node:http";
import { createBff } from "./server.js";

const port = Number(process.env.PORT ?? 4000);
const apiUrl = process.env.API_URL ?? "http://localhost:8080";

createServer(createBff(apiUrl)).listen(port, () => {
  console.log(`BFF: http://localhost:${port}/graphql (Marketplace API: ${apiUrl})`);
});
