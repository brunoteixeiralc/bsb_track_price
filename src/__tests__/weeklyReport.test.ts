import { isSunday } from "../services/weeklyReport";

// Mock pesado para evitar erros de variáveis de ambiente ausentes
jest.mock("../config", () => ({
  config: {
    telegram: { botToken: "test-token", chatId: "123456" },
    search: {
      origin: "BSB",
      destinations: ["GRU"],
      departureDate: "2026-06-01",
      dateRangeDays: 1,
      tripType: "one-way",
      maxPriceBRL: 300,
    },
  },
}));

jest.mock("../services/history", () => ({
  getWeeklySummary: jest.fn(),
}));

jest.mock("../services/telegram", () => ({
  sendWeeklyReport: jest.fn(),
}));

describe("isSunday", () => {
  it("retorna true para um domingo", () => {
    const sunday = new Date("2026-03-29T12:00:00Z"); // domingo
    expect(isSunday(sunday)).toBe(true);
  });

  it("retorna false para uma segunda-feira", () => {
    const monday = new Date("2026-03-30T12:00:00Z");
    expect(isSunday(monday)).toBe(false);
  });

  it("retorna false para um sábado", () => {
    const saturday = new Date("2026-03-28T12:00:00Z");
    expect(isSunday(saturday)).toBe(false);
  });
});

describe("runWeeklyReport", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("chama getWeeklySummary e sendWeeklyReport", async () => {
    const { getWeeklySummary } = require("../services/history");
    const { sendWeeklyReport } = require("../services/telegram");

    const mockSummaries = [
      {
        route: "BSB→GRU",
        origin: "BSB",
        destination: "GRU",
        currentWeekMin: 1200,
        previousWeekMin: 1500,
        trend: "down",
        checksThisWeek: 3,
      },
    ];

    getWeeklySummary.mockReturnValue(mockSummaries);
    sendWeeklyReport.mockResolvedValue(undefined);

    const { runWeeklyReport } = require("../services/weeklyReport");
    await runWeeklyReport();

    expect(getWeeklySummary).toHaveBeenCalledTimes(1);
    expect(sendWeeklyReport).toHaveBeenCalledWith(mockSummaries);
  });

  it("passa array vazio para sendWeeklyReport quando não há histórico", async () => {
    const { getWeeklySummary } = require("../services/history");
    const { sendWeeklyReport } = require("../services/telegram");

    getWeeklySummary.mockReturnValue([]);
    sendWeeklyReport.mockResolvedValue(undefined);

    const { runWeeklyReport } = require("../services/weeklyReport");
    await runWeeklyReport();

    expect(sendWeeklyReport).toHaveBeenCalledWith([]);
  });
});
