import path from "path";

const TMP_DIR = path.resolve("/tmp", ".bsb-test-history-dbg");
const TMP_DB = path.join(TMP_DIR, "history.db");

jest.mock("path", () => {
  const actual = jest.requireActual("path");
  return {
    ...actual,
    resolve: (...args: string[]) => {
      const result = actual.resolve(...args);
      if (result.endsWith(actual.join("data", "history.db"))) {
        return TMP_DB;
      }
      return result;
    },
  };
});

import fs from "fs";

it("history module loads and appends in /tmp", () => {
  if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });
  
  jest.resetModules();
  try {
    const { appendHistory, loadHistory, closeDb } = require("../services/history");
    expect(loadHistory()).toEqual([]);
    appendHistory({
      timestamp: "2026-04-02T10:00:00.000Z",
      origin: "BSB", destination: "GRU", departureDate: "2026-05-01",
      totalFound: 1, cheapestPriceBRL: 1500,
      flights: [{ airline: "Gol", priceBRL: 1500, link: "https://ex.com", source: "apify" }]
    });
    expect(loadHistory()).toHaveLength(1);
    closeDb();
  } catch (err) {
    console.error("TEST ERROR:", err);
    throw err;
  }

  if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true });
});
