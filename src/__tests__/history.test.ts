import fs from "fs";
import path from "path";
import { HistoryEntry } from "../types";

// Redireciona HISTORY_FILE para um diretório temporário nos testes
const TMP_DIR = path.resolve(__dirname, "../../.tmp-test-history");
const TMP_FILE = path.join(TMP_DIR, "history.json");

jest.mock("path", () => {
  const actual = jest.requireActual("path");
  return {
    ...actual,
    resolve: (...args: string[]) => {
      const result = actual.resolve(...args);
      if (result.endsWith(actual.join("data", "history.json"))) {
        return TMP_FILE;
      }
      return result;
    },
  };
});

const makeEntry = (overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
  timestamp: "2026-03-24T10:00:00.000Z",
  origin: "BSB",
  destination: "GRU",
  departureDate: "2026-03-29",
  totalFound: 2,
  cheapestPriceBRL: 1500,
  flights: [
    { airline: "Gol", priceBRL: 1500, departureTime: "2026-03-29 10:00", link: "https://example.com", source: "apify" },
  ],
  ...overrides,
});

beforeEach(() => {
  if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true });
});

afterAll(() => {
  if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true });
});

describe("loadHistory", () => {
  it("retorna array vazio se o arquivo não existe", () => {
    const { loadHistory } = require("../services/history");
    expect(loadHistory()).toEqual([]);
  });

  it("retorna as entradas salvas", () => {
    fs.mkdirSync(TMP_DIR, { recursive: true });
    const entry = makeEntry();
    fs.writeFileSync(TMP_FILE, JSON.stringify([entry]));

    const { loadHistory } = require("../services/history");
    expect(loadHistory()).toHaveLength(1);
    expect(loadHistory()[0].origin).toBe("BSB");
  });
});

describe("appendHistory", () => {
  it("cria o arquivo se não existe e salva a entrada", () => {
    const { appendHistory, loadHistory } = require("../services/history");
    appendHistory(makeEntry());

    expect(fs.existsSync(TMP_FILE)).toBe(true);
    expect(loadHistory()).toHaveLength(1);
  });

  it("acumula entradas em chamadas consecutivas", () => {
    const { appendHistory, loadHistory } = require("../services/history");
    appendHistory(makeEntry({ timestamp: "2026-03-24T08:00:00.000Z" }));
    appendHistory(makeEntry({ timestamp: "2026-03-24T20:00:00.000Z" }));

    expect(loadHistory()).toHaveLength(2);
  });

  it("persiste todos os campos corretamente", () => {
    const { appendHistory, loadHistory } = require("../services/history");
    const entry = makeEntry({ cheapestPriceBRL: 1892, totalFound: 12 });
    appendHistory(entry);

    const saved = loadHistory()[0];
    expect(saved.cheapestPriceBRL).toBe(1892);
    expect(saved.totalFound).toBe(12);
    expect(saved.flights[0].airline).toBe("Gol");
  });

  it("salva entrada com cheapestPriceBRL null quando não há voos", () => {
    const { appendHistory, loadHistory } = require("../services/history");
    appendHistory(makeEntry({ totalFound: 0, cheapestPriceBRL: null, flights: [] }));

    expect(loadHistory()[0].cheapestPriceBRL).toBeNull();
  });
});

describe("getLastCheapestPrice", () => {
  it("retorna null quando não há histórico", () => {
    const { getLastCheapestPrice } = require("../services/history");
    expect(getLastCheapestPrice("BSB", "GRU", "2026-03-29")).toBeNull();
  });

  it("retorna o preço mais recente para a rota e data informadas", () => {
    const { appendHistory, getLastCheapestPrice } = require("../services/history");
    appendHistory(makeEntry({ cheapestPriceBRL: 1500, timestamp: "2026-03-24T08:00:00.000Z" }));
    appendHistory(makeEntry({ cheapestPriceBRL: 1200, timestamp: "2026-03-24T20:00:00.000Z" }));

    expect(getLastCheapestPrice("BSB", "GRU", "2026-03-29")).toBe(1200);
  });

  it("ignora entradas de outras rotas ou datas", () => {
    const { appendHistory, getLastCheapestPrice } = require("../services/history");
    appendHistory(makeEntry({ destination: "GIG", cheapestPriceBRL: 999 }));
    appendHistory(makeEntry({ departureDate: "2026-04-01", cheapestPriceBRL: 888 }));

    expect(getLastCheapestPrice("BSB", "GRU", "2026-03-29")).toBeNull();
  });

  it("ignora entradas com cheapestPriceBRL null", () => {
    const { appendHistory, getLastCheapestPrice } = require("../services/history");
    appendHistory(makeEntry({ cheapestPriceBRL: null, totalFound: 0, flights: [] }));

    expect(getLastCheapestPrice("BSB", "GRU", "2026-03-29")).toBeNull();
  });

  it("retorna o preço da entrada mais recente mesmo quando há null intercalado", () => {
    const { appendHistory, getLastCheapestPrice } = require("../services/history");
    appendHistory(makeEntry({ cheapestPriceBRL: 1500, timestamp: "2026-03-24T06:00:00.000Z" }));
    appendHistory(makeEntry({ cheapestPriceBRL: null, totalFound: 0, flights: [], timestamp: "2026-03-24T12:00:00.000Z" }));
    appendHistory(makeEntry({ cheapestPriceBRL: 1100, timestamp: "2026-03-24T18:00:00.000Z" }));

    expect(getLastCheapestPrice("BSB", "GRU", "2026-03-29")).toBe(1100);
  });
});

