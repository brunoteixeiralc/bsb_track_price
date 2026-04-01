import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import fs from "fs";
import { parseRssItems, isMilhaRelated, isKeywordRelated, buildNewsMessage, loadSeenGuids, saveSeenGuids, runNewsTracker, trackRssFeed, RssItem } from "../services/news";

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
  beforeEach(() => {
    jest.spyOn(fs, "readFileSync").mockImplementation(() => { throw new Error("ENOENT"); });
    jest.spyOn(fs, "mkdirSync").mockReturnValue(undefined as any);
    jest.spyOn(fs, "writeFileSync").mockReturnValue();
  });

  it("busca o RSS e envia alertas Telegram para itens novos com milhas", async () => {
    mock.onGet(/passageirodeprimeira/).reply(200, RSS_WITH_MILHA);
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    await runNewsTracker();

    // 2 itens com milhas no RSS_WITH_MILHA
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
    // simula guid já salvo no banco
    jest.restoreAllMocks();
    jest.spyOn(fs, "readFileSync").mockReturnValue(
      JSON.stringify(["https://passageirodeprimeira.com/smiles-bonus-100"])
    );
    jest.spyOn(fs, "mkdirSync").mockReturnValue(undefined as any);
    jest.spyOn(fs, "writeFileSync").mockReturnValue();

    mock.onGet(/passageirodeprimeira/).reply(200, RSS_WITH_MILHA);
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    await runNewsTracker();

    // apenas 1 novo (o segundo item), o primeiro já foi visto
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
      .replyOnce(500, { ok: false }) // primeiro falha
      .onPost(/sendMessage/)
      .reply(200, { ok: true });    // segundo ok

    await expect(runNewsTracker()).resolves.not.toThrow();
    expect(mock.history.post).toHaveLength(2);
  });

  it("salva os GUIDs após processar os itens", async () => {
    const writeSpy = jest.spyOn(fs, "writeFileSync").mockReturnValue();
    mock.onGet(/passageirodeprimeira/).reply(200, RSS_WITH_MILHA);
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    await runNewsTracker();

    expect(writeSpy).toHaveBeenCalledTimes(1);
    const saved: string[] = JSON.parse(writeSpy.mock.calls[0][1] as string);
    expect(saved).toContain("https://passageirodeprimeira.com/smiles-bonus-100");
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
