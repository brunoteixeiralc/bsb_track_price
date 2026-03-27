import { Flight, TripType } from "../types";

const mockConfig = {
  apify: { token: "tok", actorId: "actor" },
  rapidapi: { key: "key", host: "host" },
  telegram: { botToken: "bot", chatId: "chat" },
  search: {
    origin: "BSB",
    destinations: ["GRU"],
    departureDate: "2026-06-01",
    dateRangeDays: 1,
    tripType: "one-way" as TripType,
    returnDate: undefined as string | undefined,
    maxPriceBRL: 300,
  },
};

jest.mock("../config", () => ({ config: mockConfig }));

const mockSearchWithApify = jest.fn();
const mockSearchWithRapidAPI = jest.fn();
const mockSendFlightAlert = jest.fn();
const mockSendSummary = jest.fn();
const mockAppendHistory = jest.fn();
const mockGetLastCheapestPrice = jest.fn();

jest.mock("../apis/apify", () => ({
  searchWithApify: (...args: unknown[]) => mockSearchWithApify(...args),
}));

jest.mock("../apis/rapidapi", () => ({
  searchWithRapidAPI: (...args: unknown[]) => mockSearchWithRapidAPI(...args),
}));

const mockSendDateRangeSummary = jest.fn();
const mockSendErrorAlert = jest.fn();

jest.mock("../services/telegram", () => ({
  sendFlightAlert: (...args: unknown[]) => mockSendFlightAlert(...args),
  sendSummary: (...args: unknown[]) => mockSendSummary(...args),
  sendDateRangeSummary: (...args: unknown[]) => mockSendDateRangeSummary(...args),
  sendErrorAlert: (...args: unknown[]) => mockSendErrorAlert(...args),
}));

