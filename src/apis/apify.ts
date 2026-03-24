import axios from "axios";
import { config } from "../config";
import { Flight, SearchParams } from "../types";
import { convertToBRL } from "../services/currency";

const APIFY_BASE = "https://api.apify.com/v2";

// ⚠️  IMPORTANTE: Ajuste o mapeamento abaixo conforme o Actor do Apify que você escolher.
// Cada actor retorna um schema diferente. Este código assume um schema genérico.
// Recomendação: "tri_angle/google-flights-scraper" ou "curious_coder/google-flights-scraper"
// Consulte a documentação do actor escolhido para ajustar os campos.

interface ApifyRunResult {
  id: string;
  status: string;
  defaultDatasetId: string;
}

interface ApifyFlightItem {
  // Schema genérico — ajuste conforme o actor escolhido
  price?: number;
  currency?: string;
  origin?: string;
  destination?: string;
  departureDate?: string;
  returnDate?: string;
  airline?: string;
  url?: string;
  link?: string;
  bookingUrl?: string;
}

export async function searchWithApify(params: SearchParams): Promise<Flight[]> {
  console.log("[apify] Iniciando busca...");

  try {
    // 1. Dispara o actor
    const runResponse = await axios.post(
      `${APIFY_BASE}/acts/${config.apify.actorId}/runs`,
      {
        // Input do actor — ajuste conforme a documentação do actor escolhido
        origin: params.origin,
        destination: params.destination,
        departureDate: params.departureDate,
        returnDate: params.returnDate,
        currency: "BRL",
        adults: 1,
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
        params: { limit: 50 },
      }
    );

    const items: ApifyFlightItem[] = datasetResponse.data;
    console.log(`[apify] ${items.length} resultado(s) retornado(s)`);

    // 3. Mapeia para o tipo Flight
    const flights: Flight[] = [];

    for (const item of items) {
      if (!item.price || !item.url && !item.link && !item.bookingUrl) continue;

      const currency = item.currency ?? "BRL";
      const price = item.price;
      const priceBRL = await convertToBRL(price, currency);

      flights.push({
        origin: item.origin ?? params.origin,
        destination: item.destination ?? params.destination,
        departureDate: item.departureDate ?? params.departureDate,
        returnDate: item.returnDate ?? params.returnDate,
        price,
        currency,
        priceBRL,
        airline: item.airline,
        link: item.url ?? item.link ?? item.bookingUrl ?? "",
        source: "apify",
      });
    }

    return flights;
  } catch (err) {
    console.error("[apify] Erro na busca:", err);
    throw err;
  }
}
