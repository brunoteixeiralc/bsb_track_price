import { config } from "../config";
import { SearchParams } from "../types";
import { searchWithApify } from "../apis/apify";
import { searchWithRapidAPI } from "../apis/rapidapi";
import { loadHistory } from "./history";
import { formatBRL } from "./currency";
import { sendReply } from "./webhook";

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
      await sendReply(chatId, `❌ Falha ao buscar voos ${config.search.origin} → ${dest}.`);
      return;
    }
  }

  if (flights.length === 0) {
    await sendReply(chatId, `✈️ Nenhum voo encontrado para ${config.search.origin} → ${dest}.`);
    return;
  }

  const sorted = [...flights].sort((a, b) => a.priceBRL - b.priceBRL).slice(0, 3);
  const lines = [
    `✈️ *${config.search.origin} → ${dest}*`,
    `📋 *Melhores preços agora:*`,
  ];

  for (const f of sorted) {
    lines.push(`• ${formatBRL(f.priceBRL)}${f.airline ? ` — ${f.airline}` : ""}`);
  }

  await sendReply(chatId, lines.join("\n"));
}
