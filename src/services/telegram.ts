import axios from "axios";
import { config } from "../config";
import { Flight, TripType, WeeklyRouteSummary } from "../types";
import { formatBRL, convertToBRL } from "./currency";

const BASE_URL = `https://api.telegram.org/bot${config.telegram.botToken}`;
const TIMEOUT_MS = 10_000;

const PRICE_LEVEL_PT: Record<"low" | "typical" | "high", string> = {
  low: "BAIXO",
  typical: "TÍPICO",
  high: "ALTO",
};

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-");
  return `${day}/${month}/${year}`;
}

async function buildMessage(flight: Flight): Promise<string> {
  const tripLabel = flight.tripType === "round-trip" ? "🔄 Ida e Volta" : "✈️ Somente Ida";

  const lines = [
    `✈️ *Passagem barata encontrada!*`,
    ``,
    `🛫 *${flight.origin} → ${flight.destination}*`,
    `🏷️ ${tripLabel}`,
    `📅 Ida: ${formatDate(flight.departureDate)}`,
  ];

  if (flight.returnDate) {
    lines.push(`📅 Volta: ${formatDate(flight.returnDate)}`);
  }

  if (flight.airline) {
    lines.push(`🏢 ${flight.airline}`);
  }

  lines.push(`💰 *${formatBRL(flight.priceBRL)}*`);

  if (flight.source === "apify" && flight.priceInsights) {
    const pi = flight.priceInsights;
    const levelLabel = PRICE_LEVEL_PT[pi.priceLevel];
    const [rangeMinUSD, rangeMaxUSD] = pi.typicalPriceRange;
    const rangeMinBRL = await convertToBRL(rangeMinUSD, "USD");
    const rangeMaxBRL = await convertToBRL(rangeMaxUSD, "USD");

    lines.push(``);
    lines.push(`📊 Nível: *${levelLabel}* — faixa típica ${formatBRL(rangeMinBRL)} – ${formatBRL(rangeMaxBRL)}`);

    const midpointBRL = (rangeMinBRL + rangeMaxBRL) / 2;
    const diffPct = Math.round(((midpointBRL - flight.priceBRL) / midpointBRL) * 100);

    if (diffPct > 0) {
      lines.push(`💡 Este preço está ${diffPct}% abaixo da média histórica`);
    } else if (diffPct < 0) {
      lines.push(`💡 Este preço está ${Math.abs(diffPct)}% acima da média histórica`);
    }
  }

  lines.push(``);
  lines.push(`🔗 [Ver passagem](${flight.link})`);
  lines.push(``);
  lines.push(`_Fonte: ${flight.source}_`);

  return lines.join("\n");
}

export async function sendFlightAlert(flight: Flight): Promise<void> {
  const text = await buildMessage(flight);

  try {
    await axios.post(`${BASE_URL}/sendMessage`, {
      chat_id: config.telegram.chatId,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: false,
    }, { timeout: TIMEOUT_MS });
    console.log(`[telegram] Alerta enviado: ${flight.origin}→${flight.destination} ${formatBRL(flight.priceBRL)}`);
  } catch (err) {
    console.error("[telegram] Erro ao enviar mensagem:", err);
    throw err;
  }
}

export async function sendErrorAlert(route: string, details: string): Promise<void> {
  const now = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const text = [
    `⚠️ *${route}* — falha em todas as fontes de dados.`,
    `📋 ${details}`,
    `🕐 ${now}`,
  ].join("\n");

  try {
    await axios.post(`${BASE_URL}/sendMessage`, {
      chat_id: config.telegram.chatId,
      text,
      parse_mode: "Markdown",
    }, { timeout: TIMEOUT_MS });
    console.log(`[telegram] Alerta de erro enviado para ${route}`);
  } catch (err) {
    console.error("[telegram] Erro ao enviar alerta de falha:", err);
  }
}

export async function sendHealthCheck(): Promise<void> {
  const now = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const text = `💚 *Tracker ativo* — ${now}`;
  try {
    await axios.post(`${BASE_URL}/sendMessage`, {
      chat_id: config.telegram.chatId,
      text,
      parse_mode: "Markdown",
    }, { timeout: TIMEOUT_MS });
    console.log("[telegram] Health check enviado.");
  } catch (err) {
    console.error("[telegram] Erro ao enviar health check:", err);
  }
}

