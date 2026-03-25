import { Flight } from "../types";

const mockConfig = {
  apify: { token: "tok", actorId: "actor" },
  rapidapi: { key: "key", host: "host" },
  telegram: { botToken: "bot", chatId: "chat" },
  search: {
    origin: "BSB",
    destinations: ["GRU"],
    departureDate: "2026-06-01",
    returnDate: undefined,
    maxPriceBRL: 300,
  },
};

jest.mock("../config", () => ({ config: mockConfig }));

const mockSearchWithApify = jest.fn();
const mockSearchWithRapidAPI = jest.fn();
const mockSendFlightAlert = jest.fn();
const mockSendSummary = jest.fn();
const mockAppendHistory = jest.fn();

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

jest.mock("../services/history", () => ({
  appendHistory: (...args: unknown[]) => mockAppendHistory(...args),
}));

// sleep no-op para não atrasar os testes de retry
jest.mock("../utils/retry", () => {
  const actual = jest.requireActual("../utils/retry");
  return {
    withRetry: (fn: () => Promise<unknown>, maxAttempts: number, delayMs: number, onRetry?: (a: number, e: unknown) => void) =>
      actual.withRetry(fn, maxAttempts, delayMs, onRetry, async () => {}),
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSendFlightAlert.mockResolvedValue(undefined);
  mockSendSummary.mockResolvedValue(undefined);
  mockAppendHistory.mockReturnValue(undefined);
  mockConfig.search.destinations = ["GRU"];
});

function makeFlight(priceBRL: number, destination = "GRU"): Flight {
  return {
    origin: "BSB",
    destination,
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
    expect(mockSendSummary).toHaveBeenCalledWith(0, 2, "BSB→GRU");
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

  it("busca múltiplos destinos em sequência", async () => {
    mockConfig.search.destinations = ["GRU", "SDL"];
    mockSearchWithApify.mockResolvedValue([makeFlight(250)]);

    const { runTracker } = await import("../services/tracker");
    await runTracker();

    expect(mockSearchWithApify).toHaveBeenCalledTimes(2);
    expect(mockSearchWithApify).toHaveBeenCalledWith(
      expect.objectContaining({ destination: "GRU" })
    );
    expect(mockSearchWithApify).toHaveBeenCalledWith(
      expect.objectContaining({ destination: "SDL" })
    );
    expect(mockSendSummary).toHaveBeenCalledTimes(2);
  });

  it("passa a rota no resumo do Telegram", async () => {
    mockSearchWithApify.mockResolvedValue([]);

    const { runTracker } = await import("../services/tracker");
    await runTracker();

    expect(mockSendSummary).toHaveBeenCalledWith(0, 0, "BSB→GRU");
  });

  it("retenta Apify até 3x antes de cair para RapidAPI", async () => {
    mockSearchWithApify.mockRejectedValue(new Error("Apify down"));
    mockSearchWithRapidAPI.mockResolvedValue([makeFlight(250)]);

    const { runTracker } = await import("../services/tracker");
    await runTracker();

    expect(mockSearchWithApify).toHaveBeenCalledTimes(3);
    expect(mockSearchWithRapidAPI).toHaveBeenCalledTimes(1);
  });

  it("não chama RapidAPI se Apify sucede na segunda tentativa", async () => {
    mockSearchWithApify
      .mockRejectedValueOnce(new Error("Apify falha 1"))
      .mockResolvedValueOnce([makeFlight(200)]);

    const { runTracker } = await import("../services/tracker");
    await runTracker();

    expect(mockSearchWithApify).toHaveBeenCalledTimes(2);
    expect(mockSearchWithRapidAPI).not.toHaveBeenCalled();
    expect(mockSendFlightAlert).toHaveBeenCalledTimes(1);
  });
});
