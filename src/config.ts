import dotenv from "dotenv";
dotenv.config();

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export const config = {
  apify: {
    // Suporte a até 5 tokens. Se um ficar sem créditos, o próximo é tentado automaticamente.
    // Compatibilidade retroativa: APIFY_API_TOKEN (sem número) funciona como APIFY_API_TOKEN_1.
    tokens: (() => {
      const tokens: string[] = [];
      for (let i = 1; i <= 5; i++) {
        const val = process.env[`APIFY_API_TOKEN_${i}`]
          ?? (i === 1 ? process.env.APIFY_API_TOKEN : undefined);
        if (val) tokens.push(val.trim());
      }
      if (tokens.length === 0) {
        throw new Error("Missing required env var: APIFY_API_TOKEN_1 (ou APIFY_API_TOKEN)");
      }
      return tokens;
    })(),
    actorId: process.env.APIFY_ACTOR_ID || "johnvc~google-flights-data-scraper-flight-and-price-search",
  },
  rapidapi: {
    key: required("RAPIDAPI_KEY"),
    // Host da API de voos no RapidAPI — ajuste conforme a API escolhida
    // Sugestão: "sky-scrapper.p.rapidapi.com" (Skyscanner unofficial)
    host: process.env.RAPIDAPI_HOST ?? "sky-scrapper.p.rapidapi.com",
  },
  telegram: {
    botToken: required("TELEGRAM_BOT_TOKEN"),
    chatId: required("TELEGRAM_CHAT_ID"),
  },
  search: {
    // Suporte a múltiplas origens via ORIGINS=BSB,GRU (ou ORIGIN=BSB para retrocompatibilidade).
    // Se ORIGINS estiver definido, tem prioridade; caso contrário usa ORIGIN.
    origins: (() => {
      const raw = process.env.ORIGINS ?? process.env.ORIGIN;
      if (!raw) return ["BSB"];
      return raw.split(",").map((s) => s.trim()).filter(Boolean);
    })(),
    // Alias de conveniência para a primeira origem (retrocompatibilidade com webhook e outros usos).
    origin: (() => {
      const raw = process.env.ORIGINS ?? process.env.ORIGIN;
      if (!raw) return "BSB";
      return (raw.split(",")[0] ?? "BSB").trim();
    })(),
    destinations: (() => {
      const raw = process.env.DESTINATIONS ?? process.env.DESTINATION;
      if (!raw) throw new Error("Missing required env var: DESTINATIONS");
      return raw.split(",").map((s) => s.trim()).filter(Boolean);
    })(),
    departureDate: (() => {
      if (process.env.DEPARTURE_DATE) return process.env.DEPARTURE_DATE;
      const offset = Number(process.env.DEPARTURE_DATE_OFFSET ?? "0");
      const date = new Date();
      date.setDate(date.getDate() + offset);
      return date.toISOString().split("T")[0];
    })(),
    dateRangeDays: Number(process.env.DATE_RANGE_DAYS ?? "1"),
    adults: Number(process.env.ADULTS ?? "1"),
    children: Number(process.env.CHILDREN ?? "0"),
    tripType: (() => {
      const t = process.env.TRIP_TYPE ?? "one-way";
      if (t !== "one-way" && t !== "round-trip") {
        throw new Error("TRIP_TYPE deve ser 'one-way' ou 'round-trip'");
      }
      return t as "one-way" | "round-trip";
    })(),
    returnDate: (() => {
      const tripType = process.env.TRIP_TYPE ?? "one-way";
      if (tripType === "round-trip") {
        if (!process.env.RETURN_DATE) {
          throw new Error("Missing required env var: RETURN_DATE (obrigatório para round-trip)");
        }
        return process.env.RETURN_DATE;
      }
      return undefined;
    })(),
    maxPriceBRL: Number(process.env.MAX_PRICE_BRL ?? "300"),
    priceDropThreshold: Number(process.env.PRICE_DROP_THRESHOLD ?? "0.95"),
    historyRetentionDays: Number(process.env.HISTORY_RETENTION_DAYS ?? "365"),
  },
  filters: {
    // Lista de companhias permitidas (ex: "LATAM,GOL"). Se vazio, aceita todas.
    airlinesWhitelist: (() => {
      const raw = process.env.AIRLINES_WHITELIST;
      if (!raw) return [] as string[];
      return raw.split(",").map((s) => s.trim()).filter(Boolean);
    })(),
    // Número máximo de escalas (0 = só voos diretos). Se não definido, aceita qualquer número.
    maxStops: process.env.MAX_STOPS !== undefined && process.env.MAX_STOPS !== ""
      ? Number(process.env.MAX_STOPS)
      : undefined,
    // Duração máxima do voo em horas. Se não definido, aceita qualquer duração.
    maxDurationHours: process.env.MAX_DURATION_HOURS !== undefined && process.env.MAX_DURATION_HOURS !== ""
      ? Number(process.env.MAX_DURATION_HOURS)
      : undefined,
  },
};
