import http from "http";
import axios, { isAxiosError } from "axios";
import { config } from "../config";
import { SearchParams } from "../types";
import { searchWithApify } from "../apis/apify";
import { searchWithRapidAPI } from "../apis/rapidapi";
import { loadHistory } from "./history";
import { formatBRL } from "./currency";
import * as userService from "./user";
import { getDb } from "./db";

const BASE_URL = `https://api.telegram.org/bot${config.telegram.botToken}`;
const TIMEOUT_MS = 10_000;
const WEBHOOK_PORT = Number(process.env.WEBHOOK_PORT ?? "3000");

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name: string; username?: string };
    chat: { id: number; type: string };
    text?: string;
  };
}

export async function sendReply(chatId: number | string, text: string): Promise<void> {
  try {
    await axios.post(`${BASE_URL}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    }, { timeout: TIMEOUT_MS });
  } catch (err) {
    console.error(`[webhook] Erro ao enviar resposta para ${chatId}:`, err instanceof Error ? err.message : err);
  }
}

async function handleStart(chatId: string, firstName?: string, username?: string): Promise<void> {
  await userService.saveUser(chatId, firstName, username);
  
  if (chatId === config.telegram.chatId) {
    // É o administrador
    const db = getDb();
    await db.execute({
      sql: "UPDATE users SET is_authorized = 1 WHERE chat_id = ?",
      args: [chatId]
    });
    await sendReply(chatId, "👋 Olá, Administrador! Você está autorizado.\n\nComandos:\n/status - Ver configuração\n/buscar DESTINO - Busca rápida\n/alerta ORIGEM DESTINO DATA PRECO\n/meusalertas - Lista alertas\n/autorizar ID - Autoriza novo usuário");
    return;
  }

  const authorized = await userService.isUserAuthorized(chatId);
  if (authorized) {
    await sendReply(chatId, `👋 Olá ${firstName}! Você está autorizado.\n\nUse /alerta para monitorar passagens.`);
  } else {
    await sendReply(chatId, `👋 Olá ${firstName}!\n\nSeu acesso está **pendente**. \n\nInforme seu ID ao administrador para liberação:\n🆔 \`${chatId}\``);
  }
}

async function handleAutorizar(adminId: string, targetId: string): Promise<void> {
  if (adminId !== config.telegram.chatId) return;
  
  const db = getDb();
  await db.execute({
    sql: "UPDATE users SET is_authorized = 1 WHERE chat_id = ?",
    args: [targetId]
  });
  
  await sendReply(adminId, `✅ Usuário ${targetId} autorizado com sucesso!`);
  await sendReply(targetId, "🎉 Parabéns! Você acaba de ser **autorizado**.\n\nUse `/alerta ORIGEM DESTINO DATA PRECO` para começar.");
}

async function handleNovoAlerta(chatId: string, args: string[]): Promise<void> {
  // Formato: /alerta BSB GRU 2026-10-12 500
  if (args.length < 4) {
    await sendReply(chatId, "❌ Formato inválido.\nUse: `/alerta ORIGEM DESTINO DATA PRECO`\nEx: `/alerta BSB GRU 20/07/2026 350`\n\n(Para ida e volta, use: `/alerta BSB GRU 10/10/2026 20/10/2026 800`)");
    return;
  }

  const origin = args[0].toUpperCase();
  const destination = args[1].toUpperCase();
  const isRoundTrip = args.length === 5;
  
  let departureDate = args[2];
  let returnDate = isRoundTrip ? args[3] : undefined;
  let priceStr = isRoundTrip ? args[4] : args[3];

  // Pequeno tratamento de data (converte XX/XX/XXXX para YYYY-MM-DD se necessário)
  if (departureDate.includes("/")) {
    departureDate = departureDate.split("/").reverse().join("-");
  }
  if (returnDate?.includes("/")) {
    returnDate = returnDate.split("/").reverse().join("-");
  }

  const maxPrice = parseFloat(priceStr.replace(/[^0-9.]/g, ""));

  await userService.addAlert({
    chat_id: chatId,
    origin,
    destination,
    departure_date: departureDate,
    return_date: returnDate,
    trip_type: isRoundTrip ? "round-trip" : "one-way",
    max_price_brl: maxPrice,
    is_active: true
  });

  await sendReply(chatId, `✅ Alerta criado!\n\n🛫 ${origin} → ${destination}\n📅 Ida: ${departureDate}${returnDate ? `\n📅 Volta: ${returnDate}` : ""}\n💰 Quando o preço for ≤ *${formatBRL(maxPrice)}* eu te aviso!`);
}

