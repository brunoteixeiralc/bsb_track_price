import { Flight, TripType } from "../types";

const mockConfig = {
  apify: { tokens: ["tok"], actorId: "actor" },
  rapidapi: { key: "key", host: "host" },
  telegram: { botToken: "bot", chatId: "chat" },
  search: {
    origins: ["BSB"],
    origin: "BSB",
    destinations: ["GRU"],
    departureDate: "2026-06-01",
    dateRangeDays: 1,
    tripType: "one-way" as TripType,
    returnDate: undefined as string | undefined,
    maxPriceBRL: 300,
    priceDropThreshold: 0.95,
  },
  filters: {
    airlinesWhitelist: [] as string[],
    maxStops: undefined as number | undefined,
    maxDurationHours: undefined as number | undefined,
  },
};

jest.mock("../config", () => ({ config: mockConfig }));

const mockSearchWithApify = jest.fn();
const mockSearchWithRapidAPI = jest.fn();
const mockSendFlightAlert = jest.fn();
const mockAppendHistory = jest.fn();
const mockGetLastCheapestPrice = jest.fn();
const mockGetAllActiveAlerts = jest.fn();

jest.mock("../apis/apify", () => ({
  searchWithApify: (...args: unknown[]) => mockSearchWithApify(...args),
}));

jest.mock("../apis/rapidapi", () => ({
  searchWithRapidAPI: (...args: unknown[]) => mockSearchWithRapidAPI(...args),
}));

jest.mock("../services/telegram", () => ({
  sendFlightAlert: (...args: unknown[]) => mockSendFlightAlert(...args),
  sendSummary: jest.fn(),
  sendDateRangeSummary: jest.fn(),
  sendErrorAlert: jest.fn(),
}));

jest.mock("../services/history", () => ({
  appendHistory: (...args: unknown[]) => mockAppendHistory(...args),
  getLastCheapestPrice: (...args: unknown[]) => mockGetLastCheapestPrice(...args),
}));

jest.mock("../services/user", () => ({
  getAllActiveAlerts: () => mockGetAllActiveAlerts(),
}));

jest.mock("../utils/retry", () => ({
  withRetry: (fn: () => Promise<unknown>) => fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAllActiveAlerts.mockResolvedValue([]);
  mockGetLastCheapestPrice.mockResolvedValue(null);
  mockSearchWithApify.mockResolvedValue([]);
});

function makeFlight(priceBRL: number): Flight {
  return {
    origin: "BSB",
    destination: "GRU",
    departureDate: "2026-06-01",
    tripType: "one-way",
    price: priceBRL,
    currency: "BRL",
    priceBRL,
    link: "https://example.com",
    source: "apify",
  };
}

describe("runTracker", () => {
  it("processa rotas globais do config", async () => {
    mockSearchWithApify.mockResolvedValue([makeFlight(200)]);
    const { runTracker } = await import("../services/tracker");
    await runTracker();
    expect(mockSearchWithApify).toHaveBeenCalled();
    expect(mockSendFlightAlert).toHaveBeenCalled();
  });

  it("processa alertas de usuários do banco", async () => {
    mockGetAllActiveAlerts.mockResolvedValue([
      {
        chat_id: "user123",
        origin: "BSB",
        destination: "FOR",
        departure_date: "2026-07-01",
        max_price_brl: 500,
        is_active: true,
        trip_type: "one-way"
      }
    ]);
    mockSearchWithApify.mockResolvedValue([makeFlight(400)]);
    
    const { runTracker } = await import("../services/tracker");
    await runTracker();
    
    // Deve buscar a rota do usuário
    expect(mockSearchWithApify).toHaveBeenCalledWith(
      expect.objectContaining({ origin: "BSB", destination: "FOR" })
    );
    // Deve enviar alerta para o chat_id do usuário
    expect(mockSendFlightAlert).toHaveBeenCalledWith(
      expect.any(Object),
      false,
      "user123"
    );
  });
});
