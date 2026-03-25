import axios from "axios";
import { config } from "../config";
import { Flight } from "../types";
import { formatBRL } from "./currency";

const BASE_URL = `https://api.telegram.org/bot${config.telegram.botToken}`;

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-");
  return `${day}/${month}/${year}`;
}

function buildMessage(flight: Flight): string {
  const lines = [
    `✈️ *Passagem barata encontrada!*`,
    ``,
    `🛫 *${flight.origin} → ${flight.destination}*`,
    `📅 Ida: ${formatDate(flight.departureDate)}`,
  ];

  if (flight.returnDate) {
    lines.push(`📅 Volta: ${formatDate(flight.returnDate)}`);
  }

  if (flight.airline) {
    lines.push(`🏢 ${flight.airline}`);
  }

  lines.push(`💰 *${formatBRL(flight.priceBRL)}*`);
  lines.push(``);
  lines.push(`🔗 [Ver passagem](${flight.link})`);
  lines.push(``);
  lines.push(`_Fonte: ${flight.source}_`);

  return lines.join("\n");
}

export async function sendFlightAlert(flight: Flight): Promise<void> {
  const text = buildMessage(flight);

  try {
    await axios.post(`${BASE_URL}/sendMessage`, {
      chat_id: config.telegram.chatId,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: false,
    });
    console.log(`[telegram] Alerta enviado: ${flight.origin}→${flight.destination} ${formatBRL(flight.priceBRL)}`);
  } catch (err) {
    console.error("[telegram] Erro ao enviar mensagem:", err);
    throw err;
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
    });
    console.log("[telegram] Health check enviado.");
  } catch (err) {
    console.error("[telegram] Erro ao enviar health check:", err);
  }
}

export async function sendDateRangeSummary(
  route: string,
  datesChecked: number,
  bestFlight: Flight | null,
  threshold: number
): Promise<void> {
  const noBest = !bestFlight || bestFlight.priceBRL > threshold;
  const text = noBest
    ? `🗓️ *${route}* — ${datesChecked} data(s) verificada(s). Nenhum voo abaixo de ${formatBRL(threshold)}.`
    : `🗓️ *${route}* — ${datesChecked} data(s) verificada(s).\n💰 Melhor: *${formatBRL(bestFlight!.priceBRL)}* em ${formatDate(bestFlight!.departureDate)}${bestFlight!.airline ? ` (${bestFlight!.airline})` : ""}`;

  try {
    await axios.post(`${BASE_URL}/sendMessage`, {
      chat_id: config.telegram.chatId,
      text,
      parse_mode: "Markdown",
    });
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
    });
  } catch (err) {
    console.error("[telegram] Erro ao enviar resumo:", err);
  }
}
