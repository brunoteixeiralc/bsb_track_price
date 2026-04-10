import axios, { isAxiosError } from "axios";
import { config } from "../config";
import { Flight, SearchParams, PriceInsights } from "../types";
import { convertToBRL, getUSDtoBRL } from "../services/currency";

const APIFY_BASE = "https://api.apify.com/v2";

// Actor: johnvc~google-flights-data-scraper-flight-and-price-search
// Endpoint run-sync-get-dataset-items: executa o actor e retorna os itens em uma única requisição

// Mapeamento de nome de companhia → código IATA
const AIRLINE_NAME_TO_IATA: Record<string, string> = {
  latam: "LA",
  gol: "G3",
  azul: "AD",
};

/**
 * Converte nomes de companhias aéreas para códigos IATA.
 * Ex: ["LATAM", "GOL"] → "LA,G3"
 * Nomes sem mapeamento são ignorados.
 */
function toIataCodes(names: string[]): string {
  return names
    .map((n) => AIRLINE_NAME_TO_IATA[n.toLowerCase()])
    .filter(Boolean)
    .join(",");
}

function formatError(err: unknown): string {
  if (isAxiosError(err)) {
    return `HTTP ${err.response?.status ?? "?"}: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Retorna true quando o erro indica que o token ficou sem créditos/saldo.
 * Apify retorna 402 Payment Required nesse caso.
 */
function isCreditsError(err: unknown): boolean {
  if (!isAxiosError(err)) return false;
  const status = err.response?.status;
  // 402 = sem créditos; 403 = token sem permissão/créditos — ambos devem rotacionar
  return status === 402 || status === 403;
}

interface ApifyFlightLeg {
  departure_airport?: { id?: string; time?: string };
  arrival_airport?: { id?: string; time?: string };
  airline?: string;
  flight_number?: string;
  airplane?: string;
  duration?: number; // duração do segmento em minutos (quando disponível)
}

interface ApifyFlightOption {
  price?: number;
  booking_token?: string;
  flights?: ApifyFlightLeg[];
}

interface ApifyPriceInsights {
  lowest_price?: number;
  price_level?: string;
  typical_price_range?: [number, number];
  price_history?: [number, number][];
}

interface ApifyDatasetItem {
  search_parameters?: { departure_id?: string; arrival_id?: string; outbound_date?: string };
  best_flights?: ApifyFlightOption[];
  other_flights?: ApifyFlightOption[];
  price_insights?: ApifyPriceInsights;
}

export async function searchWithApify(params: SearchParams): Promise<Flight[]> {
  console.log("[apify] Iniciando busca...");

  const tokens = config.apify.tokens;
  const usdToBRL = await getUSDtoBRL();
  const maxPriceUSD = Math.round(config.search.maxPriceBRL / usdToBRL);

  const body = {
    departure_id: params.origin,
    arrival_id: params.destination,
    outbound_date: params.departureDate,
    ...(params.returnDate ? { return_date: params.returnDate } : {}),
    currency: "USD",
    adults: config.search.adults,
    children: config.search.children,
    infants: 0,
    hl: "pt",
    gl: "br",
    exclude_basic: false,
    max_pages: 1,
    max_price: maxPriceUSD,
    ...(config.filters.maxStops !== undefined
      ? { max_stops: config.filters.maxStops }
      : {}),
    ...(config.filters.airlinesWhitelist.length > 0
      ? { airlines: toIataCodes(config.filters.airlinesWhitelist) }
      : {}),
  };

  let lastError: unknown;

  for (let i = 0; i < tokens.length; i++) {
    try {
      console.log(`[apify] Usando token ${i + 1}/${tokens.length}...`);
      const response = await axios.post(
        `${APIFY_BASE}/acts/${config.apify.actorId}/run-sync-get-dataset-items`,
        body,
        {
          headers: { Authorization: `Bearer ${tokens[i]}` },
          timeout: 130_000,
        }
      );

      const items: ApifyDatasetItem[] = response.data;

      // Extrai e mapeia voos de best_flights + other_flights
      const flights: Flight[] = [];

      for (const item of items) {
        // Extrai price_insights uma vez por item (compartilhado por todos os voos do item)
        const rawInsights = item.price_insights;
        let priceInsights: PriceInsights | undefined;

        if (
          rawInsights &&
          typeof rawInsights.lowest_price === "number" &&
          rawInsights.price_level &&
          Array.isArray(rawInsights.typical_price_range) &&
          rawInsights.typical_price_range.length === 2
        ) {
          const level = rawInsights.price_level;
          if (level === "low" || level === "typical" || level === "high") {
            priceInsights = {
              lowestPrice: rawInsights.lowest_price,
              priceLevel: level,
              typicalPriceRange: rawInsights.typical_price_range as [number, number],
              ...(rawInsights.price_history ? { priceHistory: rawInsights.price_history } : {}),
            };
          }
        }

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
          const departureTime = leg?.departure_airport?.time?.split(" ")[1];
          const airline = leg?.airline;
          const flightNumber = leg?.flight_number;
          const airplane = leg?.airplane;
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
            flightNumber,
            airplane,
            departureTime,
            priceInsights,
          });
        }
      }

      console.log(`[apify] ${flights.length} voo(s) mapeado(s) com token ${i + 1}`);
      return flights;

    } catch (err) {
      lastError = err;
      if (isCreditsError(err) && i < tokens.length - 1) {
        console.warn(`[apify] Token ${i + 1} sem créditos, tentando token ${i + 2}...`);
        continue;
      }
      console.error(`[apify] Erro na busca com token ${i + 1}: ${formatError(err)}`);
      throw err;
    }
  }

  /* istanbul ignore next — o loop sempre retorna ou lança na última iteração */
  console.error("[apify] Todos os tokens ficaram sem créditos.");
  throw lastError;
}
