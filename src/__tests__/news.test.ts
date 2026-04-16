import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import fs from "fs";
import path from "path";

// Mock do Anthropic SDK — deve vir antes de qualquer import que o utilize
jest.mock("@anthropic-ai/sdk", () => {
  const mockCreate = jest.fn();
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: { create: mockCreate },
    })),
    _mockCreate: mockCreate, // exposto para os testes acessarem
  };
});
import { parseRssItems, isMilhaRelated, isKeywordRelated, buildNewsMessage, loadSeenGuids, saveSeenGuids, runNewsTracker, trackRssFeed, shouldSummarize, fetchArticleText, summarizeArticle, RssItem } from "../services/news";

// news.ts lê diretamente das env vars, sem usar config.ts
process.env.TELEGRAM_BOT_TOKEN = "test-token";
process.env.TELEGRAM_CHAT_ID = "123456";

const mock = new MockAdapter(axios);

afterEach(() => {
  mock.reset();
  jest.restoreAllMocks();
});

// ── Fixtures RSS ─────────────────────────────────────────────────────────────

const RSS_WITH_MILHA = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Passageiro de Primeira</title>
    <item>
      <title><![CDATA[Smiles lança promoção de transferência de milhas com bônus de 100%]]></title>
      <link>https://passageirodeprimeira.com/smiles-bonus-100</link>
      <guid>https://passageirodeprimeira.com/smiles-bonus-100</guid>
      <description><![CDATA[<p>A Smiles anunciou hoje uma promoção imperdível com bônus de 100% nas transferências de pontos de cartões parceiros.</p>]]></description>
      <pubDate>Tue, 31 Mar 2026 11:00:00 +0000</pubDate>
    </item>
    <item>
      <title><![CDATA[LATAM anuncia novas rotas internacionais para 2026]]></title>
      <link>https://passageirodeprimeira.com/latam-rotas-2026</link>
      <guid>https://passageirodeprimeira.com/latam-rotas-2026</guid>
      <description><![CDATA[<p>A LATAM confirmou a abertura de novas rotas internacionais com resgate de milhas incluído.</p>]]></description>
      <pubDate>Mon, 30 Mar 2026 09:00:00 +0000</pubDate>
    </item>
  </channel>
</rss>`;

const RSS_NO_MILHA = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title><![CDATA[Aeroporto de Guarulhos inaugura nova ala de embarque]]></title>
      <link>https://passageirodeprimeira.com/gru-nova-ala</link>
      <guid>https://passageirodeprimeira.com/gru-nova-ala</guid>
      <description><![CDATA[<p>O GRU Airport inaugurou nesta semana uma nova ala exclusiva para embarques internacionais.</p>]]></description>
      <pubDate>Sun, 29 Mar 2026 10:00:00 +0000</pubDate>
    </item>
  </channel>
</rss>`;

// ── parseRssItems ─────────────────────────────────────────────────────────────

describe("parseRssItems", () => {
  it("extrai título, link, guid e descrição de itens com CDATA", () => {
    const items = parseRssItems(RSS_WITH_MILHA);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("Smiles lança promoção de transferência de milhas com bônus de 100%");
    expect(items[0].link).toBe("https://passageirodeprimeira.com/smiles-bonus-100");
    expect(items[0].guid).toBe("https://passageirodeprimeira.com/smiles-bonus-100");
    expect(items[0].pubDate).toBeTruthy();
  });

  it("remove tags HTML da descrição", () => {
    const items = parseRssItems(RSS_WITH_MILHA);
    expect(items[0].description).not.toContain("<p>");
    expect(items[0].description).not.toContain("</p>");
    expect(items[0].description).toContain("Smiles anunciou");
  });

  it("trunca descrição com mais de 300 caracteres e adiciona '…'", () => {
    const longDesc = "x".repeat(400);
    const xml = `<rss><channel><item>
      <title>Teste</title>
      <link>https://exemplo.com/a</link>
      <guid>guid-1</guid>
      <description>${longDesc}</description>
    </item></channel></rss>`;
    const items = parseRssItems(xml);
    expect(items[0].description.length).toBeLessThanOrEqual(304); // 300 + "…"
    expect(items[0].description.endsWith("…")).toBe(true);
  });

  it("retorna array vazio para XML sem itens", () => {
    expect(parseRssItems("<rss><channel></channel></rss>")).toHaveLength(0);
  });

  it("ignora itens sem título ou link", () => {
    const xml = `<rss><channel>
      <item><description>sem titulo e link</description></item>
    </channel></rss>`;
    expect(parseRssItems(xml)).toHaveLength(0);
  });

  it("usa guid como fallback para link quando link ausente", () => {
    const xml = `<rss><channel><item>
      <title>Teste</title>
      <guid>https://exemplo.com/guid</guid>
      <description>desc</description>
    </item></channel></rss>`;
    const items = parseRssItems(xml);
    expect(items[0].link).toBe("https://exemplo.com/guid");
  });
});

