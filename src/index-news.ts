import dotenv from "dotenv";
dotenv.config();

import { runNewsTracker } from "./services/news";

runNewsTracker().catch((err) => {
  console.error(`[news] Erro fatal: ${(err as Error).message ?? String(err)}`);
  process.exit(1);
});
