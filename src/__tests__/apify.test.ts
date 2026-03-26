import axios from "axios";
import MockAdapter from "axios-mock-adapter";

jest.mock("../config", () => ({
  config: {
    apify: { token: "test-token", actorId: "test-actor" },
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

jest.mock("../services/currency", () => ({
  convertToBRL: jest.fn().mockResolvedValue(500),
}));

const mock = new MockAdapter(axios);

afterEach(() => {
  mock.reset();
  jest.clearAllMocks();
});

const params = {
  origin: "BSB",
  destination: "GRU",
  departureDate: "2026-06-01",
  tripType: "one-way" as const,
};

// Helper: cria um item de dataset válido com best_flights
function makeDatasetItem(options: { price: number; airline?: string }[]) {
  return [
    {
      best_flights: options.map(({ price, airline }) => ({
        price,
        booking_token: "token123",
        flights: [
          {
            departure_airport: { id: "BSB", time: "2026-06-01 10:00" },
            arrival_airport: { id: "GRU", time: "2026-06-01 12:00" },
            airline: airline ?? "LATAM",
          },
        ],
      })),
      other_flights: [],
    },
  ];
}

describe("searchWithApify", () => {
  it("retorna voos mapeados quando o actor finaliza com sucesso", async () => {
    mock.onPost(/acts\/test-actor\/runs/).reply(200, {
      data: { id: "run1", status: "SUCCEEDED", defaultDatasetId: "ds1" },
    });
    mock.onGet(/datasets\/ds1\/items/).reply(200, makeDatasetItem([{ price: 1500, airline: "Gol" }]));

    const { searchWithApify } = await import("../apis/apify");
    const flights = await searchWithApify(params);

    expect(flights).toHaveLength(1);
    expect(flights[0].source).toBe("apify");
    expect(flights[0].airline).toBe("Gol");
    expect(flights[0].priceBRL).toBe(500);
    expect(flights[0].currency).toBe("USD");
  });

  it("constrói link do Google Flights com origem, destino e data", async () => {
    mock.onPost(/acts\/test-actor\/runs/).reply(200, {
      data: { id: "run1", status: "SUCCEEDED", defaultDatasetId: "ds1" },
    });
    mock.onGet(/datasets\/ds1\/items/).reply(200, makeDatasetItem([{ price: 1200 }]));

    const { searchWithApify } = await import("../apis/apify");
    const flights = await searchWithApify(params);

    expect(flights[0].link).toContain("google.com/travel/flights");
    expect(flights[0].link).toContain("BSB");
    expect(flights[0].link).toContain("GRU");
  });

  it("mapeia voos de other_flights também", async () => {
    mock.onPost(/acts\/test-actor\/runs/).reply(200, {
      data: { id: "run1", status: "SUCCEEDED", defaultDatasetId: "ds1" },
    });
    mock.onGet(/datasets\/ds1\/items/).reply(200, [
      {
        best_flights: [{ price: 1000, flights: [{ departure_airport: { id: "BSB", time: "2026-06-01 08:00" }, arrival_airport: { id: "GRU" }, airline: "LATAM" }] }],
        other_flights: [{ price: 1200, flights: [{ departure_airport: { id: "BSB", time: "2026-06-01 14:00" }, arrival_airport: { id: "GRU" }, airline: "Azul" }] }],
      },
    ]);

    const { searchWithApify } = await import("../apis/apify");
    const flights = await searchWithApify(params);

    expect(flights).toHaveLength(2);
  });

  it("ignora opções sem preço", async () => {
    mock.onPost(/acts\/test-actor\/runs/).reply(200, {
      data: { id: "run1", status: "SUCCEEDED", defaultDatasetId: "ds1" },
    });
    mock.onGet(/datasets\/ds1\/items/).reply(200, [
      {
        best_flights: [{ flights: [{ departure_airport: { id: "BSB" }, arrival_airport: { id: "GRU" }, airline: "Gol" }] }],
        other_flights: [],
      },
    ]);

    const { searchWithApify } = await import("../apis/apify");
    const flights = await searchWithApify(params);

    expect(flights).toHaveLength(0);
  });

  it("lança erro quando o actor falha", async () => {
    mock.onPost(/acts\/test-actor\/runs/).reply(200, {
      data: { id: "run1", status: "FAILED", defaultDatasetId: "ds1" },
    });

    const { searchWithApify } = await import("../apis/apify");
    await expect(searchWithApify(params)).rejects.toThrow("FAILED");
  });

  it("retorna array vazio quando o dataset está vazio", async () => {
    mock.onPost(/acts\/test-actor\/runs/).reply(200, {
      data: { id: "run1", status: "SUCCEEDED", defaultDatasetId: "ds1" },
    });
    mock.onGet(/datasets\/ds1\/items/).reply(200, []);

    const { searchWithApify } = await import("../apis/apify");
    const flights = await searchWithApify(params);

    expect(flights).toHaveLength(0);
  });

  it("usa parâmetros de busca como fallback para campos ausentes no leg", async () => {
    mock.onPost(/acts\/test-actor\/runs/).reply(200, {
      data: { id: "run1", status: "SUCCEEDED", defaultDatasetId: "ds1" },
    });
    mock.onGet(/datasets\/ds1\/items/).reply(200, [
      {
        best_flights: [{ price: 800, flights: [{}] }],
        other_flights: [],
      },
    ]);

    const { searchWithApify } = await import("../apis/apify");
    const flights = await searchWithApify(params);

    expect(flights[0].origin).toBe("BSB");
    expect(flights[0].destination).toBe("GRU");
    expect(flights[0].departureDate).toBe("2026-06-01");
  });

  it("lança erro quando a requisição HTTP falha", async () => {
    mock.onPost(/acts\/test-actor\/runs/).networkError();

    const { searchWithApify } = await import("../apis/apify");
    await expect(searchWithApify(params)).rejects.toThrow();
  });

  it("propaga tripType para os voos retornados", async () => {
    mock.onPost(/acts\/test-actor\/runs/).reply(200, {
      data: { id: "run1", status: "SUCCEEDED", defaultDatasetId: "ds1" },
    });
    mock.onGet(/datasets\/ds1\/items/).reply(200, makeDatasetItem([{ price: 700 }]));

    const { searchWithApify } = await import("../apis/apify");
    const flights = await searchWithApify({ ...params, tripType: "round-trip" });

    expect(flights[0].tripType).toBe("round-trip");
  });
});