// ── isMilhaRelated ────────────────────────────────────────────────────────────

describe("isMilhaRelated", () => {
  const base: RssItem = { guid: "g", title: "", link: "https://ex.com", description: "" };

  it("retorna true quando título contém 'milhas'", () => {
    expect(isMilhaRelated({ ...base, title: "Promoção de milhas da Smiles" })).toBe(true);
  });

  it("retorna true quando descrição contém 'pontos'", () => {
    expect(isMilhaRelated({ ...base, title: "Notícia", description: "Transfira seus pontos agora" })).toBe(true);
  });

  it("retorna true para keywords: smiles, livelo, esfera, tudo azul, latam pass", () => {
    const keywords = ["smiles", "livelo", "esfera", "tudo azul", "latam pass"];
    for (const kw of keywords) {
      expect(isMilhaRelated({ ...base, title: `Novidade do ${kw}` })).toBe(true);
    }
  });

  it("é case-insensitive", () => {
    expect(isMilhaRelated({ ...base, title: "MILHAS e PONTOS em destaque" })).toBe(true);
  });

  it("retorna false quando não há keywords de milhas", () => {
    expect(isMilhaRelated({ ...base, title: "GRU inaugura nova ala", description: "Embarques internacionais melhorados." })).toBe(false);
  });
});

// ── buildNewsMessage ──────────────────────────────────────────────────────────

describe("buildNewsMessage", () => {
  const item: RssItem = {
    guid: "g",
    title: "Smiles com bônus de 100%",
    link: "https://passageirodeprimeira.com/smiles",
    description: "A Smiles lançou promoção com bônus de 100% nas transferências.",
  };

  it("contém o título em negrito Markdown", () => {
    const msg = buildNewsMessage(item);
    expect(msg).toContain("*Smiles com bônus de 100%*");
  });

  it("contém a descrição", () => {
    const msg = buildNewsMessage(item);
    expect(msg).toContain("A Smiles lançou promoção");
  });

  it("contém o link formatado", () => {
    const msg = buildNewsMessage(item);
    expect(msg).toContain("[Ler mais](https://passageirodeprimeira.com/smiles)");
  });

  it("omite linha de descrição quando vazia", () => {
    const msg = buildNewsMessage({ ...item, description: "" });
    expect(msg).not.toContain("\n\n\n"); // sem linha em branco dupla
    expect(msg).toContain("[Ler mais]");
  });
});

// ── loadSeenGuids / saveSeenGuids ─────────────────────────────────────────────

describe("loadSeenGuids", () => {
  it("retorna Set vazio quando arquivo não existe", () => {
    jest.spyOn(fs, "readFileSync").mockImplementation(() => { throw new Error("ENOENT"); });
    expect(loadSeenGuids("/tmp/fake.json").size).toBe(0);
  });

  it("carrega GUIDs do arquivo JSON", () => {
    jest.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(["guid-1", "guid-2"]));
    const set = loadSeenGuids("/tmp/fake.json");
    expect(set.has("guid-1")).toBe(true);
    expect(set.has("guid-2")).toBe(true);
  });
});

describe("saveSeenGuids", () => {
  it("escreve JSON com os GUIDs do Set", () => {
    const mkdirSpy = jest.spyOn(fs, "mkdirSync").mockReturnValue(undefined as any);
    const writeSpy = jest.spyOn(fs, "writeFileSync").mockReturnValue();
    const guids = new Set(["guid-a", "guid-b"]);
    saveSeenGuids(guids, "/tmp/fake.json");
    expect(writeSpy).toHaveBeenCalledTimes(1);
    const written = JSON.parse(writeSpy.mock.calls[0][1] as string);
    expect(written).toContain("guid-a");
    expect(written).toContain("guid-b");
    mkdirSpy.mockRestore();
  });

  it("limita a 300 GUIDs para não crescer indefinidamente", () => {
    const mkdirSpy = jest.spyOn(fs, "mkdirSync").mockReturnValue(undefined as any);
    const writeSpy = jest.spyOn(fs, "writeFileSync").mockReturnValue();
    const guids = new Set(Array.from({ length: 400 }, (_, i) => `guid-${i}`));
    saveSeenGuids(guids, "/tmp/fake.json");
    const written: string[] = JSON.parse(writeSpy.mock.calls[0][1] as string);
    expect(written.length).toBe(300);
    mkdirSpy.mockRestore();
  });
});