jest.mock("../services/history", () => ({
  appendHistory: (...args: unknown[]) => mockAppendHistory(...args),
  getLastCheapestPrice: (...args: unknown[]) => mockGetLastCheapestPrice(...args),
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
  mockSendDateRangeSummary.mockResolvedValue(undefined);
  mockSendErrorAlert.mockResolvedValue(undefined);
  mockAppendHistory.mockReturnValue(undefined);
  // Por padrão, sem histórico anterior (primeira busca → alerta permitido)
  mockGetLastCheapestPrice.mockReturnValue(null);
  mockConfig.search.destinations = ["GRU"];
  mockConfig.search.dateRangeDays = 1;
  mockConfig.search.tripType = "one-way";
  mockConfig.search.returnDate = undefined;
});

function makeFlight(priceBRL: number, destination = "GRU", tripType: Flight["tripType"] = "one-way"): Flight {
  return {
    origin: "BSB",
    destination,
    departureDate: "2026-06-01",
    tripType,
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

  it("envia alerta de erro no Telegram quando ambas as APIs falham (data única)", async () => {
    mockSearchWithApify.mockRejectedValue(new Error("Apify down"));
    mockSearchWithRapidAPI.mockRejectedValue(new Error("RapidAPI down"));

    const { runTracker } = await import("../services/tracker");
    await runTracker().catch(() => {});

    expect(mockSendErrorAlert).toHaveBeenCalledTimes(1);
    expect(mockSendErrorAlert).toHaveBeenCalledWith(
      "BSB→GRU",
      expect.stringContaining("2026-06-01")
    );
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

  it("com dateRangeDays=3 busca API 3x e alerta a data mais barata", async () => {
    mockConfig.search.dateRangeDays = 3;
    mockSearchWithApify
      .mockResolvedValueOnce([makeFlight(500)])  // 2026-06-01
      .mockResolvedValueOnce([makeFlight(200)])  // 2026-06-02 — mais barata
      .mockResolvedValueOnce([makeFlight(350)]); // 2026-06-03

    const { runTracker } = await import("../services/tracker");
    await runTracker();

    expect(mockSearchWithApify).toHaveBeenCalledTimes(3);
    expect(mockSendFlightAlert).toHaveBeenCalledTimes(1);
    expect((mockSendFlightAlert.mock.calls[0][0] as Flight).priceBRL).toBe(200);
    expect(mockSendDateRangeSummary).toHaveBeenCalledWith("BSB→GRU", 3, expect.objectContaining({ priceBRL: 200 }), 300, "one-way");
  });

  it("com dateRangeDays>1 não alerta se nenhuma data estiver abaixo do threshold", async () => {
    mockConfig.search.dateRangeDays = 2;
    mockSearchWithApify.mockResolvedValue([makeFlight(400)]);

    const { runTracker } = await import("../services/tracker");
    await runTracker();

    expect(mockSendFlightAlert).not.toHaveBeenCalled();
    expect(mockSendDateRangeSummary).toHaveBeenCalledWith("BSB→GRU", 2, expect.objectContaining({ priceBRL: 400 }), 300, "one-way");
  });

  it("com dateRangeDays>1 pula datas onde ambas as APIs falham", async () => {
    mockConfig.search.dateRangeDays = 2;
    mockSearchWithApify.mockRejectedValue(new Error("Apify down"));
    mockSearchWithRapidAPI
      .mockRejectedValueOnce(new Error("RapidAPI down"))  // primeira data falha
      .mockResolvedValueOnce([makeFlight(250)]);           // segunda data ok

    const { runTracker } = await import("../services/tracker");
    await runTracker();

    expect(mockSendFlightAlert).toHaveBeenCalledTimes(1);
    expect(mockSendDateRangeSummary).toHaveBeenCalledWith("BSB→GRU", 2, expect.objectContaining({ priceBRL: 250 }), 300, "one-way");
  });

  it("passa tripType round-trip e returnDate nos params da busca", async () => {
    mockConfig.search.tripType = "round-trip";
    mockConfig.search.returnDate = "2026-06-10";
    mockSearchWithApify.mockResolvedValue([makeFlight(350, "GRU", "round-trip")]);

    const { runTracker } = await import("../services/tracker");
    await runTracker();

    expect(mockSearchWithApify).toHaveBeenCalledWith(
      expect.objectContaining({ tripType: "round-trip", returnDate: "2026-06-10" })
    );
  });

  it("com dateRangeDays>1 envia só o errorAlert (sem summary) quando todas as datas falham", async () => {
    mockConfig.search.dateRangeDays = 2;
    mockSearchWithApify.mockRejectedValue(new Error("Apify down"));
    mockSearchWithRapidAPI.mockRejectedValue(new Error("RapidAPI down"));

    const { runTracker } = await import("../services/tracker");
    await runTracker();

    expect(mockSendFlightAlert).not.toHaveBeenCalled();
    expect(mockSendErrorAlert).toHaveBeenCalledWith("BSB→GRU", expect.stringContaining("2 data(s)"));
    expect(mockSendDateRangeSummary).not.toHaveBeenCalled();
  });

  it("envia alerta de erro quando todas as datas do intervalo falham", async () => {
    mockConfig.search.dateRangeDays = 3;
    mockSearchWithApify.mockRejectedValue(new Error("Apify down"));
    mockSearchWithRapidAPI.mockRejectedValue(new Error("RapidAPI down"));

    const { runTracker } = await import("../services/tracker");
    await runTracker();

    expect(mockSendErrorAlert).toHaveBeenCalledTimes(1);
    expect(mockSendErrorAlert).toHaveBeenCalledWith(
      "BSB→GRU",
      expect.stringContaining("3 data(s)")
    );
  });

  it("não envia alerta de erro quando apenas algumas datas do intervalo falham", async () => {
    mockConfig.search.dateRangeDays = 2;
    mockSearchWithApify.mockRejectedValue(new Error("Apify down"));
    mockSearchWithRapidAPI
      .mockRejectedValueOnce(new Error("RapidAPI down")) // primeira data falha
      .mockResolvedValueOnce([makeFlight(250)]);          // segunda data ok

    const { runTracker } = await import("../services/tracker");
    await runTracker();

    expect(mockSendErrorAlert).not.toHaveBeenCalled();
  });

  // ── Anti-spam ──────────────────────────────────────────────────────────────

  it("anti-spam: não envia alerta se o preço não caiu ≥5% desde a última busca", async () => {
    // Preço anterior: R$200 — preço atual: R$196 (queda de 2%, abaixo de 5%)
    mockGetLastCheapestPrice.mockReturnValue(200);
    mockSearchWithApify.mockResolvedValue([makeFlight(196)]);

    const { runTracker } = await import("../services/tracker");
    await runTracker();

    expect(mockSendFlightAlert).not.toHaveBeenCalled();
    // Summary ainda é enviado mesmo sem alerta
    expect(mockSendSummary).toHaveBeenCalledWith(1, 1, "BSB→GRU");
  });

  it("anti-spam: envia alerta quando o preço cai ≥5% desde a última busca", async () => {
    // Preço anterior: R$200 — preço atual: R$180 (queda de 10%)
    mockGetLastCheapestPrice.mockReturnValue(200);
    mockSearchWithApify.mockResolvedValue([makeFlight(180)]);

    const { runTracker } = await import("../services/tracker");
    await runTracker();

    expect(mockSendFlightAlert).toHaveBeenCalledTimes(1);
    expect((mockSendFlightAlert.mock.calls[0][0] as Flight).priceBRL).toBe(180);
  });

  it("anti-spam: envia alerta quando é a primeira busca (sem histórico anterior)", async () => {
    // mockGetLastCheapestPrice já retorna null por padrão no beforeEach
    mockSearchWithApify.mockResolvedValue([makeFlight(250)]);

    const { runTracker } = await import("../services/tracker");
    await runTracker();

    expect(mockSendFlightAlert).toHaveBeenCalledTimes(1);
  });

  it("anti-spam: envia alerta quando preço cai exatamente 5%", async () => {
    // Preço anterior: R$200 — preço atual: R$190 (queda exata de 5%)
    mockGetLastCheapestPrice.mockReturnValue(200);
    mockSearchWithApify.mockResolvedValue([makeFlight(190)]);

    const { runTracker } = await import("../services/tracker");
    await runTracker();

    expect(mockSendFlightAlert).toHaveBeenCalledTimes(1);
  });

  it("anti-spam (dateRange): suprime alerta quando melhor preço não caiu ≥5%", async () => {
    mockConfig.search.dateRangeDays = 2;
    // Preço anterior para a data mais barata: R$200, preço atual R$196 (queda de 2%)
    mockGetLastCheapestPrice.mockReturnValue(200);
    mockSearchWithApify
      .mockResolvedValueOnce([makeFlight(196)]) // 2026-06-01
      .mockResolvedValueOnce([makeFlight(300)]); // 2026-06-02

    const { runTracker } = await import("../services/tracker");
    await runTracker();

    expect(mockSendFlightAlert).not.toHaveBeenCalled();
  });

  it("anti-spam (dateRange): envia alerta quando melhor preço caiu ≥5%", async () => {
    mockConfig.search.dateRangeDays = 2;
    // Preço anterior para a data mais barata: R$200, preço atual R$180 (queda de 10%)
    mockGetLastCheapestPrice.mockReturnValue(200);
    mockSearchWithApify
      .mockResolvedValueOnce([makeFlight(180)]) // 2026-06-01
      .mockResolvedValueOnce([makeFlight(300)]); // 2026-06-02

    const { runTracker } = await import("../services/tracker");
    await runTracker();

    expect(mockSendFlightAlert).toHaveBeenCalledTimes(1);
    expect((mockSendFlightAlert.mock.calls[0][0] as Flight).priceBRL).toBe(180);
  });
});
