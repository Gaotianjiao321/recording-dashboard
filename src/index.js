import { createServer } from "node:http";
import { loadEnvFile } from "node:process";
import { createApp } from "./server.js";

try {
  loadEnvFile(".env");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const port = Number(process.env.PORT ?? 5174);
const app = await createApp();

createServer(app).listen(port, () => {
  console.log(`Recording dashboard listening on http://localhost:${port}`);
});
