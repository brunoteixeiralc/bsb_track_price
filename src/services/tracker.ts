import { config } from "../config";
import { Flight, SearchParams } from "../types";
import { searchWithApify } from "../apis/apify";
import { searchWithRapidAPI } from "../apis/rapidapi";
import { sendFlightAlert, sendSummary, sendDateRangeSummary, sendErrorAlert } from "./telegram";
import { appendHistory } from "./history";
import { withRetry } from "../utils/retry";
import { generateDateRange } from "../utils/dates";

export async function runTracker(): Promise<void> {
  const dates = generateDateRange(config.search.departureDate, config.search.dateRangeDays);

  for (const destination of config.search.destinations) {
    const params: SearchParams = {
      origin: config.search.origin,
      destination,
      departureDate: dates[0],
      returnDate: config.search.returnDate,
      tripType: config.search.tripType,
    };

    if (dates.length === 1) {
      await searchAndNotify(params);
    } else {
      await searchDateRange(params, dates);
    }
  }
}

async function fetchFlights(params: SearchParams): Promise<Flight[]> {
  try {
    const flights = await withRetry(
      () => searchWithApify(params),
      3,
      2000,
      (attempt, err) =>
        console.warn(`[tracker] Apify tentativa ${attempt}/3 falhou:`, (err as Error).message)
    );
    console.log(`[tracker] Apify retornou ${flights.length} voo(s)`);
    return flights;
  } catch {
    console.warn("[tracker] Apify falhou após 3 tentativas, tentando RapidAPI...");
    const flights = await searchWithRapidAPI(params);
    console.log(`[tracker] RapidAPI retornou ${flights.length} voo(s)`);
    return flights;
  }
}

async function searchAndNotify(params: SearchParams): Promise<void> {
  const route = `${params.origin}→${params.destination}`;
  console.log(`[tracker] Buscando voos ${route} em ${params.departureDate}`);
  console.log(`[tracker] Threshold: R$ ${config.search.maxPriceBRL}`);

  let flights: Flight[] = [];

  try {
    flights = await fetchFlights(params);
  } catch (err) {
    console.error("[tracker] Ambas as APIs falharam.", err);
    await sendErrorAlert(route, `Busca de ${params.departureDate} falhou. Apify e RapidAPI indisponíveis.`);
    throw new Error("Todas as fontes de dados falharam.");
  }

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

  const cheapFlights = flights
    .filter((f) => f.priceBRL <= config.search.maxPriceBRL)
    .sort((a, b) => a.priceBRL - b.priceBRL);

  console.log(`[tracker] ${cheapFlights.length} voo(s) abaixo de R$ ${config.search.maxPriceBRL}`);

  for (const flight of cheapFlights) {
    await sendFlightAlert(flight);
  }

  await sendSummary(cheapFlights.length, flights.length, route);
}

async function searchDateRange(baseParams: SearchParams, dates: string[]): Promise<void> {
  const route = `${baseParams.origin}→${baseParams.destination}`;
  console.log(`[tracker] Varrendo ${dates.length} data(s) para ${route}...`);

  const cheapestPerDate: Flight[] = [];
  let apiFailures = 0;

  for (const date of dates) {
    const params: SearchParams = { ...baseParams, departureDate: date };
    console.log(`[tracker] Buscando ${route} em ${date}`);

    let flights: Flight[] = [];
    try {
      flights = await fetchFlights(params);
    } catch (err) {
      apiFailures++;
      console.warn(`[tracker] ${route} em ${date} falhou, pulando...`, (err as Error).message);
      continue;
    }

    appendHistory({
      timestamp: new Date().toISOString(),
      origin: params.origin,
      destination: params.destination,
      departureDate: date,
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

    if (flights.length > 0) {
      cheapestPerDate.push(flights.reduce((a, b) => (a.priceBRL < b.priceBRL ? a : b)));
    }
  }

  if (apiFailures === dates.length) {
    await sendErrorAlert(route, `${dates.length} data(s) verificada(s), todas falharam. Apify e RapidAPI indisponíveis.`);
  }

  const best =
    cheapestPerDate.length > 0
      ? cheapestPerDate.reduce((a, b) => (a.priceBRL < b.priceBRL ? a : b))
      : null;

  if (best && best.priceBRL <= config.search.maxPriceBRL) {
    await sendFlightAlert(best);
  }

  await sendDateRangeSummary(route, dates.length, best, config.search.maxPriceBRL, config.search.tripType);
}
