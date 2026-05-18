import { createServer } from "node:http";
import { createApp } from "./server.js";

const port = Number(process.env.PORT ?? 5174);
const app = await createApp();

createServer(app).listen(port, () => {
  console.log(`Recording dashboard listening on http://localhost:${port}`);
});