export async function sendDateRangeSummary(
  route: string,
  datesChecked: number,
  bestFlight: Flight | null,
  threshold: number,
  tripType: TripType = "one-way"
): Promise<void> {
  const tripLabel = tripType === "round-trip" ? "🔄 Ida e Volta" : "✈️ Somente Ida";
  const noBest = !bestFlight || bestFlight.priceBRL > threshold;
  const text = noBest
    ? `🗓️ *${route}* (${tripLabel}) — ${datesChecked} data(s) verificada(s). Nenhum voo abaixo de ${formatBRL(threshold)}.`
    : `🗓️ *${route}* (${tripLabel}) — ${datesChecked} data(s) verificada(s).\n💰 Melhor: *${formatBRL(bestFlight!.priceBRL)}* em ${formatDate(bestFlight!.departureDate)}${bestFlight!.airline ? ` (${bestFlight!.airline})` : ""}`;

  try {
    await axios.post(`${BASE_URL}/sendMessage`, {
      chat_id: config.telegram.chatId,
      text,
      parse_mode: "Markdown",
    }, { timeout: TIMEOUT_MS });
  } catch (err) {
    console.error("[telegram] Erro ao enviar resumo de intervalo:", err);
  }
}

export async function sendSummary(found: number, checked: number, route?: string): Promise<void> {
  const prefix = route ? `${route} — ` : "";
  const text = found === 0
    ? `🔍 ${prefix}Nenhuma passagem abaixo do threshold (${checked} opções verificadas).`
    : `✅ ${prefix}${found} passagem(ns) encontrada(s) abaixo do threshold!`;

  try {
    await axios.post(`${BASE_URL}/sendMessage`, {
      chat_id: config.telegram.chatId,
      text,
    }, { timeout: TIMEOUT_MS });
  } catch (err) {
    console.error("[telegram] Erro ao enviar resumo:", err);
  }
}

export async function sendWeeklyReport(summaries: WeeklyRouteSummary[]): Promise<void> {
  const now = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

  if (summaries.length === 0) {
    const text = `📊 *Relatório Semanal* — ${now}\n\nNenhuma rota monitorada nesta semana.`;
    try {
      await axios.post(`${BASE_URL}/sendMessage`, {
        chat_id: config.telegram.chatId,
        text,
        parse_mode: "Markdown",
      }, { timeout: TIMEOUT_MS });
      console.log("[telegram] Relatório semanal enviado (sem rotas).");
    } catch (err) {
      console.error("[telegram] Erro ao enviar relatório semanal:", err);
      throw err;
    }
    return;
  }

  const lines: string[] = [
    `📊 *Relatório Semanal de Passagens*`,
    `📅 ${now}`,
    ``,
  ];

  for (const s of summaries) {
    const trendEmoji =
      s.trend === "up" ? "📈" :
      s.trend === "down" ? "📉" :
      s.trend === "stable" ? "➡️" : "❓";

    lines.push(`✈️ *${s.route}*`);

    if (s.currentWeekMin !== null) {
      lines.push(`💰 Menor preço esta semana: *${formatBRL(s.currentWeekMin)}*`);
    } else {
      lines.push(`💰 Sem dados esta semana`);
    }

    if (s.previousWeekMin !== null) {
      lines.push(`📊 Semana anterior: ${formatBRL(s.previousWeekMin)}`);
    } else {
      lines.push(`📊 Semana anterior: sem dados`);
    }

    if (s.currentWeekMin !== null && s.previousWeekMin !== null) {
      const diff = s.currentWeekMin - s.previousWeekMin;
      const pct = ((diff / s.previousWeekMin) * 100).toFixed(1);
      const sign = diff > 0 ? "+" : "";
      lines.push(`${trendEmoji} Variação: ${sign}${pct}% (${sign}${formatBRL(diff)})`);
    } else {
      lines.push(`${trendEmoji} Tendência: sem dados suficientes para comparar`);
    }

    lines.push(``);
  }

  const totalChecks = summaries.reduce((acc, s) => acc + s.checksThisWeek, 0);
  lines.push(`_${totalChecks} verificação(ões) realizadas esta semana_`);

  const text = lines.join("\n");

  try {
    await axios.post(`${BASE_URL}/sendMessage`, {
      chat_id: config.telegram.chatId,
      text,
      parse_mode: "Markdown",
    }, { timeout: TIMEOUT_MS });
    console.log(`[telegram] Relatório semanal enviado com ${summaries.length} rota(s).`);
  } catch (err) {
    console.error("[telegram] Erro ao enviar relatório semanal:", err);
    throw err;
  }
}
