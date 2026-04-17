import { config } from "../config";
import { SearchParams } from "../types";
import { searchWithApify } from "../apis/apify";
import { searchWithRapidAPI } from "../apis/rapidapi";
import { loadHistory } from "./history";
import { formatBRL } from "./currency";
import { sendReply } from "./webhook";

export async function handleBuscar(chatId: number, args: string[]): Promise<void> {
  if (args.length === 0) {
    await sendReply(chatId, "❌ *Uso detalhado do comando /buscar:*\n\n1️⃣ `/buscar DESTINO`\n_(Usa a origem padrão e a data configurada no sistema)_\n\n2️⃣ `/buscar ORIGEM DESTINO`\n_(Usa a data configurada no sistema)_\n\n3️⃣ `/buscar ORIGEM DESTINO DATA_IDA`\n_(Busca numa data específica. Ex: /buscar BSB GRU 20/07/2026)_");
    return;
  }

  let origin = config.search.origin;
  let dest = "";
  let depDate = config.search.departureDate;

  if (args.length === 1) {
    dest = args[0].toUpperCase();
  } else if (args.length === 2) {
    origin = args[0].toUpperCase();
    dest = args[1].toUpperCase();
  } else if (args.length >= 3) {
    origin = args[0].toUpperCase();
    dest = args[1].toUpperCase();
    let dDate = args[2];
    if (dDate.includes("/")) dDate = dDate.split("/").reverse().join("-");
    depDate = dDate;
  }

  await sendReply(chatId, `🔍 Buscando voos...\n🛫 ${origin} → ${dest}\n📅 Data: ${depDate}\n\nAguarde, isso pode levar alguns segundos...`);

  const params: SearchParams = {
    origin,
    destination: dest,
    departureDate: depDate,
    returnDate: undefined,
    tripType: "one-way",
    ignoreMaxPrice: true,
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
