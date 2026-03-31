import axios from "axios";
import fs from "fs";
import path from "path";
import { config } from "../config";

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

// ── Filtro por palavras-chave de milhas ──────────────────────────────────────

export function isMilhaRelated(item: RssItem): boolean {
  const haystack = `${item.title} ${item.description}`.toLowerCase();
  return MILHA_KEYWORDS.some((kw) => haystack.includes(kw));
}

// ── Banco de dados de GUIDs já vistos (data/news-seen.json) ─────────────────

export function loadSeenGuids(): Set<string> {
  try {
    const raw = fs.readFileSync(SEEN_DB_PATH, "utf-8");
    const arr: string[] = JSON.parse(raw);
    return new Set(arr);
  } catch {
    return new Set();
  }
}

export function saveSeenGuids(guids: Set<string>): void {
  const arr = Array.from(guids).slice(-MAX_SEEN);
  fs.mkdirSync(path.dirname(SEEN_DB_PATH), { recursive: true });
  fs.writeFileSync(SEEN_DB_PATH, JSON.stringify(arr, null, 2));
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

export async function sendNewsAlert(item: RssItem): Promise<void> {
  const BASE_URL = `https://api.telegram.org/bot${config.telegram.botToken}`;
  const text = buildNewsMessage(item);

  await axios.post(`${BASE_URL}/sendMessage`, {
    chat_id: config.telegram.chatId,
    text,
    parse_mode: "Markdown",
    disable_web_page_preview: false,
  }, { timeout: TIMEOUT_MS });
}

// ── Entry point do tracker de notícias ──────────────────────────────────────

export async function runNewsTracker(): Promise<void> {
  console.log("[news] Buscando RSS do Passageiro de Primeira...");

  let xml: string;
  try {
    const res = await axios.get<string>(RSS_URL, {
      timeout: TIMEOUT_MS,
      headers: { Accept: "application/rss+xml, application/xml, text/xml" },
    });
    xml = res.data;
  } catch (err) {
    console.error("[news] Falha ao buscar RSS:", err);
    throw err;
  }

  const items = parseRssItems(xml);
  console.log(`[news] ${items.length} item(ns) no feed.`);

  const milhaItems = items.filter(isMilhaRelated);
  console.log(`[news] ${milhaItems.length} item(ns) relacionado(s) a milhas.`);

  const seen = loadSeenGuids();
  const newItems = milhaItems.filter((item) => !seen.has(item.guid));
  console.log(`[news] ${newItems.length} item(ns) novo(s) para enviar.`);

  for (const item of newItems) {
    try {
      await sendNewsAlert(item);
      seen.add(item.guid);
      console.log(`[news] Enviado: ${item.title}`);
    } catch (err) {
      console.error(`[news] Falha ao enviar "${item.title}":`, err);
    }
  }

  saveSeenGuids(seen);
  console.log(`[news] Concluído. ${seen.size} GUID(s) no banco.`);
}