async function handleMeusAlertas(chatId: string): Promise<void> {
  const alerts = await userService.listUserAlerts(chatId);
  if (alerts.length === 0) {
    await sendReply(chatId, "📭 Você não possui alertas ativos.");
    return;
  }

  const lines = ["📋 *Seus Alertas Ativos:*", ""];
  for (const a of alerts) {
    lines.push(`🆔 \`/remover ${a.id}\``);
    lines.push(`🛫 *${a.origin} → ${a.destination}*`);
    lines.push(`📅 ${a.departure_date}${a.return_date ? ` (Volta: ${a.return_date})` : ""}`);
    lines.push(`💰 Limite: ${formatBRL(a.max_price_brl)}`);
    lines.push("");
  }

  await sendReply(chatId, lines.join("\n"));
}

export async function handleUpdate(update: TelegramUpdate): Promise<void> {
  const msg = update.message;
  if (!msg?.text) return;

  const chatId = String(msg.chat.id);
  const firstName = msg.from?.first_name;
  const username = msg.from?.username;
  const text = msg.text.trim();

  const [rawCmd, ...args] = text.split(/\s+/);
  const cmd = rawCmd.split("@")[0].toLowerCase();

  // Comandos públicos/iniciais
  if (cmd === "/start") {
    await handleStart(chatId, firstName, username);
    return;
  }

  // Verifica autorização para os demais comandos
  const authorized = await userService.isUserAuthorized(chatId);
  if (!authorized) {
    await sendReply(chatId, "❌ Acesso negado. Por favor, aguarde a autorização do administrador.");
    return;
  }

  try {
    if (cmd === "/alerta") {
      await handleNovoAlerta(chatId, args);
    } else if (cmd === "/meusalertas") {
      await handleMeusAlertas(chatId);
    } else if (cmd === "/remover") {
      const id = parseInt(args[0]);
      const ok = await userService.removeAlert(chatId, id);
      await sendReply(chatId, ok ? `🗑️ Alerta ${id} removido.` : "❌ Alerta não encontrado.");
    } else if (cmd === "/autorizar") {
      await handleAutorizar(chatId, args[0]);
    } else if (cmd === "/status") {
      // Reaproveitando sua lógica original de /status para o admin
      const now = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
      await sendReply(chatId, `✅ *Status Admin*\n🕐 ${now}\n🛫 Origem padrão: ${config.search.origin}\n🚀 Servidor Railway Ativo`);
    } else if (cmd === "/buscar") {
      // Sua lógica original de busca rápida
      const { handleBuscar } = await import("./webhook_legacy"); // Movi sua lógica anterior para um auxiliar
      await handleBuscar(parseInt(chatId), args.join(" "));
    }
  } catch (err) {
    console.error(`[webhook] Erro comando ${cmd}:`, err);
    await sendReply(chatId, "❌ Erro ao processar comando.");
  }
}

export function startWebhookServer(): void {
  const server = http.createServer(async (req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk.toString()));
    req.on("end", async () => {
      try {
        const update: TelegramUpdate = JSON.parse(body);
        await handleUpdate(update);
      } catch (err) {
        console.error("[webhook] Erro no body:", err);
      } finally {
        res.writeHead(200);
        res.end("OK");
      }
    });
  });

  server.listen(WEBHOOK_PORT, () => {
    console.log(`[webhook] Servidor multi-usuário na porta ${WEBHOOK_PORT}`);
  });
}
