import { config } from "../config";
import { Flight, SearchParams } from "../types";
import { searchWithApify } from "../apis/apify";
import { searchWithRapidAPI } from "../apis/rapidapi";
import { sendFlightAlert, sendSummary, sendDateRangeSummary, sendErrorAlert, sendAntiSpamNotice } from "./telegram";
import { appendHistory, getLastCheapestPrice } from "./history";
import { withRetry } from "../utils/retry";
import { generateDateRange } from "../utils/dates";

export async function runTracker(): Promise<void> {
  const dates = generateDateRange(config.search.departureDate, config.search.dateRangeDays);

  for (const origin of config.search.origins) {
    for (const destination of config.search.destinations) {
      // Ignora rota origem→origem (não faz sentido buscar voo para o mesmo aeroporto)
      if (origin === destination) continue;

      const params: SearchParams = {
        origin,
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

function applyAdvancedFilters(flights: Flight[]): Flight[] {
  const { airlinesWhitelist, maxStops, maxDurationHours } = config.filters;
  let filtered = flights;

  if (airlinesWhitelist.length > 0) {
    const before = filtered.length;
    filtered = filtered.filter((f) => {
      if (!f.airline) return false;
      return airlinesWhitelist.some((a) =>
        f.airline!.toUpperCase().includes(a.toUpperCase())
      );
    });
    const removed = before - filtered.length;
    if (removed > 0) {
      console.log(
        `[tracker] Filtro AIRLINES_WHITELIST (${airlinesWhitelist.join(",")}): removeu ${removed} voo(s), restaram ${filtered.length}`
      );
    }
  }

  if (maxStops !== undefined) {
    const before = filtered.length;
    filtered = filtered.filter(
      (f) => f.stops !== undefined && f.stops <= maxStops
    );
    const removed = before - filtered.length;
    if (removed > 0) {
      console.log(
        `[tracker] Filtro MAX_STOPS=${maxStops}: removeu ${removed} voo(s), restaram ${filtered.length}`
      );
    }
  }

  if (maxDurationHours !== undefined) {
    const maxMinutes = maxDurationHours * 60;
    const before = filtered.length;
    filtered = filtered.filter(
      (f) => f.durationMinutes !== undefined && f.durationMinutes <= maxMinutes
    );
    const removed = before - filtered.length;
    if (removed > 0) {
      console.log(
        `[tracker] Filtro MAX_DURATION_HOURS=${maxDurationHours}: removeu ${removed} voo(s), restaram ${filtered.length}`
      );
    }
  }

  return filtered;
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

  flights = applyAdvancedFilters(flights);

  // Captura o preço anterior ANTES de gravar no histórico (anti-spam)
  const previousCheapest = getLastCheapestPrice(params.origin, params.destination, params.departureDate);

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

  if (cheapFlights.length > 0) {
    const currentCheapest = cheapFlights[0].priceBRL;
    const priceDrop = previousCheapest === null || currentCheapest <= previousCheapest * 0.95;

    if (priceDrop) {
      if (previousCheapest !== null) {
        console.log(`[tracker] Preço caiu de R$${previousCheapest} para R$${currentCheapest}. Enviando alertas.`);
      } else {
        console.log(`[tracker] Primeira busca para esta rota/data. Enviando alertas.`);
      }
      for (const flight of cheapFlights) {
        await sendFlightAlert(flight);
      }
    } else {
      console.log(
        `[tracker] Anti-spam: preço não caiu ≥5% (atual R$${currentCheapest} vs anterior R$${previousCheapest}). Alerta suprimido.`
      );
      await sendAntiSpamNotice(route, currentCheapest, previousCheapest!);
    }
  }

  await sendSummary(cheapFlights.length, flights.length, route);
}

async function searchDateRange(baseParams: SearchParams, dates: string[]): Promise<void> {
  const route = `${baseParams.origin}→${baseParams.destination}`;
  console.log(`[tracker] Varrendo ${dates.length} data(s) para ${route}...`);

  const cheapestPerDate: Flight[] = [];
  const previousPricePerDate = new Map<string, number | null>();
  let apiFailures = 0;

  for (const date of dates) {
    const params: SearchParams = { ...baseParams, departureDate: date };
    console.log(`[tracker] Buscando ${route} em ${date}`);

    // Captura o preço anterior ANTES de gravar no histórico (anti-spam)
    previousPricePerDate.set(date, getLastCheapestPrice(baseParams.origin, baseParams.destination, date));

    let flights: Flight[] = [];
    try {
      flights = await fetchFlights(params);
    } catch (err) {
      apiFailures++;
      console.warn(`[tracker] ${route} em ${date} falhou, pulando...`, (err as Error).message);
      continue;
    }

    flights = applyAdvancedFilters(flights);

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
    return;
  }

  const best =
    cheapestPerDate.length > 0
      ? cheapestPerDate.reduce((a, b) => (a.priceBRL < b.priceBRL ? a : b))
      : null;

  if (best && best.priceBRL <= config.search.maxPriceBRL) {
    const previousCheapest = previousPricePerDate.get(best.departureDate) ?? null;
    const priceDrop = previousCheapest === null || best.priceBRL <= previousCheapest * 0.95;

    if (priceDrop) {
      if (previousCheapest !== null) {
        console.log(`[tracker] Preço caiu de R$${previousCheapest} para R$${best.priceBRL} em ${best.departureDate}. Enviando alerta.`);
      } else {
        console.log(`[tracker] Primeira busca para esta rota/data. Enviando alerta.`);
      }
      await sendFlightAlert(best);
    } else {
      console.log(
        `[tracker] Anti-spam: preço não caiu ≥5% em ${best.departureDate} (atual R$${best.priceBRL} vs anterior R$${previousCheapest}). Alerta suprimido.`
      );
      await sendAntiSpamNotice(route, best.priceBRL, previousCheapest!);
    }
  }

  await sendDateRangeSummary(route, dates.length, best, config.search.maxPriceBRL, config.search.tripType, dates[0], dates[dates.length - 1]);
}
