import axios, { isAxiosError } from "axios";
import { getDb } from "./db";

function formatError(err: unknown): string {
  if (isAxiosError(err)) {
    return `HTTP ${err.response?.status ?? "?"}: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

const RSS_URL = "https://passageirodeprimeira.com/categorias/noticias/feed/";
const RSS_URL_PROMOCOES = "https://passageirodeprimeira.com/categorias/promocoes/feed/";
const TIMEOUT_MS = 15_000;
const DESCRIPTION_MAX_CHARS = 300;
const SUMMARIZE_MODEL = "openrouter/elephant-alpha";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const ARTICLE_MAX_WORDS = 1500;

const MILHA_KEYWORDS = [
  "milha", "milhas", "pontos", "smiles", "livelo", "esfera", "tudo azul", 
  "latam pass", "programa de fidelidade", "frequent flyer", "clube de vantagens", 
  "bônus", "transferência de pontos", "passagem premiada",
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
  keywords: string[];
  feedName: string;
}

// ── Banco de dados (Turso) ───────────────────────────────────────────────────

async function isGuidSeen(guid: string): Promise<boolean> {
  const db = getDb();
  const res = await db.execute({
    sql: "SELECT 1 FROM news_seen WHERE guid = ?",
    args: [guid]
  });
  return res.rows.length > 0;
}

async function markGuidAsSeen(guid: string, tag: string): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: "INSERT OR IGNORE INTO news_seen (guid, tag) VALUES (?, ?)",
    args: [guid, tag]
  });
}

// ── Parsing RSS ──────────────────────────────────────────────────────────────

function extractTag(xml: string, tag: string): string {
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

// ── Filtros e IA ─────────────────────────────────────────────────────────────

export function isKeywordRelated(item: RssItem, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const haystack = `${item.title} ${item.description}`.toLowerCase();
  return keywords.some((kw) => haystack.includes(kw));
}

export function shouldSummarize(item: RssItem): boolean {
  if (!process.env.OPENROUTER_API_KEY) return false;
  let score = 0;
  const text = `${item.title} ${item.description}`.toLowerCase();
  if (item.description.length >= 150) score++;
  if (/\d+\s*%|r\$\s*[\d.,]+/.test(text)) score++;
  if (/smiles|livelo|esfera|tudo azul|latam pass|azul fidelidade/.test(text)) score++;
  if (/^(veja|saiba|confira|entenda)\b/i.test(item.title.trim())) score--;
  return score < 2;
}

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

export async function summarizeArticle(title: string, articleText: string): Promise<string | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  const response = await axios.post(
    OPENROUTER_URL,
    {
      model: SUMMARIZE_MODEL,
      max_tokens: 300,
      messages: [
        { role: "system", content: "Você é um assistente especialista em milhas e cartões. Resuma o artigo em pontos chave." },
        { role: "user", content: `Artigo: "${title}"\n\n${articleText}\n\nResuma em 4-5 bullet points.` },
      ],
    },
    { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, timeout: TIMEOUT_MS }
  );
  return response.data?.choices?.[0]?.message?.content?.trim() ?? null;
}

// ── Telegram ─────────────────────────────────────────────────────────────────

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

export async function sendNewsAlert(item: RssItem, summary?: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return;

  const text = buildNewsMessage(item, summary);
  await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
    disable_web_page_preview: false,
  }, { timeout: TIMEOUT_MS });
}

// ── Main Tracker ────────────────────────────────────────────────────────────

export async function trackRssFeed(feedConfig: FeedConfig): Promise<void> {
  const tag = `[${feedConfig.feedName}]`;
  console.log(`${tag} Buscando RSS...`);

  let xml: string;
  try {
    const res = await axios.get<string>(feedConfig.rssUrl, {
      timeout: TIMEOUT_MS,
      headers: { Accept: "application/rss+xml, application/xml, text/xml" },
    });
    xml = res.data;
  } catch (err) {
    console.error(`${tag} Falha ao buscar RSS: ${formatError(err)}`);
    return;
  }

  const items = parseRssItems(xml);
  const filtered = items.filter((item) => isKeywordRelated(item, feedConfig.keywords));
  
  let sentCount = 0;
  for (const item of filtered) {
    if (await isGuidSeen(item.guid)) continue;

    try {
      let summary: string | undefined;
      if (shouldSummarize(item)) {
        try {
          const text = await fetchArticleText(item.link);
          summary = (await summarizeArticle(item.title, text)) ?? undefined;
        } catch (e) {}
      }
      
      await sendNewsAlert(item, summary);
      await markGuidAsSeen(item.guid, feedConfig.feedName);
      sentCount++;
      console.log(`${tag} Enviado: ${item.title}`);
    } catch (err) {
      console.error(`${tag} Erro no item "${item.title}": ${formatError(err)}`);
    }
  }
  console.log(`${tag} Concluído. ${sentCount} nova(s) notícia(s) enviada(s).`);
}

export async function runNewsTracker(): Promise<void> {
  await trackRssFeed({ rssUrl: RSS_URL, keywords: MILHA_KEYWORDS, feedName: "news" });
  await trackRssFeed({ rssUrl: RSS_URL_PROMOCOES, keywords: MILHA_KEYWORDS, feedName: "news-promocoes" });
  await trackRssFeed({ rssUrl: "https://pontospravoar.com/feed/", keywords: MILHA_KEYWORDS, feedName: "news-pontospravoar" });
}
