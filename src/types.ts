export interface Flight {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  price: number;        // preço na moeda original
  currency: string;     // ex: "USD", "BRL"
  priceBRL: number;     // preço convertido para BRL
  airline?: string;
  link: string;
  source: "apify" | "rapidapi";
}

export interface SearchParams {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
}

export interface CurrencyRate {
  from: string;
  to: string;
  rate: number;
  fetchedAt: Date;
}
