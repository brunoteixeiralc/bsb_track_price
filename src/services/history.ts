import { DatabaseSync } from "node:sqlite";
import path from "path";
import fs from "fs";
import { HistoryEntry, WeeklyRouteSummary } from "../types";

const DB_FILE = path.resolve(process.cwd(), "data", "history.db");

let _db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (!_db) {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    _db = new DatabaseSync(DB_FILE);
    _db.exec(`
      CREATE TABLE IF NOT EXISTS history (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp  TEXT    NOT NULL,
        origin     TEXT    NOT NULL,
        destination TEXT   NOT NULL,
        departureDate TEXT NOT NULL,
        returnDate TEXT,
        totalFound INTEGER NOT NULL,
        cheapestPriceBRL REAL,
        flights    TEXT    NOT NULL DEFAULT '[]'
      )
    `);
  }
  return _db;
}

/** Fecha a conexão com o banco (usado em testes para reset entre casos). */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

export function loadHistory(): HistoryEntry[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM history ORDER BY id ASC").all() as Array<Record<string, unknown>>;
  return rows.map(rowToEntry);
}

export function getLastCheapestPrice(
  origin: string,
  destination: string,
  departureDate: string
): number | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT cheapestPriceBRL FROM history
       WHERE origin = ? AND destination = ? AND departureDate = ?
         AND cheapestPriceBRL IS NOT NULL
       ORDER BY id DESC
       LIMIT 1`
    )
    .get(origin, destination, departureDate) as { cheapestPriceBRL: number } | undefined;

  return row ? row.cheapestPriceBRL : null;
}

export function appendHistory(entry: HistoryEntry): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO history
       (timestamp, origin, destination, departureDate, returnDate, totalFound, cheapestPriceBRL, flights)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.timestamp,
    entry.origin,
    entry.destination,
    entry.departureDate,
    entry.returnDate ?? null,
    entry.totalFound,
    entry.cheapestPriceBRL ?? null,
    JSON.stringify(entry.flights)
  );

  const count = (db.prepare("SELECT COUNT(*) as n FROM history").get() as { n: number }).n;
  console.log(`[history] ${count} entrada(s) no histórico.`);
}

export function getWeeklySummary(now: Date = new Date()): WeeklyRouteSummary[] {
  // Current week: last 7 days up to end of today
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  const currentWeekStart = new Date(todayEnd);
  currentWeekStart.setDate(currentWeekStart.getDate() - 6);
  currentWeekStart.setHours(0, 0, 0, 0);

  // Previous week: the 7 days before current week
  const previousWeekEnd = new Date(currentWeekStart);
  previousWeekEnd.setMilliseconds(previousWeekEnd.getMilliseconds() - 1);

  const previousWeekStart = new Date(previousWeekEnd);
  previousWeekStart.setDate(previousWeekStart.getDate() - 6);
  previousWeekStart.setHours(0, 0, 0, 0);

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT origin, destination, timestamp, cheapestPriceBRL
       FROM history
       WHERE timestamp >= ? AND timestamp <= ?
       ORDER BY id ASC`
    )
    .all(previousWeekStart.toISOString(), todayEnd.toISOString()) as Array<{
    origin: string;
    destination: string;
    timestamp: string;
    cheapestPriceBRL: number | null;
  }>;

  const routeMap = new Map<
    string,
    {
      origin: string;
      destination: string;
      currentPrices: number[];
      previousPrices: number[];
      checksThisWeek: number;
    }
  >();

  for (const row of rows) {
    const ts = new Date(row.timestamp);
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
    const currentWeekMin =
      data.currentPrices.length > 0 ? Math.min(...data.currentPrices) : null;
    const previousWeekMin =
      data.previousPrices.length > 0 ? Math.min(...data.previousPrices) : null;

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

// ---------- helpers ----------

function rowToEntry(row: Record<string, unknown>): HistoryEntry {
  return {
    timestamp: row.timestamp as string,
    origin: row.origin as string,
    destination: row.destination as string,
    departureDate: row.departureDate as string,
    returnDate: row.returnDate as string | undefined,
    totalFound: row.totalFound as number,
    cheapestPriceBRL: row.cheapestPriceBRL as number | null,
    flights: JSON.parse(row.flights as string),
  };
}
