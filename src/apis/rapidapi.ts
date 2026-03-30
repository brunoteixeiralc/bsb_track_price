import axios from "axios";
import { config } from "../config";
import { Flight, SearchParams } from "../types";
import { convertToBRL } from "../services/currency";

// ⚠️  IMPORTANTE: Este arquivo usa a API "sky-scrapper" (Skyscanner unofficial) como exemplo.
// Ajuste os endpoints e o mapeamento de campos conforme a API que você contratar no RapidAPI.
// Documentação: https://rapidapi.com/apiheya/api/sky-scrapper

const RAPIDAPI_BASE = "https://sky-scrapper.p.rapidapi.com/api/v1/flights";

const headers = {
  "X-RapidAPI-Key": config.rapidapi.key,
  "X-RapidAPI-Host": config.rapidapi.host,
};

interface RapidFlightOption {
  price?: { raw?: number; formatted?: string };
  legs?: Array<{
    origin?: { displayCode?: string };
    destination?: { displayCode?: string };
    departure?: string;
    arrival?: string;
    durationInMinutes?: number;
    stopCount?: number;
    carriers?: { marketing?: Array<{ name?: string }> };
  }>;
  deeplink?: string;
}

export async function searchWithRapidAPI(params: SearchParams): Promise<Flight[]> {
  console.log("[rapidapi] Iniciando busca (fallback)...");

  try {
    // Passo 1: busca IDs de aeroportos
    const [originData, destData] = await Promise.all([
      axios.get(`${RAPIDAPI_BASE}/searchAirport`, {
        headers,
        params: { query: params.origin, locale: "pt-BR" },
      }),
      axios.get(`${RAPIDAPI_BASE}/searchAirport`, {
        headers,
        params: { query: params.destination, locale: "pt-BR" },
      }),
    ]);

    const originId: string = originData.data?.data?.[0]?.skyId ?? params.origin;
    const destId: string = destData.data?.data?.[0]?.skyId ?? params.destination;
    const originEntityId: string = originData.data?.data?.[0]?.entityId ?? "";
    const destEntityId: string = destData.data?.data?.[0]?.entityId ?? "";

    // Passo 2: busca voos
    const searchResponse = await axios.get(`${RAPIDAPI_BASE}/searchFlights`, {
      headers,
      params: {
        originSkyId: originId,
        destinationSkyId: destId,
        originEntityId,
        destinationEntityId: destEntityId,
        date: params.departureDate,
        returnDate: params.returnDate,
        cabinClass: "economy",
        adults: "1",
        sortBy: "best",
        currency: "BRL",
        market: "BR",
        countryCode: "BR",
        locale: "pt-BR",
      },
      timeout: 30_000,
    });

    const itineraries: RapidFlightOption[] =
      searchResponse.data?.data?.itineraries ?? [];

    console.log(`[rapidapi] ${itineraries.length} resultado(s) retornado(s)`);

    const flights: Flight[] = [];

    for (const item of itineraries) {
      const priceRaw = item.price?.raw;
      if (!priceRaw || !item.deeplink) continue;

      const leg = item.legs?.[0];
      const airline = leg?.carriers?.marketing?.[0]?.name;
      const departureDate = leg?.departure?.split("T")[0] ?? params.departureDate;

      // Escalas e duração — campos opcionais retornados pela sky-scrapper API
      const stops = leg?.stopCount;
      let durationMinutes: number | undefined = leg?.durationInMinutes;
      if (durationMinutes === undefined && leg?.departure && leg?.arrival) {
        const dep = new Date(leg.departure);
        const arr = new Date(leg.arrival);
        if (!isNaN(dep.getTime()) && !isNaN(arr.getTime())) {
          durationMinutes = Math.round((arr.getTime() - dep.getTime()) / 60_000);
        }
      }

      const priceBRL = await convertToBRL(priceRaw, "BRL"); // sky-scrapper já retorna em BRL quando currency=BRL

      flights.push({
        origin: leg?.origin?.displayCode ?? params.origin,
        destination: leg?.destination?.displayCode ?? params.destination,
        departureDate,
        returnDate: params.returnDate,
        tripType: params.tripType,
        price: priceRaw,
        currency: "BRL",
        priceBRL,
        airline,
        stops,
        durationMinutes,
        link: item.deeplink,
        source: "rapidapi",
      });
    }

    return flights;
  } catch (err) {
    console.error("[rapidapi] Erro na busca:", err);
    throw err;
  }
}