// ── runNewsTracker ────────────────────────────────────────────────────────────

describe("runNewsTracker", () => {
  // Mock de fs com estado compartilhado: writeFileSync persiste e readFileSync lê
  // o mesmo estado. Isso simula o comportamento real entre os 2 feeds sequenciais,
  // garantindo que o feed 2 veja os GUIDs salvos pelo feed 1 (sem duplicatas).
  let seenStore: Record<string, string> = {};

  beforeEach(() => {
    seenStore = {};
    jest.spyOn(fs, "readFileSync").mockImplementation((p: any) => {
      if (!(String(p) in seenStore)) throw new Error("ENOENT");
      return seenStore[String(p)];
    });
    jest.spyOn(fs, "mkdirSync").mockReturnValue(undefined as any);
    jest.spyOn(fs, "writeFileSync").mockImplementation((p: any, data: any) => {
      seenStore[String(p)] = String(data);
    });
  });

  it("busca o RSS e envia alertas Telegram para itens novos com milhas", async () => {
    mock.onGet(/passageirodeprimeira/).reply(200, RSS_WITH_MILHA);
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    await runNewsTracker();

    // Feed 1 envia 2 itens; feed 2 carrega os GUIDs salvos e não reenvia nada
    expect(mock.history.post).toHaveLength(2);
    const body = JSON.parse(mock.history.post[0].data);
    expect(body.chat_id).toBe("123456");
    expect(body.parse_mode).toBe("Markdown");
    expect(body.text).toContain("Smiles");
  });

  it("não envia alertas para itens sem palavras-chave de milhas", async () => {
    mock.onGet(/passageirodeprimeira/).reply(200, RSS_NO_MILHA);
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    await runNewsTracker();

    expect(mock.history.post).toHaveLength(0);
  });

  it("não reenvia itens já vistos (controle de duplicatas)", async () => {
    // Pré-popula o banco com o guid do primeiro item já visto
    const dbPath = path.join(process.cwd(), "data", "news-seen.json");
    seenStore[dbPath] = JSON.stringify(["https://passageirodeprimeira.com/smiles-bonus-100"]);

    mock.onGet(/passageirodeprimeira/).reply(200, RSS_WITH_MILHA);
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    await runNewsTracker();

    // apenas 1 novo (LATAM), o Smiles já foi visto — em ambos os feeds
    expect(mock.history.post).toHaveLength(1);
    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("LATAM");
  });

  it("lança erro quando RSS está indisponível", async () => {
    mock.onGet(/passageirodeprimeira/).networkError();

    await expect(runNewsTracker()).rejects.toThrow();
  });

  it("continua enviando outros itens mesmo se um alerta Telegram falhar", async () => {
    mock.onGet(/passageirodeprimeira/).reply(200, RSS_WITH_MILHA);
    mock.onPost(/sendMessage/)
      .replyOnce(500, { ok: false }) // item 1 falha no feed 1
      .onPost(/sendMessage/)
      .reply(200, { ok: true });    // item 2 (feed 1) + retry item 1 (feed 2): ok

    await expect(runNewsTracker()).resolves.not.toThrow();
    // Feed 1: 2 tentativas (1 falha + 1 ok); feed 2: retry do item que falhou (1 ok)
    expect(mock.history.post).toHaveLength(3);
  });

  it("salva os GUIDs após processar os itens", async () => {
    mock.onGet(/passageirodeprimeira/).reply(200, RSS_WITH_MILHA);
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    await runNewsTracker();

    // Verifica o estado final do banco via seenStore
    const dbPath = path.join(process.cwd(), "data", "news-seen.json");
    const saved: string[] = JSON.parse(seenStore[dbPath]);
    expect(saved).toContain("https://passageirodeprimeira.com/smiles-bonus-100");
    expect(saved).toContain("https://passageirodeprimeira.com/latam-rotas-2026");
  });
});

