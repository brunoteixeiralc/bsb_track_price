import { config } from "../config";
import { Flight, SearchParams } from "../types";
import { searchWithApify } from "../apis/apify";
import { searchWithRapidAPI } from "../apis/rapidapi";
import { sendFlightAlert, sendDateRangeSummary, sendErrorAlert } from "./telegram";
import { appendHistory, getLastCheapestPrice } from "./history";
import { withRetry } from "../utils/retry";
import { getAllActiveAlerts, UserAlert } from "./user";
import { formatBRL } from "./currency";

export async function runTracker(): Promise<void> {
  console.log("[tracker] Iniciando rodada de verificação...");
  
  // 1. Coleta alertas individuais do banco
  const userAlerts = await getAllActiveAlerts();
  console.log(`[tracker] ${userAlerts.length} alerta(s) de usuários ativos encontrados.`);

  // 2. Adiciona as rotas globais do .env como alertas do admin (você)
  const allTasks: UserAlert[] = [...userAlerts];
  
  // Para manter compatibilidade com seu uso atual
  for (const origin of config.search.origins) {
    for (const destination of config.search.destinations) {
      if (origin === destination) continue;
      allTasks.push({
        chat_id: config.telegram.chatId,
        origin,
        destination,
        departure_date: config.search.departureDate, // usa a lógica de offset do config
        return_date: config.search.returnDate,
        trip_type: config.search.tripType,
        max_price_brl: config.search.maxPriceBRL,
        is_active: true
      });
    }
  }

  // 3. Executa cada busca
  // Dica futurista: Aqui poderíamos agrupar por rota/data para economizar API, 
  // mas vamos focar na funcionalidade primeiro.
  for (const alert of allTasks) {
    try {
      await processAlert(alert);
    } catch (err) {
      console.error(`[tracker] Erro no alerta ${alert.origin}→${alert.destination}:`, err);
    }
  }
  
  console.log("[tracker] Rodada de verificação finalizada.");
}

async function processAlert(alert: UserAlert): Promise<void> {
  const params: SearchParams = {
    origin: alert.origin,
    destination: alert.destination,
    departureDate: alert.departure_date,
    returnDate: alert.return_date,
    tripType: alert.trip_type as any
  };

  const route = `${alert.origin}→${alert.destination}`;
  console.log(`[tracker] Processando: ${route} para Usuário ${alert.chat_id} (Limite: ${alert.max_price_brl})`);

  let flights: Flight[] = [];
  try {
    flights = await fetchFlights(params);
  } catch (err) {
    await sendErrorAlert(route, `Falha técnica ao buscar voos.`, alert.chat_id);
    return;
  }

  // Aplica filtros e salva no histórico
  flights = applyAdvancedFilters(flights);
  
  const currentCheapest = flights.length > 0 ? Math.min(...flights.map(f => f.priceBRL)) : null;

  await appendHistory({
    timestamp: new Date().toISOString(),
    origin: alert.origin,
    destination: alert.destination,
    departureDate: alert.departure_date,
    returnDate: alert.return_date,
    totalFound: flights.length,
    cheapestPriceBRL: currentCheapest,
    flights: flights.map(f => ({
      airline: f.airline,
      priceBRL: f.priceBRL,
      departureTime: f.departureTime,
      link: f.link,
      source: f.source
    }))
  });

  if (currentCheapest && currentCheapest <= alert.max_price_brl) {
    // Verifica anti-spam (só avisa se o preço for menor que o anterior ou se for a primeira vez)
    const lastPrice = await getLastCheapestPrice(alert.origin, alert.destination, alert.departure_date);
    
    // Se o preço não caiu pelo menos 5%, a gente pula para não encher o saco do usuário
    // Exceto se for a primeira vez (lastPrice === null)
    if (!lastPrice || currentCheapest <= lastPrice * config.search.priceDropThreshold) {
      const bestFlight = flights.sort((a,b) => a.priceBRL - b.priceBRL)[0];
      await sendFlightAlert(bestFlight, false, alert.chat_id);
    }
  }
}

async function fetchFlights(params: SearchParams): Promise<Flight[]> {
  try {
    return await withRetry(
      () => searchWithApify(params),
      2,
      2000
    );
  } catch {
    return await searchWithRapidAPI(params);
  }
}

function applyAdvancedFilters(flights: Flight[]): Flight[] {
  const { airlinesWhitelist, maxStops, maxDurationHours } = config.filters;
  let filtered = flights;

  if (airlinesWhitelist.length > 0) {
    filtered = filtered.filter(f => f.airline && airlinesWhitelist.some(a => f.airline!.includes(a)));
  }
  if (maxStops !== undefined) {
    filtered = filtered.filter(f => f.stops !== undefined && f.stops <= maxStops);
  }
  if (maxDurationHours !== undefined) {
    filtered = filtered.filter(f => f.durationMinutes !== undefined && f.durationMinutes <= (maxDurationHours * 60));
  }
  return filtered;
}
