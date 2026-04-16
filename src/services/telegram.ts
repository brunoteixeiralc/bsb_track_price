import axios from "axios";
import { config } from "../config";
import { Flight } from "../types";
import { formatBRL } from "./currency";

const BASE_URL = `https://api.telegram.org/bot${config.telegram.botToken}`;
const TIMEOUT_MS = 15_000;

/** Envia mensagem genérica via Telegram */
export async function sendMessage(text: string, targetChatId?: string | number): Promise<void> {
  const chatId = targetChatId || config.telegram.chatId;
  await axios.post(`${BASE_URL}/sendMessage`, {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
    disable_web_page_preview: true,
  }, { timeout: TIMEOUT_MS });
}

/** Confirmação de que o rastreador está funcionando */
export async function sendHealthCheck(targetChatId?: string | number): Promise<void> {
  const now = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  await sendMessage(`💚 *Tracker ativo* — ${now}`, targetChatId);
}

/** Alerta de uma passagem específica encontrada */
export async function sendFlightAlert(flight: Flight, isHistoricLow = false, targetChatId?: string | number): Promise<void> {
  const emoji = isHistoricLow ? "🔥" : "✈️";
  const title = isHistoricLow ? "*Nível de preço histórico BAIXO!*" : "*Passagem barata encontrada!*";
  
  const lines = [
    `${emoji} ${title}`,
    "",
    `🛫 *${flight.origin} → ${flight.destination}*`,
    `🏷️ ${flight.tripType === "round-trip" ? "🔄 Ida e Volta" : "✈️ Somente Ida"}`,
    `📅 Ida: ${flight.departureDate}`,
    flight.returnDate ? `📅 Volta: ${flight.returnDate}` : "",
    flight.airline ? `🏢 ${flight.airline}` : "",
    `💰 *${formatBRL(flight.priceBRL)}*`,
    "",
    `🔗 [Ver passagem](${flight.link})`,
    `_Fonte: ${flight.source}_`,
  ].filter(Boolean);

  await sendMessage(lines.join("\n"), targetChatId);
}

export async function sendSummary(belowThreshold: number, total: number, route: string, targetChatId?: string | number): Promise<void> {
  // Opcional: resumo silencioso ou apenas logs
  console.log(`[telegram] Resumo ${route}: ${belowThreshold} de ${total} voos abaixo do threshold.`);
}

export async function sendDateRangeSummary(
  route: string, 
  daysChecked: number, 
  bestFlight: Flight | null, 
  threshold: number,
  tripType: string,
  start: string,
  end: string,
  targetChatId?: string | number
): Promise<void> {
  if (!bestFlight) return;

  const lines = [
    `🗓️ *${route}* (${tripType === "round-trip" ? "🔄 Ida e Volta" : "✈️ Somente Ida"})`,
    `Período: ${start} até ${end}`,
    `${daysChecked} data(s) verificada(s).`,
    "",
    bestFlight.priceBRL <= threshold
      ? `✅ Melhor preço: *${formatBRL(bestFlight.priceBRL)}* em ${bestFlight.departureDate}`
      : `ℹ️ Mínimo encontrado: ${formatBRL(bestFlight.priceBRL)} em ${bestFlight.departureDate} (acima de ${formatBRL(threshold)})`,
  ];

  await sendMessage(lines.join("\n"), targetChatId);
}

export async function sendErrorAlert(route: string, message: string, targetChatId?: string | number): Promise<void> {
  await sendMessage(`❌ *Erro no Tracker (${route})*\n${message}`, targetChatId);
}

export async function sendAntiSpamNotice(route: string, current: number, previous: number, targetChatId?: string | number): Promise<void> {
  // Ativado apenas em debug se quiser ver por que não notificou
  console.log(`[anti-spam] ${route}: ${formatBRL(current)} não é ≥5% menor que ${formatBRL(previous)}`);
}

export async function sendWeeklyReport(summaries: any[], targetChatId?: string | number): Promise<void> {
  const lines = [
    "📊 *Relatório Semanal de Passagens*",
    `📅 ${new Date().toLocaleString("pt-BR")}`,
    "",
  ];

  for (const s of summaries) {
    const trendEmoji = s.trend === "down" ? "📉" : s.trend === "up" ? "📈" : "➡️";
    lines.push(`✈️ *${s.route}*`);
    lines.push(`💰 Min esta semana: ${s.currentWeekMin ? formatBRL(s.currentWeekMin) : "sem dados"}`);
    lines.push(`📊 Semana anterior: ${s.previousWeekMin ? formatBRL(s.previousWeekMin) : "sem dados"}`);
    if (s.currentWeekMin && s.previousWeekMin) {
      const diff = s.currentWeekMin - s.previousWeekMin;
      const pct = (diff / s.previousWeekMin) * 100;
      lines.push(`${trendEmoji} Variação: ${pct > 0 ? "+" : ""}${pct.toFixed(1)}% (${formatBRL(diff)})`);
    } else {
      lines.push(`${trendEmoji} Tendência: estável ou sem dados.`);
    }
    lines.push("");
  }

  lines.push(`_${summaries.length} rota(s) monitorada(s)_`);
  await sendMessage(lines.join("\n"), targetChatId);
}