// ── isKeywordRelated ──────────────────────────────────────────────────────────

describe("isKeywordRelated", () => {
  const base: RssItem = { guid: "g", title: "", link: "https://ex.com", description: "" };

  it("retorna true quando keywords está vazio (aceita tudo)", () => {
    expect(isKeywordRelated({ ...base, title: "Qualquer coisa" }, [])).toBe(true);
  });

  it("retorna true quando título contém uma keyword", () => {
    expect(isKeywordRelated({ ...base, title: "Oferta imperdível de passagem" }, ["oferta", "promoção"])).toBe(true);
  });

  it("retorna true quando descrição contém uma keyword", () => {
    expect(isKeywordRelated({ ...base, title: "Notícia", description: "Promoção relâmpago disponível" }, ["promoção"])).toBe(true);
  });

  it("é case-insensitive", () => {
    expect(isKeywordRelated({ ...base, title: "OFERTA ESPECIAL" }, ["oferta"])).toBe(true);
  });

  it("retorna false quando nenhuma keyword bate", () => {
    expect(isKeywordRelated({ ...base, title: "Aeroporto inaugura nova ala" }, ["oferta", "promoção"])).toBe(false);
  });
});

// ── trackRssFeed ──────────────────────────────────────────────────────────────

const RSS_OFFERS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title><![CDATA[Passagem para Paris por R$ 1.800 ida e volta]]></title>
      <link>https://queroviajarnafaixa.com.br/paris-1800</link>
      <guid>https://queroviajarnafaixa.com.br/paris-1800</guid>
      <description><![CDATA[<p>Encontramos uma oferta incrível para Paris saindo de São Paulo.</p>]]></description>
      <pubDate>Tue, 01 Apr 2026 10:00:00 +0000</pubDate>
    </item>
    <item>
      <title><![CDATA[Promoção: voos para Fortaleza a partir de R$ 250]]></title>
      <link>https://queroviajarnafaixa.com.br/fortaleza-250</link>
      <guid>https://queroviajarnafaixa.com.br/fortaleza-250</guid>
      <description><![CDATA[<p>Aproveite os preços baixíssimos para Fortaleza neste mês.</p>]]></description>
      <pubDate>Tue, 01 Apr 2026 09:00:00 +0000</pubDate>
    </item>
  </channel>
