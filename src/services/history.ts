import fs from "fs";
import path from "path";
import { HistoryEntry, WeeklyRouteSummary } from "../types";

const HISTORY_FILE = path.resolve(process.cwd(), "data", "history.json");

export function loadHistory(): HistoryEntry[] {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8"));
}

export function getLastCheapestPrice(origin: string, destination: string, departureDate: string): number | null {
  const history = loadHistory();
  const relevant = history.filter(
    (e) =>
      e.origin === origin &&
      e.destination === destination &&
      e.departureDate === departureDate &&
      e.cheapestPriceBRL !== null
  );
  if (relevant.length === 0) return null;
  return relevant[relevant.length - 1].cheapestPriceBRL;
}

export function appendHistory(entry: HistoryEntry): void {
  const history = loadHistory();
  history.push(entry);
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  console.log(`[history] ${history.length} entrada(s) no histórico.`);
}

export function getWeeklySummary(now: Date = new Date()): WeeklyRouteSummary[] {
  const history = loadHistory();

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

  const routeMap = new Map<string, {
    origin: string;
    destination: string;
    currentPrices: number[];
    previousPrices: number[];
    checksThisWeek: number;
  }>();

  for (const entry of history) {
    const ts = new Date(entry.timestamp);
    const routeKey = `${entry.origin}→${entry.destination}`;

    if (!routeMap.has(routeKey)) {
      routeMap.set(routeKey, {
        origin: entry.origin,
        destination: entry.destination,
        currentPrices: [],
        previousPrices: [],
        checksThisWeek: 0,
      });
    }

    const data = routeMap.get(routeKey)!;

    if (ts >= currentWeekStart && ts <= todayEnd) {
      data.checksThisWeek++;
      if (entry.cheapestPriceBRL !== null) {
        data.currentPrices.push(entry.cheapestPriceBRL);
      }
    } else if (ts >= previousWeekStart && ts <= previousWeekEnd) {
      if (entry.cheapestPriceBRL !== null) {
        data.previousPrices.push(entry.cheapestPriceBRL);
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
