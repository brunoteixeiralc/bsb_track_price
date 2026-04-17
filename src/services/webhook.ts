import http from "http";
import axios from "axios";
import { config } from "../config";
import { formatBRL } from "./currency";
import * as userService from "./user";
import { getDb } from "./db";

const BASE_URL = `https://api.telegram.org/bot${config.telegram.botToken}`;
const TIMEOUT_MS = 10_000;
// Railway injeta $PORT dinamicamente — tem prioridade sobre WEBHOOK_PORT
const WEBHOOK_PORT = Number(process.env.PORT ?? process.env.WEBHOOK_PORT ?? "3000");

// ── Tipos Telegram ──────────────────────────────────────────────────────────

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name: string; username?: string };
    chat: { id: number; type: string };
    text?: string;
  };
  callback_query?: {
    id: string;
    from: { id: number; first_name: string; username?: string };
    message?: { message_id: number; chat: { id: number } };
    data?: string;
  };
}

// ── Helpers de API do Telegram ──────────────────────────────────────────────

export async function sendReply(chatId: number | string, text: string): Promise<void> {
  try {
    await axios.post(
      `${BASE_URL}/sendMessage`,
      { chat_id: chatId, text, parse_mode: "Markdown", disable_web_page_preview: true },
      { timeout: TIMEOUT_MS }
    );
  } catch (err) {
    console.error(`[webhook] Erro ao enviar mensagem para ${chatId}:`, err instanceof Error ? err.message : err);
  }
}

/**
 * Envia mensagem com teclado inline (botões).
 * Retorna o message_id da mensagem enviada, ou null em caso de falha.
 */