</rss>`;

describe("trackRssFeed", () => {
  const offersConfig = {
    rssUrl: "https://queroviajarnafaixa.com.br/category/ofertas/feed/",
    keywords: [] as string[],
    seenDbPath: "/tmp/offers-seen-test.json",
    feedName: "offers",
  };

  beforeEach(() => {
    jest.spyOn(fs, "readFileSync").mockImplementation(() => { throw new Error("ENOENT"); });
    jest.spyOn(fs, "mkdirSync").mockReturnValue(undefined as any);
    jest.spyOn(fs, "writeFileSync").mockReturnValue();
  });

  it("envia todos os itens quando keywords está vazio", async () => {
    mock.onGet(/queroviajarnafaixa/).reply(200, RSS_OFFERS);
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    await trackRssFeed(offersConfig);

    expect(mock.history.post).toHaveLength(2); // sem filtro = envia tudo
  });

  it("filtra por keywords quando fornecidas", async () => {
    mock.onGet(/queroviajarnafaixa/).reply(200, RSS_OFFERS);
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    await trackRssFeed({ ...offersConfig, keywords: ["paris"] });

    expect(mock.history.post).toHaveLength(1);
    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("Paris");
  });

  it("usa seenDbPath customizado sem conflitar com news-seen.json", async () => {
    const writeSpy = jest.spyOn(fs, "writeFileSync").mockReturnValue();
    mock.onGet(/queroviajarnafaixa/).reply(200, RSS_OFFERS);
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    await trackRssFeed(offersConfig);

    const savedPath = writeSpy.mock.calls[0][0] as string;
    expect(savedPath).toBe("/tmp/offers-seen-test.json");
    expect(savedPath).not.toContain("news-seen");
  });

  it("não reenvia itens já vistos no banco customizado", async () => {
    jest.restoreAllMocks();
    jest.spyOn(fs, "readFileSync").mockReturnValue(
      JSON.stringify(["https://queroviajarnafaixa.com.br/paris-1800"])
    );
    jest.spyOn(fs, "mkdirSync").mockReturnValue(undefined as any);
    jest.spyOn(fs, "writeFileSync").mockReturnValue();

    mock.onGet(/queroviajarnafaixa/).reply(200, RSS_OFFERS);
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    await trackRssFeed(offersConfig);

    expect(mock.history.post).toHaveLength(1); // só o segundo item é novo
    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("Fortaleza");
  });

  it("lança erro quando o RSS está indisponível", async () => {
    mock.onGet(/queroviajarnafaixa/).networkError();

    await expect(trackRssFeed(offersConfig)).rejects.toThrow();
  });
});

// ── Helpers para acessar o mock do Anthropic SDK ──────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-require-imports
const anthropicMock = require("@anthropic-ai/sdk");
const getMockCreate = (): jest.Mock => anthropicMock._mockCreate;

// ── shouldSummarize ───────────────────────────────────────────────────────────

describe("shouldSummarize", () => {
  const base: RssItem = { guid: "g", title: "Título neutro", link: "https://ex.com", description: "" };

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("retorna false quando ANTHROPIC_API_KEY não está definida", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(shouldSummarize({ ...base, description: "texto curto" })).toBe(false);
  });

  it("retorna false quando score >= 2 (descrição longa + percentual)", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const item = { ...base, description: "A".repeat(160), title: "Smiles com bônus de 100%" };
    expect(shouldSummarize(item)).toBe(false);
  });

  it("retorna false quando título + descrição têm nome de programa e valor monetário", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const item = { ...base, title: "Livelo promove transferência por R$ 0,01", description: "Promoção válida até fim do mês com condições especiais para os usuários do programa Livelo disponíveis." };
    expect(shouldSummarize(item)).toBe(false);
  });

  it("retorna true quando descrição é curta e sem dados concretos", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const item = { ...base, description: "Saiba mais sobre essa novidade." };
    expect(shouldSummarize(item)).toBe(true);
  });

  it("retorna true quando título é clickbait e descrição é curta", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const item = { ...base, title: "Descubra como ganhar milhas grátis", description: "Veja a oferta" };
    expect(shouldSummarize(item)).toBe(true);
  });

  it("retorna false quando contém data específica e descrição longa", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const item = { ...base, title: "Promoção válida até 30/06", description: "A".repeat(160) };
    expect(shouldSummarize(item)).toBe(false);
  });
});

// ── fetchArticleText ──────────────────────────────────────────────────────────

describe("fetchArticleText", () => {
  it("retorna texto limpo sem tags HTML", async () => {
    mock.onGet("https://exemplo.com/artigo").reply(200, "<html><body><p>Texto do artigo</p></body></html>");
    const text = await fetchArticleText("https://exemplo.com/artigo");
    expect(text).toContain("Texto do artigo");
    expect(text).not.toContain("<p>");
  });

  it("trunca texto com mais de 1500 palavras e adiciona '…'", async () => {
    const longHtml = Array.from({ length: 1600 }, (_, i) => `palavra${i}`).join(" ");
    mock.onGet("https://exemplo.com/longo").reply(200, longHtml);
    const text = await fetchArticleText("https://exemplo.com/longo");
    const wordCount = text.replace("…", "").trim().split(/\s+/).length;
    expect(wordCount).toBeLessThanOrEqual(1500);
    expect(text.endsWith("…")).toBe(true);
  });

  it("lança erro quando a URL está indisponível", async () => {
    mock.onGet("https://exemplo.com/erro").networkError();
    await expect(fetchArticleText("https://exemplo.com/erro")).rejects.toThrow();
  });
});

// ── summarizeArticle ──────────────────────────────────────────────────────────

describe("summarizeArticle", () => {
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    getMockCreate().mockReset();
  });

  it("retorna null quando ANTHROPIC_API_KEY não está definida", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = await summarizeArticle("Título", "Texto do artigo");
    expect(result).toBeNull();
  });

  it("retorna o texto dos bullet points quando a API responde com sucesso", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    getMockCreate().mockResolvedValue({
      content: [{ type: "text", text: "• Ponto 1\n• Ponto 2\n• Ponto 3" }],
    });
    const result = await summarizeArticle("Título", "Texto do artigo");
    expect(result).toBe("• Ponto 1\n• Ponto 2\n• Ponto 3");
  });

  it("retorna null quando o content block não é do tipo text", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    getMockCreate().mockResolvedValue({
      content: [{ type: "tool_use", id: "x", name: "x", input: {} }],
    });
    const result = await summarizeArticle("Título", "Texto");
    expect(result).toBeNull();
  });

  it("lança erro quando a API falha", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    getMockCreate().mockRejectedValue(new Error("API error"));
    await expect(summarizeArticle("Título", "Texto")).rejects.toThrow("API error");
  });
});

// ── buildNewsMessage com summary ──────────────────────────────────────────────

describe("buildNewsMessage com summary", () => {
  const item: RssItem = {
    guid: "g",
    title: "Smiles com bônus de 100%",
    link: "https://passageirodeprimeira.com/smiles",
    description: "Descrição do artigo RSS.",
  };

  it("com summary: contém '📝 *Resumo:*' e não contém a descrição RSS", () => {
    const msg = buildNewsMessage(item, "• Ponto 1\n• Ponto 2");
    expect(msg).toContain("📝 *Resumo:*");
    expect(msg).toContain("• Ponto 1");
    expect(msg).not.toContain("Descrição do artigo RSS.");
  });

  it("com summary: contém o link antes do resumo", () => {
    const msg = buildNewsMessage(item, "• Ponto 1");
    const linkIdx = msg.indexOf("[Ler mais]");
    const resumoIdx = msg.indexOf("📝 *Resumo:*");
    expect(linkIdx).toBeLessThan(resumoIdx);
  });

  it("sem summary: mantém comportamento original com descrição e link", () => {
    const msg = buildNewsMessage(item);
    expect(msg).toContain("Descrição do artigo RSS.");
    expect(msg).toContain("[Ler mais]");
    expect(msg).not.toContain("📝 *Resumo:*");
  });
});

// ── trackRssFeed com resumo ───────────────────────────────────────────────────

describe("trackRssFeed com resumo (shouldSummarize ativo)", () => {
  const config = {
    rssUrl: "https://queroviajarnafaixa.com.br/category/ofertas/feed/",
    keywords: [] as string[],
    seenDbPath: "/tmp/offers-resume-test.json",
    feedName: "offers-test",
  };

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    jest.spyOn(fs, "readFileSync").mockImplementation(() => { throw new Error("ENOENT"); });
    jest.spyOn(fs, "mkdirSync").mockReturnValue(undefined as any);
    jest.spyOn(fs, "writeFileSync").mockReturnValue();
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    getMockCreate().mockReset();
  });

  it("gera resumo e inclui '📝 *Resumo:*' na mensagem quando shouldSummarize retorna true", async () => {
    // RSS com descrição curta → shouldSummarize = true
    const rssShortDesc = `<rss><channel>
      <item>
        <title><![CDATA[Descubra como ganhar milhas]]></title>
        <link>https://queroviajarnafaixa.com.br/milhas</link>
        <guid>guid-milhas</guid>
        <description><![CDATA[Veja a oferta]]></description>
      </item>
    </channel></rss>`;

    mock.onGet(/queroviajarnafaixa.*feed/).reply(200, rssShortDesc);
    mock.onGet("https://queroviajarnafaixa.com.br/milhas").reply(200, "<p>Texto do artigo completo sobre milhas.</p>");
    getMockCreate().mockResolvedValue({
      content: [{ type: "text", text: "• Ponto 1\n• Ponto 2" }],
    });
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    await trackRssFeed(config);

    expect(mock.history.post).toHaveLength(1);
    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("📝 *Resumo:*");
    expect(body.text).toContain("• Ponto 1");
  });

  it("envia sem resumo quando fetch do artigo falha (fallback silencioso)", async () => {
    const rssShortDesc = `<rss><channel>
      <item>
        <title><![CDATA[Descubra como ganhar milhas]]></title>
        <link>https://queroviajarnafaixa.com.br/milhas-erro</link>
        <guid>guid-milhas-erro</guid>
        <description><![CDATA[Veja]]></description>
      </item>
    </channel></rss>`;

    mock.onGet(/queroviajarnafaixa.*feed/).reply(200, rssShortDesc);
    mock.onGet("https://queroviajarnafaixa.com.br/milhas-erro").networkError();
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    await trackRssFeed(config);

    expect(mock.history.post).toHaveLength(1);
    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).not.toContain("📝 *Resumo:*");
  });
});
