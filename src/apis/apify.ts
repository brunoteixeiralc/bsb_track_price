import axios from "axios";
import { config } from "../config";
import { Flight, SearchParams } from "../types";
import { convertToBRL } from "../services/currency";

const APIFY_BASE = "https://api.apify.com/v2";

// Actor: 1dYHRKkEBHBPd0JM7 (Google Flights scraper)
// Schema: cada item do dataset contém best_flights e other_flights

interface ApifyRunResult {
  id: string;
  status: string;
  defaultDatasetId: string;
}

interface ApifyFlightLeg {
  departure_airport?: { id?: string; time?: string };
  arrival_airport?: { id?: string; time?: string };
  airline?: string;
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
    // 1. Dispara o actor
    const runResponse = await axios.post(
      `${APIFY_BASE}/acts/${config.apify.actorId}/runs`,
      {
        departure_id: params.origin,
        arrival_id: params.destination,
        outbound_date: params.departureDate,
        ...(params.returnDate ? { return_date: params.returnDate } : {}),
        currency: "BRL",
        adults: 1,
        children: 0,
        infants: 0,
        hl: "en",
        gl: "us",
        exclude_basic: false,
        max_pages: 1,
      },
      {
        headers: { Authorization: `Bearer ${config.apify.token}` },
        params: { waitForFinish: 120 }, // aguarda até 2 min
        timeout: 130_000,
      }
    );

    const run: ApifyRunResult = runResponse.data.data;
    console.log(`[apify] Run ${run.id} finalizado com status: ${run.status}`);

    if (run.status !== "SUCCEEDED") {
      throw new Error(`Actor run failed with status: ${run.status}`);
    }

    // 2. Busca os resultados do dataset
    const datasetResponse = await axios.get(
      `${APIFY_BASE}/datasets/${run.defaultDatasetId}/items`,
      {
        headers: { Authorization: `Bearer ${config.apify.token}` },
        params: { limit: 10 },
      }
    );

    const items: ApifyDatasetItem[] = datasetResponse.data;

    // 3. Extrai e mapeia voos de best_flights + other_flights
    const flights: Flight[] = [];

    for (const item of items) {
      const allOptions = [
        ...(item.best_flights ?? []),
        ...(item.other_flights ?? []),
      ];

      for (const option of allOptions) {
        if (!option.price) continue;

        const leg = option.flights?.[0];
        const departureDate = leg?.departure_airport?.time?.split(" ")[0] ?? params.departureDate;
        const airline = leg?.airline;
        const origin = leg?.departure_airport?.id ?? params.origin;
        const destination = leg?.arrival_airport?.id ?? params.destination;

        // Preço já vem em BRL (currency=BRL solicitado)
        const priceBRL = await convertToBRL(option.price, "BRL");

        // Link de busca no Google Flights
        const link = `https://www.google.com/travel/flights?q=flights+from+${origin}+to+${destination}+on+${departureDate}`;

        flights.push({
          origin,
          destination,
          departureDate,
          returnDate: params.returnDate,
          tripType: params.tripType,
          price: option.price,
          currency: "BRL",
          priceBRL,
          airline,
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
