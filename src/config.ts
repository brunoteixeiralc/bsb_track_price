import dotenv from "dotenv";
dotenv.config();

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export const config = {
  apify: {
    token: required("APIFY_API_TOKEN"),
    // Actor ID do scraper de voos no Apify — ajuste conforme o actor que você usar
    // Sugestão: "tri_angle/google-flights-scraper" ou similar
    actorId: process.env.APIFY_ACTOR_ID ?? "tri_angle~google-flights-scraper",
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
    origin: process.env.ORIGIN ?? "BSB",
    destinations: (() => {
      const raw = process.env.DESTINATIONS ?? process.env.DESTINATION;
      if (!raw) throw new Error("Missing required env var: DESTINATIONS");
      return raw.split(",").map((s) => s.trim()).filter(Boolean);
    })(),
    departureDate: required("DEPARTURE_DATE"),
    dateRangeDays: Number(process.env.DATE_RANGE_DAYS ?? "1"),
    returnDate: process.env.RETURN_DATE,
    maxPriceBRL: Number(process.env.MAX_PRICE_BRL ?? "300"),
  },
};
