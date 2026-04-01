import dotenv from "dotenv";
dotenv.config();

import path from "path";
import { trackRssFeed } from "./services/news";

trackRssFeed({
  rssUrl: "https://queroviajarnafaixa.com.br/category/ofertas/feed/",
  keywords: [], // aceita todas as ofertas — feed já filtrado pela categoria
  seenDbPath: path.join(process.cwd(), "data", "offers-seen.json"),
  feedName: "offers",
}).catch((err) => {
  console.error("[offers] Erro fatal:", err);
  process.exit(1);
});
