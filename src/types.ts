export type TripType = "one-way" | "round-trip";

export interface Flight {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  tripType: TripType;
  price: number;        // preço na moeda original
  currency: string;     // ex: "USD", "BRL"
  priceBRL: number;     // preço convertido para BRL
  airline?: string;
  stops?: number;        // número de escalas (0 = voo direto)
  durationMinutes?: number; // duração total do voo em minutos
  link: string;
  source: "apify" | "rapidapi";
}

export interface SearchParams {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  tripType: TripType;
}

export interface HistoryEntry {
  timestamp: string;
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  totalFound: number;
  cheapestPriceBRL: number | null;
  flights: Array<{
    airline?: string;
    priceBRL: number;
    departureTime?: string;
    link: string;
    source: string;
  }>;
}

export interface CurrencyRate {
  from: string;
  to: string;
  rate: number;
  fetchedAt: Date;
}

export interface WeeklyRouteSummary {
  route: string;
  origin: string;
  destination: string;
  currentWeekMin: number | null;
  previousWeekMin: number | null;
  trend: "up" | "down" | "stable" | "unknown";
  checksThisWeek: number;
}
