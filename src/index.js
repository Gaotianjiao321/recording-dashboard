import { createServer } from "node:http";
import { loadEnvFile } from "./env.js";
import { createApp } from "./server.js";

loadEnvFile();

const port = Number(process.env.PORT ?? 5174);
const app = await createApp();

createServer(app).listen(port, () => {
  console.log(`Recording dashboard listening on http://localhost:${port}`);
});
