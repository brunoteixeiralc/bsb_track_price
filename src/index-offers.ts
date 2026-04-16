import dotenv from "dotenv";
dotenv.config();

import { trackRssFeed } from "./services/news";
import { initTables } from "./services/db";

async function main() {
  try {
    await initTables();
    
    await trackRssFeed({
      rssUrl: "https://queroviajarnafaixa.com.br/category/ofertas/feed/",
      keywords: [], // aceita todas as ofertas — feed já filtrado pela categoria
      feedName: "offers",
    });
    
    console.log("✅ Busca de ofertas concluída.");
    process.exit(0);
  } catch (err) {
    console.error(`[offers] Erro fatal: ${(err as Error).message ?? String(err)}`);
    process.exit(1);
  }
}

main();
