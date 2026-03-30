import axios from "axios";
import { config } from "../config";
import { Flight, SearchParams } from "../types";
import { convertToBRL } from "../services/currency";

const APIFY_BASE = "https://api.apify.com/v2";

// Actor: johnvc~google-flights-data-scraper-flight-and-price-search
// Endpoint run-sync-get-dataset-items: executa o actor e retorna os itens em uma única requisição

interface ApifyFlightLeg {
  departure_airport?: { id?: string; time?: string };
  arrival_airport?: { id?: string; time?: string };
  airline?: string;
  duration?: number; // duração do segmento em minutos (quando disponível)
}

interface ApifyFlightOption {
  price?: number;
  booking_token?: string;
  flights?: ApifyFlightLeg[];
}

interface ApifyDatasetItem {
  search_parameters?: { departure_id?: string; arrival_id?: string; outbound_date?: string };
  best_flights?: ApifyFlightOption[];
  other_flights?: ApifyFlightOption[];
}

export async function searchWithApify(params: SearchParams): Promise<Flight[]> {
  console.log("[apify] Iniciando busca...");

  try {
    const response = await axios.post(
      `${APIFY_BASE}/acts/${config.apify.actorId}/run-sync-get-dataset-items`,
      {
        departure_id: params.origin,
        arrival_id: params.destination,
        outbound_date: params.departureDate,
        ...(params.returnDate ? { return_date: params.returnDate } : {}),
        currency: "USD",
        adults: 1,
        children: 0,
        infants: 0,
        hl: "en",
        gl: "br",
        exclude_basic: false,
        max_pages: 1,
      },
      {
        headers: { Authorization: `Bearer ${config.apify.token}` },
        timeout: 130_000,
      }
    );

    const items: ApifyDatasetItem[] = response.data;

    // Extrai e mapeia voos de best_flights + other_flights
    const flights: Flight[] = [];

    for (const item of items) {
      const allOptions = [
        ...(item.best_flights ?? []),
        ...(item.other_flights ?? []),
      ];

      for (const option of allOptions) {
        if (!option.price) continue;

        const legs = option.flights ?? [];
        const leg = legs[0];
        const lastLeg = legs[legs.length - 1];
        const departureDate = leg?.departure_airport?.time?.split(" ")[0] ?? params.departureDate;
        const airline = leg?.airline;
        const origin = leg?.departure_airport?.id ?? params.origin;
        const destination = (lastLeg ?? leg)?.arrival_airport?.id ?? params.destination;

        // Número de escalas = número de segmentos - 1
        const stops = legs.length > 0 ? legs.length - 1 : undefined;

        // Duração total: calcula pelo tempo de partida do primeiro seg. e chegada do último
        let durationMinutes: number | undefined;
        const depTime = leg?.departure_airport?.time;
        const arrTime = lastLeg?.arrival_airport?.time;
        if (depTime && arrTime) {
          const dep = new Date(depTime.replace(" ", "T"));
          const arr = new Date(arrTime.replace(" ", "T"));
          if (!isNaN(dep.getTime()) && !isNaN(arr.getTime())) {
            durationMinutes = Math.round((arr.getTime() - dep.getTime()) / 60_000);
          }
        }
        // Fallback: soma das durações dos segmentos individuais
        if (durationMinutes === undefined || durationMinutes <= 0) {
          const total = legs.reduce((sum, l) => sum + (l.duration ?? 0), 0);
          if (total > 0) durationMinutes = total;
        }

        // Preço vem em USD → converte para BRL
        const priceBRL = await convertToBRL(option.price, "USD");

        // Link de busca no Google Flights
        const link = `https://www.google.com/travel/flights?q=flights+from+${origin}+to+${destination}+on+${departureDate}`;

        flights.push({
          origin,
          destination,
          departureDate,
          returnDate: params.returnDate,
          tripType: params.tripType,
          price: option.price,
          currency: "USD",
          priceBRL,
          airline,
          stops,
          durationMinutes,
          link,
          source: "apify",
        });
      }
    }

    console.log(`[apify] ${flights.length} voo(s) mapeado(s)`);
    return flights;
  } catch (err) {
    console.error("[apify] Erro na busca:", err);
    throw err;
  }
}