export async function sendWithInlineKeyboard(
  chatId: string,
  text: string,
  keyboard: { text: string; callback_data: string }[][]
): Promise<number | null> {
  try {
    const res = await axios.post<{ ok: boolean; result: { message_id: number } }>(
      `${BASE_URL}/sendMessage`,
      {
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: keyboard },
      },
      { timeout: TIMEOUT_MS }
    );
    return res.data.result?.message_id ?? null;
  } catch (err) {
    console.error("[webhook] Erro ao enviar mensagem com botões:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Responde a um callback_query — indispensável para remover o "carregando" do botão. */
async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  try {
    await axios.post(
      `${BASE_URL}/answerCallbackQuery`,
      { callback_query_id: callbackQueryId, text: text ?? "" },
      { timeout: TIMEOUT_MS }
    );
  } catch {
    // Silencioso — não impede o fluxo principal
  }
}

/** Edita o texto de uma mensagem já enviada (remove os botões após ação). */
async function editMessageText(chatId: string, messageId: number, text: string): Promise<void> {
  try {
    await axios.post(
      `${BASE_URL}/editMessageText`,
      { chat_id: chatId, message_id: messageId, text, parse_mode: "Markdown" },
      { timeout: TIMEOUT_MS }
    );
  } catch {
    // Silencioso — mensagem pode ter expirado
  }
}

// ── Handlers de Comandos ────────────────────────────────────────────────────

/**
 * Notifica o admin que um novo usuário iniciou o bot,
 * com botões inline para autorizar ou recusar.
 */
async function notifyAdminNewUser(chatId: string, firstName?: string, username?: string): Promise<void> {
  const name = firstName ?? "Sem nome";
  const handle = username ? `@${username}` : "sem username";
  const text =
    `🆕 *Novo usuário solicitando acesso*\n\n` +
    `👤 Nome: ${name}\n` +
    `🔗 Username: ${handle}\n` +
    `🆔 ID: \`${chatId}\``;

  await sendWithInlineKeyboard(config.telegram.chatId, text, [[
    { text: "✅ Autorizar", callback_data: `authorize:${chatId}` },
    { text: "❌ Recusar",   callback_data: `reject:${chatId}`    },
  ]]);
}

async function handleStart(chatId: string, firstName?: string, username?: string): Promise<void> {
  // Verifica se é usuário novo ANTES de salvar — evita notificar admin novamente
  const existingUser = await userService.getUserInfo(chatId);
  const isNewUser = existingUser === null;

  await userService.saveUser(chatId, firstName, username);

  // Admin é sempre autorizado automaticamente
  if (chatId === config.telegram.chatId) {
    const db = getDb();
    await db.execute({ sql: "UPDATE users SET is_authorized = 1 WHERE chat_id = ?", args: [chatId] });
    await sendReply(
      chatId,
      "👋 Olá, Administrador! Você está autorizado.\n\n" +
      "Comandos:\n" +
      "/status — Ver configuração\n" +
      "/buscar DESTINO — Busca rápida\n" +
      "/alerta ORIGEM DESTINO DATA PRECO\n" +
      "/meusalertas — Lista alertas\n" +
      "/autorizar ID — Autoriza novo usuário"
    );
    return;
  }

  // Já autorizado
  if (existingUser?.is_authorized === 1) {
    await sendReply(chatId, `👋 Olá ${firstName}! Você está autorizado.\n\nUse /alerta para monitorar passagens.`);
    return;
  }

  // Acesso recusado
  if (existingUser?.is_authorized === -1) {
    await sendReply(chatId, `❌ Olá ${firstName}. Infelizmente seu acesso foi negado.`);
    return;
  }

  // Pendente de aprovação — avisa o usuário
  await sendReply(
    chatId,
    `👋 Olá ${firstName}!\n\n` +
    `Seu acesso está *pendente de aprovação*.\n` +
    `Você receberá uma mensagem assim que o administrador liberar o seu acesso.`
  );

  // Notifica o admin UMA ÚNICA VEZ (apenas se usuário é realmente novo)
  if (isNewUser) {
    await notifyAdminNewUser(chatId, firstName, username);
  }
}

/**
 * Processa cliques nos botões inline de autorização/recusa.
 * Apenas o admin pode acionar esses botões.
 */
async function handleCallbackQuery(
  callbackQueryId: string,
  fromId: string,
  messageId: number | undefined,
  data: string
): Promise<void> {
  if (fromId !== config.telegram.chatId) {
    console.warn(`[webhook] callback_query de ID não-admin: recebido=${fromId}, esperado=${config.telegram.chatId}`);
    await answerCallbackQuery(callbackQueryId, "❌ Ação não permitida.");
    return;
  }

  const colonIdx = data.indexOf(":");
  const action   = data.slice(0, colonIdx);
  const targetId = data.slice(colonIdx + 1);

  if (!targetId || (action !== "authorize" && action !== "reject")) {
    await answerCallbackQuery(callbackQueryId, "❌ Dados inválidos.");
    return;
  }

  if (action === "authorize") {
    await userService.authorizeUser(targetId);
    await answerCallbackQuery(callbackQueryId, "✅ Usuário autorizado!");
    await sendReply(
      targetId,
      "🎉 Seu acesso foi *aprovado*!\n\n" +
      "Use `/alerta ORIGEM DESTINO DATA PRECO` para começar a monitorar passagens."
    );
    if (messageId) {
      await editMessageText(
        config.telegram.chatId,
        messageId,
        `✅ *Usuário autorizado*\n🆔 ID: \`${targetId}\``
      );
    }
  } else {
    await userService.rejectUser(targetId);
    await answerCallbackQuery(callbackQueryId, "❌ Usuário recusado.");
    await sendReply(targetId, "❌ Seu acesso ao bot foi *negado*.");
    if (messageId) {
      await editMessageText(
        config.telegram.chatId,
        messageId,
        `❌ *Usuário recusado*\n🆔 ID: \`${targetId}\``
      );
    }
  }
}

async function handleAutorizar(adminId: string, targetId: string): Promise<void> {
  if (adminId !== config.telegram.chatId) return;
  await userService.authorizeUser(targetId);
  await sendReply(adminId, `✅ Usuário \`${targetId}\` autorizado com sucesso!`);
  await sendReply(targetId, "🎉 Você acaba de ser *autorizado*.\n\nUse `/alerta ORIGEM DESTINO DATA PRECO` para começar.");
}

async function handleNovoAlerta(chatId: string, args: string[]): Promise<void> {
  if (args.length < 4) {
    await sendReply(chatId, "❌ Formato inválido.\nUse: `/alerta ORIGEM DESTINO DATA PRECO`\nEx: `/alerta BSB GRU 20/07/2026 350`\n\n(Ida e volta: `/alerta BSB GRU 10/10/2026 20/10/2026 800`)");
    return;
  }

  const origin      = args[0].toUpperCase();
  const destination = args[1].toUpperCase();
  const isRoundTrip = args.length === 5;

  let departureDate = args[2];
  let returnDate    = isRoundTrip ? args[3] : undefined;
  const priceStr    = isRoundTrip ? args[4] : args[3];

  if (departureDate.includes("/")) departureDate = departureDate.split("/").reverse().join("-");
  if (returnDate?.includes("/"))   returnDate    = returnDate.split("/").reverse().join("-");

  const maxPrice = parseFloat(priceStr.replace(/[^0-9.]/g, ""));

  await userService.addAlert({
    chat_id: chatId,
    origin,
    destination,
    departure_date: departureDate,
    return_date: returnDate,
    trip_type: isRoundTrip ? "round-trip" : "one-way",
    max_price_brl: maxPrice,
    is_active: true,
  });

  await sendReply(
    chatId,
    `✅ Alerta criado!\n\n` +
    `🛫 ${origin} → ${destination}\n` +
    `📅 Ida: ${departureDate}${returnDate ? `\n📅 Volta: ${returnDate}` : ""}\n` +
    `💰 Quando o preço for ≤ *${formatBRL(maxPrice)}* eu te aviso!`
  );
}

async function handleMeusAlertas(chatId: string): Promise<void> {
  const alerts = await userService.listUserAlerts(chatId);
  if (alerts.length === 0) {
    await sendReply(chatId, "📭 Você não possui alertas ativos.");
    return;
  }

  const lines = ["📋 *Seus Alertas Ativos:*", ""];
  for (const a of alerts) {
    lines.push(`🛫 *${a.origin} → ${a.destination}*`);
    lines.push(`📅 ${a.departure_date}${a.return_date ? ` (Volta: ${a.return_date})` : ""}`);
    lines.push(`💰 Limite: *${formatBRL(a.max_price_brl)}*`);
    lines.push(`🗑️ \`/remover ${a.id}\` | ✏️ \`/editar ${a.id} NOVO_PREÇO\``);
    lines.push("");
  }

  await sendReply(chatId, lines.join("\n"));
}

async function handleEditarAlerta(chatId: string, args: string[]): Promise<void> {
  if (args.length < 2) {
    await sendReply(chatId, "❌ Formato inválido.\nUse: `/editar ID NOVO_PREÇO`\nEx: `/editar 5 450`");
    return;
  }

  const id       = parseInt(args[0]);
  const newPrice = parseFloat(args[1].replace(/[^0-9.]/g, ""));

  if (isNaN(id) || isNaN(newPrice)) {
    await sendReply(chatId, "❌ ID ou Preço inválidos.");
    return;
  }

  const ok = await userService.updateAlertPrice(chatId, id, newPrice);
  await sendReply(
    chatId,
    ok
      ? `✅ Alerta *${id}* atualizado para *${formatBRL(newPrice)}*!`
      : "❌ Alerta não encontrado ou não pertence a você."
  );
}

// ── Dispatcher principal ────────────────────────────────────────────────────

export async function handleUpdate(update: TelegramUpdate): Promise<void> {
  // Botões inline (callback_query)
  if (update.callback_query) {
    const cq = update.callback_query;
    await handleCallbackQuery(
      cq.id,
      String(cq.from.id),
      cq.message?.message_id,
      cq.data ?? ""
    );
    return;
  }

  const msg = update.message;
  if (!msg?.text) return;

  // Bot é estritamente privado — ignora grupos, supergrupos e canais
  if (msg.chat.type !== "private") return;

  const chatId    = String(msg.chat.id);
  const firstName = msg.from?.first_name;
  const username  = msg.from?.username;
  const text      = msg.text.trim();

  const [rawCmd, ...args] = text.split(/\s+/);
  const cmd = rawCmd.split("@")[0].toLowerCase();

  // /start e /meuid são sempre públicos
  if (cmd === "/start") {
    await handleStart(chatId, firstName, username);
    return;
  }

  if (cmd === "/meuid") {
    await sendReply(chatId, `🆔 Seu ID do Telegram: \`${chatId}\`\n\nSe você é o administrador, confirme que \`TELEGRAM_CHAT_ID\` no Railway está igual a este número.`);
    return;
  }

  // Demais comandos exigem autorização
  const authorized = await userService.isUserAuthorized(chatId);
  if (!authorized) {
    await sendReply(chatId, "❌ Acesso negado. Aguarde a autorização do administrador.");
    return;
  }

  try {
    if (cmd === "/alerta") {
      await handleNovoAlerta(chatId, args);
    } else if (cmd === "/meusalertas") {
      await handleMeusAlertas(chatId);
    } else if (cmd === "/remover") {
      const id = parseInt(args[0]);
      if (isNaN(id)) {
        await sendReply(chatId, "❌ Informe o ID numérico do alerta. Verifique em `/meusalertas`.");
      } else {
        const ok = await userService.removeAlert(chatId, id);
        await sendReply(chatId, ok ? `🗑️ Alerta *${id}* removido com sucesso.` : "❌ Alerta não encontrado ou não pertence a você.");
      }
    } else if (cmd === "/editar") {
      await handleEditarAlerta(chatId, args);
    } else if (cmd === "/autorizar") {
      await handleAutorizar(chatId, args[0]);
    } else if (cmd === "/status") {
      const now = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
      await sendReply(chatId, `✅ *Status Admin*\n🕐 ${now}\n🛫 Origem padrão: ${config.search.origin}\n🚀 Servidor Railway Ativo`);
    } else if (cmd === "/buscar") {
      const { handleBuscar } = await import("./webhook_legacy");
      await handleBuscar(parseInt(chatId), args.join(" "));
    }
  } catch (err) {
    console.error(`[webhook] Erro no comando ${cmd}:`, err);
    await sendReply(chatId, "❌ Erro ao processar comando.");
  }
}

// ── Servidor HTTP ───────────────────────────────────────────────────────────

export function startWebhookServer(): void {
  const server = http.createServer((req, res) => {
    // Health checks do Railway (GET) não têm body — responde e ignora
    if (req.method !== "POST") {
      res.writeHead(200);
      res.end("OK");
      return;
    }

    let body = "";
    req.on("data", (chunk) => (body += chunk.toString()));
    req.on("end", () => {
      // Responde 200 imediatamente para o Telegram não reenviar por timeout
      res.writeHead(200);
      res.end("OK");

      if (!body) return;

      // Processa de forma assíncrona após responder
      (async () => {
        try {
          const update: TelegramUpdate = JSON.parse(body);
          await handleUpdate(update);
        } catch (err) {
          console.error("[webhook] Erro ao processar update:", err instanceof Error ? err.message : err);
        }
      })();
    });
  });

  server.listen(WEBHOOK_PORT, () => {
    console.log(`[webhook] Servidor na porta ${WEBHOOK_PORT}`);
  });
}
