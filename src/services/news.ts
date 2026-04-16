import axios, { isAxiosError } from "axios";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";

function formatError(err: unknown): string {
  if (isAxiosError(err)) {
    return `HTTP ${err.response?.status ?? "?"}: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

const RSS_URL = "https://passageirodeprimeira.com/categorias/noticias/feed/";
const RSS_URL_PROMOCOES = "https://passageirodeprimeira.com/categorias/promocoes/feed/";
const SEEN_DB_PATH = path.join(process.cwd(), "data", "news-seen.json");
const MAX_SEEN = 300; // máximo de GUIDs armazenados
const TIMEOUT_MS = 15_000;
const DESCRIPTION_MAX_CHARS = 300;
const SUMMARIZE_MODEL = "claude-haiku-4-5-20251001";
const ARTICLE_MAX_WORDS = 1500;

const MILHA_KEYWORDS = [
  "milha",
  "milhas",
  "pontos",
  "smiles",
  "livelo",
  "esfera",
  "tudo azul",
  "latam pass",
  "programa de fidelidade",
  "frequent flyer",
  "clube de vantagens",
  "bônus",
  "transferência de pontos",
  "passagem premiada",
];

export interface RssItem {
  guid: string;
  title: string;
  link: string;
  description: string;
  pubDate?: string;
}

export interface FeedConfig {
  rssUrl: string;
  keywords: string[];  // vazio = aceita todos os itens sem filtro
  seenDbPath: string;
  feedName: string;    // prefixo usado nos logs: "news", "offers", etc.
}

// ── Parsing RSS ──────────────────────────────────────────────────────────────

function extractTag(xml: string, tag: string): string {
  // Suporta CDATA: <tag><![CDATA[valor]]></tag> e <tag>valor</tag>
  const re = new RegExp(
    `<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))</${tag}>`,
    "i"
  );
  const m = re.exec(xml);
  if (!m) return "";
  return (m[1] ?? m[2] ?? "").trim();
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;

  while ((match = itemRe.exec(xml)) !== null) {
    const block = match[1];
    const title = stripHtml(extractTag(block, "title"));
    const link = extractTag(block, "link") || extractTag(block, "guid");
    const description = stripHtml(extractTag(block, "description"));
    const guid = extractTag(block, "guid") || link;
    const pubDate = extractTag(block, "pubDate");

    if (title && link) {
      items.push({
        guid,
        title,
        link,
        description: description.length > DESCRIPTION_MAX_CHARS
          ? description.slice(0, DESCRIPTION_MAX_CHARS).trimEnd() + "…"
          : description,
        pubDate,
      });
    }
  }

  return items;
}

// ── Filtro por palavras-chave ────────────────────────────────────────────────

export function isKeywordRelated(item: RssItem, keywords: string[]): boolean {
  if (keywords.length === 0) return true; // sem filtro = aceita tudo
  const haystack = `${item.title} ${item.description}`.toLowerCase();
  return keywords.some((kw) => haystack.includes(kw));
}

/** @deprecated use isKeywordRelated(item, MILHA_KEYWORDS) */
export function isMilhaRelated(item: RssItem): boolean {
  return isKeywordRelated(item, MILHA_KEYWORDS);
}

// ── Banco de dados de GUIDs já vistos ───────────────────────────────────────

export function loadSeenGuids(dbPath: string = SEEN_DB_PATH): Set<string> {
  try {
    const raw = fs.readFileSync(dbPath, "utf-8");
    const arr: string[] = JSON.parse(raw);
    return new Set(arr);
  } catch {
    return new Set();
  }
}

export function saveSeenGuids(guids: Set<string>, dbPath: string = SEEN_DB_PATH): void {
  const arr = Array.from(guids).slice(-MAX_SEEN);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.writeFileSync(dbPath, JSON.stringify(arr, null, 2));
}

// ── Filtro + resumo via Claude ────────────────────────────────────────────────

/**
 * Retorna true se o artigo precisa de resumo via Claude.
 * Score < 2 = informação insuficiente no RSS → resume.
 * Retorna false imediatamente se ANTHROPIC_API_KEY não estiver definido.
 */
export function shouldSummarize(item: RssItem): boolean {
  if (!process.env.ANTHROPIC_API_KEY) return false;

  let score = 0;
  const text = `${item.title} ${item.description}`.toLowerCase();

  // Ideia 1 — descrição substancial
  if (item.description.length >= 150) score++;

  // Ideia 2 — dados concretos: %, R$, datas, nomes de programas
  if (/\d+\s*%|r\$\s*[\d.,]+/.test(text)) score++;
  if (/\b\d{1,2}\/\d{1,2}|\b(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/.test(text)) score++;
  if (/smiles|livelo|esfera|tudo azul|latam pass|azul fidelidade|multiplus/.test(text)) score++;

  // Ideia 4 — título clickbait ou descrição muito curta (penalidade)
  if (/^(veja|descubra|saiba|confira|conheça|entenda|aprenda)\b/i.test(item.title.trim())) score--;
  if (item.description.length < 80) score--;

  return score < 2;
}

/** Busca o HTML do artigo e retorna o texto limpo, truncado a ARTICLE_MAX_WORDS palavras. */
export async function fetchArticleText(url: string): Promise<string> {
  const res = await axios.get<string>(url, {
    timeout: TIMEOUT_MS,
    headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" },
  });
  const text = stripHtml(res.data);
  const words = text.split(/\s+/);
  return words.length > ARTICLE_MAX_WORDS
    ? words.slice(0, ARTICLE_MAX_WORDS).join(" ") + "…"
    : text;
}

/** Chama Claude Haiku 3.5 e retorna 4-5 bullet points em PT, ou null em caso de falha. */
export async function summarizeArticle(title: string, articleText: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: SUMMARIZE_MODEL,
    max_tokens: 300,
    system: "Você resume artigos de viagem e programas de milhas em português. Seja direto e objetivo.",
    messages: [{
      role: "user",
      content: `Artigo: "${title}"\n\n${articleText}\n\nResuma em 4-5 bullet points (•). Foque em valores, datas, condições e como participar.`,
    }],
  });
  const block = response.content[0];
  return block.type === "text" ? block.text.trim() : null;
}

// ── Mensagem Telegram ────────────────────────────────────────────────────────

export function buildNewsMessage(item: RssItem, summary?: string): string {
  const lines = [`📰 *${item.title}*`, ``];
  if (summary) {
    lines.push(`🔗 [Ler mais](${item.link})`, ``, `📝 *Resumo:*`, summary);
  } else {
    if (item.description) lines.push(item.description, ``);
    lines.push(`🔗 [Ler mais](${item.link})`);
  }
  return lines.join("\n");
}

function getTelegramConfig(): { botToken: string; chatId: string } {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken) throw new Error("Missing required env var: TELEGRAM_BOT_TOKEN");
  if (!chatId) throw new Error("Missing required env var: TELEGRAM_CHAT_ID");
  return { botToken, chatId };
}

export async function sendNewsAlert(item: RssItem, summary?: string): Promise<void> {
  const { botToken, chatId } = getTelegramConfig();
  const BASE_URL = `https://api.telegram.org/bot${botToken}`;
  const text = buildNewsMessage(item, summary);

  await axios.post(`${BASE_URL}/sendMessage`, {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
    disable_web_page_preview: false,
  }, { timeout: TIMEOUT_MS });
}

