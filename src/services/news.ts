import axios, { isAxiosError } from "axios";
import fs from "fs";
import path from "path";

function formatError(err: unknown): string {
  if (isAxiosError(err)) {
    return `HTTP ${err.response?.status ?? "?"}: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

const RSS_URL = "https://passageirodeprimeira.com/categorias/noticias/feed/";
const SEEN_DB_PATH = path.join(process.cwd(), "data", "news-seen.json");
const MAX_SEEN = 300; // máximo de GUIDs armazenados
const TIMEOUT_MS = 15_000;
const DESCRIPTION_MAX_CHARS = 300;

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

// ── Mensagem Telegram ────────────────────────────────────────────────────────

export function buildNewsMessage(item: RssItem): string {
  const lines = [
    `📰 *${item.title}*`,
    ``,
  ];
  if (item.description) {
    lines.push(item.description);
    lines.push(``);
  }
  lines.push(`🔗 [Ler mais](${item.link})`);
  return lines.join("\n");
}

function getTelegramConfig(): { botToken: string; chatId: string } {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken) throw new Error("Missing required env var: TELEGRAM_BOT_TOKEN");
  if (!chatId) throw new Error("Missing required env var: TELEGRAM_CHAT_ID");
  return { botToken, chatId };
}

export async function sendNewsAlert(item: RssItem): Promise<void> {
  const { botToken, chatId } = getTelegramConfig();
  const BASE_URL = `https://api.telegram.org/bot${botToken}`;
  const text = buildNewsMessage(item);

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
      await sendNewsAlert(item);
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
  return trackRssFeed({
    rssUrl: RSS_URL,
    keywords: MILHA_KEYWORDS,
    seenDbPath: SEEN_DB_PATH,
    feedName: "news",
  });
}
