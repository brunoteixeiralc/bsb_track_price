import { getDb } from "./db";
import { HistoryEntry, WeeklyRouteSummary } from "../types";

export async function loadHistory(): Promise<HistoryEntry[]> {
  const db = getDb();
  const result = await db.execute("SELECT * FROM history ORDER BY id ASC");
  return result.rows.map(rowToEntry);
}

export async function getLastCheapestPrice(
  origin: string,
  destination: string,
  departureDate: string
): Promise<number | null> {
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT cheapestPriceBRL FROM history
          WHERE origin = ? AND destination = ? AND departureDate = ?
            AND cheapestPriceBRL IS NOT NULL
          ORDER BY id DESC
          LIMIT 1`,
    args: [origin, destination, departureDate],
  });

  const row = result.rows[0];
  return row ? (row.cheapestPriceBRL as number) : null;
}

export async function pruneOldHistory(retentionDays: number): Promise<number> {
  const db = getDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  
  const result = await db.execute({
    sql: "DELETE FROM history WHERE timestamp < ?",
    args: [cutoff.toISOString()],
  });
  
  return Number(result.rowsAffected);
}

export async function appendHistory(entry: HistoryEntry, retentionDays = 365): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO history
           (timestamp, origin, destination, departureDate, returnDate, totalFound, cheapestPriceBRL, flights)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      entry.timestamp,
      entry.origin,
      entry.destination,
      entry.departureDate,
      entry.returnDate ?? null,
      entry.totalFound,
      entry.cheapestPriceBRL ?? null,
      JSON.stringify(entry.flights),
    ],
  });

  const pruned = await pruneOldHistory(retentionDays);
  if (pruned > 0) {
    console.log(`[history] Removidas ${pruned} entrada(s) com mais de ${retentionDays} dia(s).`);
  }

  const countResult = await db.execute("SELECT COUNT(*) as n FROM history");
  const count = countResult.rows[0].n;
  console.log(`[history] ${count} entrada(s) no histórico.`);
}

export async function getWeeklySummary(now: Date = new Date()): Promise<WeeklyRouteSummary[]> {
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  const currentWeekStart = new Date(todayEnd);
  currentWeekStart.setDate(currentWeekStart.getDate() - 6);
  currentWeekStart.setHours(0, 0, 0, 0);

  const previousWeekStart = new Date(currentWeekStart);
  previousWeekStart.setDate(previousWeekStart.getDate() - 7);
  previousWeekStart.setHours(0, 0, 0, 0);
  const previousWeekEnd = new Date(currentWeekStart);
  previousWeekEnd.setMilliseconds(previousWeekEnd.getMilliseconds() - 1);

  const db = getDb();
  const result = await db.execute({
    sql: `SELECT origin, destination, timestamp, cheapestPriceBRL
          FROM history
          WHERE timestamp >= ? AND timestamp <= ?
          ORDER BY id ASC`,
    args: [previousWeekStart.toISOString(), todayEnd.toISOString()],
  });

  const rows = result.rows;
  const routeMap = new Map<string, any>();

  for (const row of rows) {
    const ts = new Date(row.timestamp as string);
    const routeKey = `${row.origin}→${row.destination}`;

    if (!routeMap.has(routeKey)) {
      routeMap.set(routeKey, {
        origin: row.origin,
        destination: row.destination,
        currentPrices: [],
        previousPrices: [],
        checksThisWeek: 0,
      });
    }

    const data = routeMap.get(routeKey)!;

    if (ts >= currentWeekStart && ts <= todayEnd) {
      data.checksThisWeek++;
      if (row.cheapestPriceBRL !== null) {
        data.currentPrices.push(row.cheapestPriceBRL);
      }
    } else if (ts >= previousWeekStart && ts <= previousWeekEnd) {
      if (row.cheapestPriceBRL !== null) {
        data.previousPrices.push(row.cheapestPriceBRL);
      }
    }
  }

  const summaries: WeeklyRouteSummary[] = [];

  for (const [route, data] of routeMap.entries()) {
    const currentWeekMin = data.currentPrices.length > 0 ? Math.min(...data.currentPrices) : null;
    const previousWeekMin = data.previousPrices.length > 0 ? Math.min(...data.previousPrices) : null;

    let trend: "up" | "down" | "stable" | "unknown" = "unknown";
    if (currentWeekMin !== null && previousWeekMin !== null) {
      const diff = (currentWeekMin - previousWeekMin) / previousWeekMin;
      if (diff > 0.02) trend = "up";
      else if (diff < -0.02) trend = "down";
      else trend = "stable";
    }

    summaries.push({
      route,
      origin: data.origin,
      destination: data.destination,
      currentWeekMin,
      previousWeekMin,
      trend,
      checksThisWeek: data.checksThisWeek,
    });
  }

  return summaries.sort((a, b) => a.route.localeCompare(b.route));
}

/** 
 * Busca todo o histórico para o Dashboard. 
 * Ordenado por timestamp para facilitar o gráfico de linha.
 */
export async function getFullHistory(): Promise<HistoryEntry[]> {
  const db = getDb();
  const result = await db.execute("SELECT * FROM history ORDER BY timestamp ASC");
  return result.rows.map(rowToEntry);
}

function rowToEntry(row: any): HistoryEntry {
  return {
    timestamp: row.timestamp as string,
    origin: row.origin as string,
    destination: row.destination as string,
    departureDate: row.departureDate as string,
    returnDate: row.returnDate as string | undefined,
    totalFound: Number(row.totalFound),
    cheapestPriceBRL: row.cheapestPriceBRL !== null ? Number(row.cheapestPriceBRL) : null,
    flights: JSON.parse(row.flights as string),
  };
}