// ── Tracker genérico (qualquer feed RSS) ────────────────────────────────────

export async function trackRssFeed(feedConfig: FeedConfig): Promise<void> {
  const tag = `[${feedConfig.feedName}]`;
  console.log(`${tag} Buscando RSS: ${feedConfig.rssUrl}`);

  let xml: string;
  try {
    const res = await axios.get<string>(feedConfig.rssUrl, {
      timeout: TIMEOUT_MS,
      headers: { Accept: "application/rss+xml, application/xml, text/xml" },
    });
    xml = res.data;
  } catch (err) {
    console.error(`${tag} Falha ao buscar RSS: ${formatError(err)}`);
    throw err;
  }

  const items = parseRssItems(xml);
  console.log(`${tag} ${items.length} item(ns) no feed.`);

  const filtered = items.filter((item) => isKeywordRelated(item, feedConfig.keywords));
  console.log(`${tag} ${filtered.length} item(ns) após filtro de keywords.`);

  const seen = loadSeenGuids(feedConfig.seenDbPath);
  const newItems = filtered.filter((item) => !seen.has(item.guid));
  console.log(`${tag} ${newItems.length} item(ns) novo(s) para enviar.`);

  for (const item of newItems) {
    try {
      let summary: string | undefined;
      if (shouldSummarize(item)) {
        try {
          const articleText = await fetchArticleText(item.link);
          summary = (await summarizeArticle(item.title, articleText)) ?? undefined;
          console.log(`${tag} Resumo gerado para: ${item.title}`);
        } catch (err) {
          console.warn(`${tag} Falha ao gerar resumo, enviando sem resumo: ${formatError(err)}`);
        }
      }
      await sendNewsAlert(item, summary);
      seen.add(item.guid);
      console.log(`${tag} Enviado: ${item.title}`);
    } catch (err) {
      console.error(`${tag} Falha ao enviar "${item.title}": ${formatError(err)}`);
    }
  }

  saveSeenGuids(seen, feedConfig.seenDbPath);
  console.log(`${tag} Concluído. ${seen.size} GUID(s) no banco.`);
}

// ── Entry point do tracker de notícias (milhas) ──────────────────────────────

export async function runNewsTracker(): Promise<void> {
  // Feed 1 — categoria "notícias"
  await trackRssFeed({
    rssUrl: RSS_URL,
    keywords: MILHA_KEYWORDS,
    seenDbPath: SEEN_DB_PATH,
    feedName: "news",
  });
  // Feed 2 — categoria "promoções" (mesmo banco → sem duplicatas entre feeds)
  await trackRssFeed({
    rssUrl: RSS_URL_PROMOCOES,
    keywords: MILHA_KEYWORDS,
    seenDbPath: SEEN_DB_PATH,
    feedName: "news-promocoes",
  });
}
