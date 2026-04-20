import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import { 
  parseRssItems, 
  isKeywordRelated, 
  buildNewsMessage, 
  runNewsTracker, 
  trackRssFeed, 
  shouldSummarize, 
  fetchArticleText, 
  summarizeArticle, 
  RssItem 
} from "../services/news";
import * as dbService from "../services/db";

process.env.TELEGRAM_BOT_TOKEN = "test-token";
process.env.TELEGRAM_CHAT_ID = "123456";

const mock = new MockAdapter(axios);

const RSS_WITH_MILHA = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title><![CDATA[Smiles lança promoção de transferência de milhas com bônus de 100%]]></title>
      <link>https://passageirodeprimeira.com/smiles-bonus-100</link>
      <guid>https://passageirodeprimeira.com/smiles-bonus-100</guid>
      <description><![CDATA[A Smiles anunciou hoje uma promoção com bônus de 100%...]]></description>
    </item>
  </channel>
</rss>`;

describe("News Service (Turso Sync)", () => {
  beforeEach(() => {
    mock.reset();
    jest.clearAllMocks();
  });

  describe("parseRssItems", () => {
    it("extrai dados corretamente do XML", () => {
      const items = parseRssItems(RSS_WITH_MILHA);
      expect(items).toHaveLength(1);
      expect(items[0].title).toContain("Smiles");
    });
  });

  describe("isKeywordRelated", () => {
    it("detecta palavras-chave", () => {
      const item: RssItem = { guid: "1", title: "Promoção Smiles", link: "", description: "" };
      expect(isKeywordRelated(item, ["smiles"])).toBe(true);
      expect(isKeywordRelated(item, ["latam"])).toBe(false);
    });
  });

  describe("trackRssFeed", () => {
    it("envia alerta para notícia não vista", async () => {
      mock.onGet(/passageirodeprimeira/).reply(200, RSS_WITH_MILHA);
      mock.onPost(/sendMessage/).reply(200, { ok: true });
      
      // Mock do DB: Guid não visto (rows vazio)
      const mockExecute = jest.fn()
        .mockResolvedValueOnce({ rows: [] }) // Para isGuidSeen
        .mockResolvedValueOnce({ rows: [{ chat_id: "123456" }] }) // Para getSubscribedUsers
        .mockResolvedValueOnce({ rowsAffected: 1 }); // Para markGuidAsSeen

      jest.spyOn(dbService, "getDb").mockReturnValue({
        execute: mockExecute
      } as any);

      await trackRssFeed({
        rssUrl: "https://passageirodeprimeira.com/feed/",
        keywords: ["smiles"],
        feedName: "news"
      });

      expect(mock.history.post.length).toBe(1);
      expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({
        sql: expect.stringContaining("INSERT OR IGNORE")
      }));
    });

    it("pula notícia já vista", async () => {
      mock.onGet(/passageirodeprimeira/).reply(200, RSS_WITH_MILHA);
      
      // Mock do DB: Guid já visto (rows com 1 item)
      const mockExecute = jest.fn().mockResolvedValue({ rows: [{1: 1}] });

      jest.spyOn(dbService, "getDb").mockReturnValue({
        execute: mockExecute
      } as any);

      await trackRssFeed({
        rssUrl: "https://passageirodeprimeira.com/feed/",
        keywords: ["smiles"],
        feedName: "news"
      });

      expect(mock.history.post.length).toBe(0);
    });
  });

  describe("IA Summarization", () => {
    it("shouldSummarize identifica clickbaits", () => {
      process.env.OPENROUTER_API_KEY = "key";
      const item: RssItem = { 
        guid: "1", 
        title: "Veja como ganhar milhas", 
        link: "", 
        description: "curta" 
      };
      expect(shouldSummarize(item)).toBe(true);
    });
  });
});