describe("getWeeklySummary", () => {
  // Reference "today" = 2026-03-29 (sunday)
  const TODAY = new Date("2026-03-29T20:00:00.000Z");

  // Current week: 2026-03-23 to 2026-03-29
  const THIS_WEEK_TS = "2026-03-26T10:00:00.000Z";
  // Previous week: 2026-03-16 to 2026-03-22
  const PREV_WEEK_TS = "2026-03-19T10:00:00.000Z";
  // Older than 2 weeks — should be ignored
  const OLD_TS = "2026-03-01T10:00:00.000Z";

  it("retorna array vazio quando não há histórico", () => {
    const { getWeeklySummary } = require("../services/history");
    expect(getWeeklySummary(TODAY)).toEqual([]);
  });

  it("retorna menor preço da semana atual por rota", () => {
    const { appendHistory, getWeeklySummary } = require("../services/history");
    appendHistory(makeEntry({ cheapestPriceBRL: 1500, timestamp: THIS_WEEK_TS }));
    appendHistory(makeEntry({ cheapestPriceBRL: 1200, timestamp: THIS_WEEK_TS }));

    const result = getWeeklySummary(TODAY);
    expect(result).toHaveLength(1);
    expect(result[0].route).toBe("BSB→GRU");
    expect(result[0].currentWeekMin).toBe(1200);
  });

  it("retorna menor preço da semana anterior por rota", () => {
    const { appendHistory, getWeeklySummary } = require("../services/history");
    appendHistory(makeEntry({ cheapestPriceBRL: 2000, timestamp: PREV_WEEK_TS }));
    appendHistory(makeEntry({ cheapestPriceBRL: 1800, timestamp: PREV_WEEK_TS }));

    const result = getWeeklySummary(TODAY);
    expect(result[0].previousWeekMin).toBe(1800);
  });

  it("detecta tendência de baixa quando preço caiu mais de 2%", () => {
    const { appendHistory, getWeeklySummary } = require("../services/history");
    appendHistory(makeEntry({ cheapestPriceBRL: 1500, timestamp: PREV_WEEK_TS }));
    appendHistory(makeEntry({ cheapestPriceBRL: 1200, timestamp: THIS_WEEK_TS }));

    const result = getWeeklySummary(TODAY);
    expect(result[0].trend).toBe("down");
  });

  it("detecta tendência de alta quando preço subiu mais de 2%", () => {
    const { appendHistory, getWeeklySummary } = require("../services/history");
    appendHistory(makeEntry({ cheapestPriceBRL: 1000, timestamp: PREV_WEEK_TS }));
    appendHistory(makeEntry({ cheapestPriceBRL: 1500, timestamp: THIS_WEEK_TS }));

    const result = getWeeklySummary(TODAY);
    expect(result[0].trend).toBe("up");
  });

  it("detecta tendência estável quando variação é menor que 2%", () => {
    const { appendHistory, getWeeklySummary } = require("../services/history");
    appendHistory(makeEntry({ cheapestPriceBRL: 1000, timestamp: PREV_WEEK_TS }));
    appendHistory(makeEntry({ cheapestPriceBRL: 1010, timestamp: THIS_WEEK_TS }));

    const result = getWeeklySummary(TODAY);
    expect(result[0].trend).toBe("stable");
  });

  it("retorna trend 'unknown' quando há dados apenas de uma semana", () => {
    const { appendHistory, getWeeklySummary } = require("../services/history");
    appendHistory(makeEntry({ cheapestPriceBRL: 1200, timestamp: THIS_WEEK_TS }));

    const result = getWeeklySummary(TODAY);
    expect(result[0].trend).toBe("unknown");
    expect(result[0].previousWeekMin).toBeNull();
  });

  it("ignora entradas com mais de 2 semanas", () => {
    const { appendHistory, getWeeklySummary } = require("../services/history");
    appendHistory(makeEntry({ cheapestPriceBRL: 500, timestamp: OLD_TS }));

    const result = getWeeklySummary(TODAY);
    // Route appears in the map but with no prices in either window
    const gru = result.find((s: { route: string }) => s.route === "BSB→GRU");
    if (gru) {
      expect(gru.currentWeekMin).toBeNull();
      expect(gru.previousWeekMin).toBeNull();
    }
  });

  it("conta corretamente as verificações desta semana", () => {
    const { appendHistory, getWeeklySummary } = require("../services/history");
    appendHistory(makeEntry({ cheapestPriceBRL: 1200, timestamp: THIS_WEEK_TS }));
    appendHistory(makeEntry({ cheapestPriceBRL: null, totalFound: 0, flights: [], timestamp: THIS_WEEK_TS }));
    appendHistory(makeEntry({ cheapestPriceBRL: 1100, timestamp: THIS_WEEK_TS }));

    const result = getWeeklySummary(TODAY);
    expect(result[0].checksThisWeek).toBe(3);
  });

  it("agrupa rotas distintas separadamente", () => {
    const { appendHistory, getWeeklySummary } = require("../services/history");
    appendHistory(makeEntry({ destination: "GRU", cheapestPriceBRL: 1200, timestamp: THIS_WEEK_TS }));
    appendHistory(makeEntry({ destination: "GIG", cheapestPriceBRL: 800, timestamp: THIS_WEEK_TS }));

    const result = getWeeklySummary(TODAY);
    expect(result).toHaveLength(2);
    const routes = result.map((s: { route: string }) => s.route).sort();
    expect(routes).toEqual(["BSB→GIG", "BSB→GRU"]);
  });
});
