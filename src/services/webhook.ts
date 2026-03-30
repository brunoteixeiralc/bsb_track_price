import http from "http";
import axios from "axios";
import { config } from "../config";
import { SearchParams } from "../types";
import { searchWithApify } from "../apis/apify";
import { searchWithRapidAPI } from "../apis/rapidapi";
import { loadHistory } from "./history";
import { formatBRL } from "./currency";

const BASE_URL = `https://api.telegram.org/bot${config.telegram.botToken}`;
const TIMEOUT_MS = 10_000;
const WEBHOOK_PORT = Number(process.env.WEBHOOK_PORT ?? "3000");
const MAX_HISTORY_ENTRIES = 5;

interface TelegramMessage {
  message_id: number;
  from?: { id: number; first_name: string; username?: string };
  chat: { id: number; type: string };
  text?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export async function sendReply(chatId: number, text: string): Promise<void> {
  await axios.post(
    `${BASE_URL}/sendMessage`,
    {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    },
    { timeout: TIMEOUT_MS }
  );
}

export async function handleBuscar(chatId: number, destination: string): Promise<void> {
  if (!destination) {
    await sendReply(chatId, "❌ Uso: `/buscar DESTINO` — Ex: `/buscar GRU`");
    return;
  }

  const dest = destination.toUpperCase();
  await sendReply(chatId, `🔍 Buscando voos ${config.search.origin} → ${dest}, aguarde...`);

  const params: SearchParams = {
    origin: config.search.origin,
    destination: dest,
    departureDate: config.search.departureDate,
    returnDate: config.search.returnDate,
    tripType: config.search.tripType,
  };

  let flights;
  try {
    flights = await searchWithApify(params);
  } catch {
    try {
      flights = await searchWithRapidAPI(params);
    } catch (err) {
      console.error(`[webhook] Ambas as APIs falharam para ${dest}:`, err);
      await sendReply(
        chatId,
        `❌ Falha ao buscar voos ${config.search.origin} → ${dest}. Tente novamente mais tarde.`
      );
      return;
    }
  }

  if (flights.length === 0) {
    await sendReply(
      chatId,
      `✈️ Nenhum voo encontrado para ${config.search.origin} → ${dest} em ${config.search.departureDate}.`
    );
    return;
  }

  const sorted = [...flights].sort((a, b) => a.priceBRL - b.priceBRL);
  const cheap = sorted.filter((f) => f.priceBRL <= config.search.maxPriceBRL);
  const best = sorted.slice(0, 3);

  const lines = [
    `✈️ *${config.search.origin} → ${dest}* — ${flights.length} voo(s) encontrado(s)`,
    cheap.length > 0
      ? `🏷️ ${cheap.length} abaixo de ${formatBRL(config.search.maxPriceBRL)}`
      : `ℹ️ Nenhum abaixo de ${formatBRL(config.search.maxPriceBRL)}`,
    ``,
    `📋 *Melhores preços:*`,
  ];

  for (const f of best) {
    lines.push(`• ${formatBRL(f.priceBRL)}${f.airline ? ` — ${f.airline}` : ""}`);
  }

  await sendReply(chatId, lines.join("\n"));
}

export async function handleHistorico(chatId: number, destination: string): Promise<void> {
  if (!destination) {
    await sendReply(chatId, "❌ Uso: `/historico DESTINO` — Ex: `/historico GRU`");
    return;
  }

  const dest = destination.toUpperCase();
  const history = loadHistory();
  const relevant = history
    .filter((e) => e.origin === config.search.origin && e.destination === dest)
    .slice(-MAX_HISTORY_ENTRIES);

  if (relevant.length === 0) {
    await sendReply(chatId, `📭 Sem histórico para ${config.search.origin} → ${dest}.`);
    return;
  }

  const lines = [
    `🗂️ *Histórico ${config.search.origin} → ${dest}* (últimas ${relevant.length} buscas)`,
    ``,
  ];

  for (const entry of [...relevant].reverse()) {
    const date = new Date(entry.timestamp).toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
    });
    const price = entry.cheapestPriceBRL !== null ? formatBRL(entry.cheapestPriceBRL) : "—";
    lines.push(`📅 ${date} — ${entry.totalFound} voo(s) — mínimo: *${price}*`);
  }

  await sendReply(chatId, lines.join("\n"));
}

export async function handleStatus(chatId: number): Promise<void> {
  const now = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const text = [
    `✅ *Tracker ativo!*`,
    ``,
    `🕐 ${now}`,
    `🛫 Origem: ${config.search.origin}`,
    `🎯 Destinos: ${config.search.destinations.join(", ")}`,
    `📅 Data monitorada: ${config.search.departureDate}`,
    `💰 Threshold: ${formatBRL(config.search.maxPriceBRL)}`,
  ].join("\n");
  await sendReply(chatId, text);
}

export async function handleUpdate(update: TelegramUpdate): Promise<void> {
  const msg = update.message;
  if (!msg?.text) return;

  const chatId = msg.chat.id;
  const text = msg.text.trim();

  // Extrai comando e argumento, removendo sufixo do bot (ex: /buscar@MeuBot → /buscar)
  const [rawCmd, ...args] = text.split(/\s+/);
  const cmd = rawCmd.split("@")[0].toLowerCase();
  const arg = args.join(" ").trim();

  console.log(`[webhook] Comando recebido: ${cmd} ${arg} (chat ${chatId})`);

  try {
    if (cmd === "/buscar") {
      await handleBuscar(chatId, arg);
    } else if (cmd === "/historico") {
      await handleHistorico(chatId, arg);
    } else if (cmd === "/status") {
      await handleStatus(chatId);
    } else {
      await sendReply(
        chatId,
        `❓ Comando não reconhecido.\n\nComandos disponíveis:\n• /buscar GRU\n• /historico GRU\n• /status`
      );
    }
  } catch (err) {
    console.error(`[webhook] Erro ao processar comando ${cmd}:`, err);
    await sendReply(chatId, `❌ Erro interno ao processar o comando.`).catch(() => {});
  }
}

export function createWebhookServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end("Method Not Allowed");
      return;
    }

    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", async () => {
      try {
        const update: TelegramUpdate = JSON.parse(body);
        await handleUpdate(update);
      } catch (err) {
        console.error("[webhook] Erro ao processar update:", err);
      } finally {
        // Sempre retorna 200 para o Telegram não reenviar o update
        res.writeHead(200);
        res.end("OK");
      }
    });
  });

  return server;
}

export function startWebhookServer(): void {
  const server = createWebhookServer();
  server.listen(WEBHOOK_PORT, () => {
    console.log(`[webhook] Servidor iniciado na porta ${WEBHOOK_PORT}`);
    console.log(`[webhook] Comandos disponíveis: /buscar, /historico, /status`);
  });
}
