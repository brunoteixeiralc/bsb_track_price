import { Flight } from "../types";

jest.mock("../config", () => ({
  config: {
    apify: { token: "tok", actorId: "actor" },
    rapidapi: { key: "key", host: "host" },
    telegram: { botToken: "bot", chatId: "chat" },
    search: {
      origin: "BSB",
      destination: "GRU",
      departureDate: "2026-06-01",
      returnDate: undefined,
      maxPriceBRL: 300,
    },
  },
}));

const mockSearchWithApify = jest.fn();
const mockSearchWithRapidAPI = jest.fn();
const mockSendFlightAlert = jest.fn();
const mockSendSummary = jest.fn();

jest.mock("../apis/apify", () => ({
  searchWithApify: (...args: unknown[]) => mockSearchWithApify(...args),
}));

jest.mock("../apis/rapidapi", () => ({
  searchWithRapidAPI: (...args: unknown[]) => mockSearchWithRapidAPI(...args),
}));

jest.mock("../services/telegram", () => ({
  sendFlightAlert: (...args: unknown[]) => mockSendFlightAlert(...args),
  sendSummary: (...args: unknown[]) => mockSendSummary(...args),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockSendFlightAlert.mockResolvedValue(undefined);
  mockSendSummary.mockResolvedValue(undefined);
});

function makeFlight(priceBRL: number): Flight {
  return {
    origin: "BSB",
    destination: "GRU",
    departureDate: "2026-06-01",
    price: priceBRL,
    currency: "BRL",
    priceBRL,
    link: "https://example.com",
    source: "apify",
  };
}

describe("runTracker", () => {
  it("envia alerta apenas para voos abaixo do threshold", async () => {
    mockSearchWithApify.mockResolvedValue([
      makeFlight(200),
      makeFlight(350), // acima de 300
      makeFlight(280),
    ]);

    const { runTracker } = await import("../services/tracker");
    await runTracker();

    expect(mockSendFlightAlert).toHaveBeenCalledTimes(2);
    const prices = mockSendFlightAlert.mock.calls.map(
      (call) => (call[0] as Flight).priceBRL
    );
    expect(prices).not.toContain(350);
  });

  it("ordena os voos por preço crescente antes de enviar", async () => {
    mockSearchWithApify.mockResolvedValue([
      makeFlight(280),
      makeFlight(150),
      makeFlight(200),
    ]);

    const { runTracker } = await import("../services/tracker");
    await runTracker();

    const prices = mockSendFlightAlert.mock.calls.map(
      (call) => (call[0] as Flight).priceBRL
    );
    expect(prices).toEqual([150, 200, 280]);
  });

  it("não envia alerta quando não há voos abaixo do threshold", async () => {
    mockSearchWithApify.mockResolvedValue([makeFlight(400), makeFlight(500)]);

    const { runTracker } = await import("../services/tracker");
    await runTracker();

    expect(mockSendFlightAlert).not.toHaveBeenCalled();
    expect(mockSendSummary).toHaveBeenCalledWith(0, 2);
  });

  it("usa RapidAPI como fallback quando Apify falha", async () => {
    mockSearchWithApify.mockRejectedValue(new Error("Apify down"));
    mockSearchWithRapidAPI.mockResolvedValue([makeFlight(250)]);

    const { runTracker } = await import("../services/tracker");
    await runTracker();

    expect(mockSearchWithRapidAPI).toHaveBeenCalled();
    expect(mockSendFlightAlert).toHaveBeenCalledTimes(1);
  });

  it("lança erro quando ambas as APIs falham", async () => {
    mockSearchWithApify.mockRejectedValue(new Error("Apify down"));
    mockSearchWithRapidAPI.mockRejectedValue(new Error("RapidAPI down"));

    const { runTracker } = await import("../services/tracker");
    await expect(runTracker()).rejects.toThrow();
  });
});
