import { config } from "../config";
import { Flight, SearchParams } from "../types";
import { searchWithApify } from "../apis/apify";
import { searchWithRapidAPI } from "../apis/rapidapi";
import { sendFlightAlert, sendSummary } from "./telegram";
import { appendHistory } from "./history";

export async function runTracker(): Promise<void> {
  const params: SearchParams = {
    origin: config.search.origin,
    destination: config.search.destination,
    departureDate: config.search.departureDate,
    returnDate: config.search.returnDate,
  };

  console.log(`[tracker] Buscando voos ${params.origin} → ${params.destination} em ${params.departureDate}`);
  console.log(`[tracker] Threshold: R$ ${config.search.maxPriceBRL}`);

  let flights: Flight[] = [];

  // Tenta Apify primeiro, cai para RapidAPI se falhar
  try {
    flights = await searchWithApify(params);
    console.log(`[tracker] Apify retornou ${flights.length} voo(s)`);
  } catch (apifyErr) {
    console.warn("[tracker] Apify falhou, tentando RapidAPI...");
    try {
      flights = await searchWithRapidAPI(params);
      console.log(`[tracker] RapidAPI retornou ${flights.length} voo(s)`);
    } catch (rapidErr) {
      console.error("[tracker] Ambas as APIs falharam.", rapidErr);
      throw new Error("Todas as fontes de dados falharam.");
    }
  }

  // Salva histórico com todos os voos encontrados
  appendHistory({
    timestamp: new Date().toISOString(),
    origin: params.origin,
    destination: params.destination,
    departureDate: params.departureDate,
    returnDate: params.returnDate,
    totalFound: flights.length,
    cheapestPriceBRL: flights.length > 0 ? Math.min(...flights.map((f) => f.priceBRL)) : null,
    flights: flights.map((f) => ({
      airline: f.airline,
      priceBRL: f.priceBRL,
      departureTime: f.departureDate,
      link: f.link,
      source: f.source,
    })),
  });

  // Filtra por threshold de preço
  const cheapFlights = flights
    .filter((f) => f.priceBRL <= config.search.maxPriceBRL)
    .sort((a, b) => a.priceBRL - b.priceBRL);

  console.log(`[tracker] ${cheapFlights.length} voo(s) abaixo de R$ ${config.search.maxPriceBRL}`);

  // Envia alertas para cada passagem barata
  for (const flight of cheapFlights) {
    await sendFlightAlert(flight);
  }

  // Envia resumo da verificação
  await sendSummary(cheapFlights.length, flights.length);
}
