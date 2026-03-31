import axios from "axios";
import MockAdapter from "axios-mock-adapter";

jest.mock("../config", () => ({
  config: {
    apify: { tokens: ["test-token"], actorId: "test-actor" },
    rapidapi: { key: "key", host: "host" },
    telegram: { botToken: "bot", chatId: "chat" },
    search: {
      origin: "BSB",
      destination: "GRU",
      departureDate: "2026-06-01",
      returnDate: undefined,
      maxPriceBRL: 300,
      adults: 1,
      children: 0,
    },
    filters: {
      maxStops: undefined,
      airlinesWhitelist: [],
      maxDurationHours: undefined,
    },
  },
}));

jest.mock("../services/currency", () => ({
  convertToBRL: jest.fn().mockResolvedValue(500),
  getUSDtoBRL: jest.fn().mockResolvedValue(5.0),
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

// Helper: cria um dataset de resposta direta do run-sync-get-dataset-items
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

// Helper: cria dataset com price_insights
function makeDatasetItemWithInsights(
  options: { price: number; airline?: string }[],
  priceInsights: unknown
) {
  return [{ ...makeDatasetItem(options)[0], price_insights: priceInsights }];
}

describe("searchWithApify", () => {
  it("retorna voos mapeados usando run-sync-get-dataset-items", async () => {
    mock.onPost(/run-sync-get-dataset-items/).reply(200, makeDatasetItem([{ price: 1500, airline: "Gol" }]));

    const { searchWithApify } = await import("../apis/apify");
    const flights = await searchWithApify(params);

    expect(flights).toHaveLength(1);
    expect(flights[0].source).toBe("apify");
    expect(flights[0].airline).toBe("Gol");
    expect(flights[0].priceBRL).toBe(500);
    expect(flights[0].currency).toBe("USD");
  });

  it("constrói link do Google Flights com origem, destino e data", async () => {
    mock.onPost(/run-sync-get-dataset-items/).reply(200, makeDatasetItem([{ price: 1200 }]));

    const { searchWithApify } = await import("../apis/apify");
    const flights = await searchWithApify(params);

    expect(flights[0].link).toContain("google.com/travel/flights");
    expect(flights[0].link).toContain("BSB");
    expect(flights[0].link).toContain("GRU");
  });

  it("mapeia voos de other_flights também", async () => {
    mock.onPost(/run-sync-get-dataset-items/).reply(200, [
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
    mock.onPost(/run-sync-get-dataset-items/).reply(200, [
      {
        best_flights: [{ flights: [{ departure_airport: { id: "BSB" }, arrival_airport: { id: "GRU" }, airline: "Gol" }] }],
        other_flights: [],
      },
    ]);

    const { searchWithApify } = await import("../apis/apify");
    const flights = await searchWithApify(params);

    expect(flights).toHaveLength(0);
  });

  it("retorna array vazio quando o dataset está vazio", async () => {
    mock.onPost(/run-sync-get-dataset-items/).reply(200, []);

    const { searchWithApify } = await import("../apis/apify");
    const flights = await searchWithApify(params);

    expect(flights).toHaveLength(0);
  });

  it("usa parâmetros de busca como fallback para campos ausentes no leg", async () => {
    mock.onPost(/run-sync-get-dataset-items/).reply(200, [
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
    mock.onPost(/run-sync-get-dataset-items/).networkError();

    const { searchWithApify } = await import("../apis/apify");
    await expect(searchWithApify(params)).rejects.toThrow();
  });

  it("propaga tripType para os voos retornados", async () => {
    mock.onPost(/run-sync-get-dataset-items/).reply(200, makeDatasetItem([{ price: 700 }]));

    const { searchWithApify } = await import("../apis/apify");
    const flights = await searchWithApify({ ...params, tripType: "round-trip" });

    expect(flights[0].tripType).toBe("round-trip");
  });

  it("envia return_date quando round-trip", async () => {
    mock.onPost(/run-sync-get-dataset-items/).reply(200, makeDatasetItem([{ price: 900 }]));

    const { searchWithApify } = await import("../apis/apify");
    await searchWithApify({ ...params, tripType: "round-trip", returnDate: "2026-06-10" });

    const body = JSON.parse(mock.history.post[0].data);
    expect(body.return_date).toBe("2026-06-10");
    expect(body.gl).toBe("br");
    expect(body.currency).toBe("USD");
  });

  it("passa hl=pt, adults, children e max_price convertido no body", async () => {
    mock.onPost(/run-sync-get-dataset-items/).reply(200, []);

    const { searchWithApify } = await import("../apis/apify");
    await searchWithApify(params);

    const body = JSON.parse(mock.history.post[0].data);
    expect(body.hl).toBe("pt");
    expect(body.adults).toBe(1);
    expect(body.children).toBe(0);
    expect(body.max_price).toBe(60); // 300 BRL / 5.0 = 60 USD
    expect(body.max_stops).toBeUndefined();
  });

  it("passa max_stops quando definido no config", async () => {
    mock.onPost(/run-sync-get-dataset-items/).reply(200, []);

    const { config } = await import("../config");
    (config.filters as any).maxStops = 0;

    const { searchWithApify } = await import("../apis/apify");
    await searchWithApify(params);

    (config.filters as any).maxStops = undefined;

    const body = JSON.parse(mock.history.post[0].data);
    expect(body.max_stops).toBe(0);
  });

  it("converte AIRLINES_WHITELIST para códigos IATA e passa no body", async () => {
    mock.onPost(/run-sync-get-dataset-items/).reply(200, []);

    const { config } = await import("../config");
    (config.filters as any).airlinesWhitelist = ["LATAM", "GOL", "Azul"];

    const { searchWithApify } = await import("../apis/apify");
    await searchWithApify(params);

    (config.filters as any).airlinesWhitelist = [];

    const body = JSON.parse(mock.history.post[0].data);
    expect(body.airlines).toBe("LA,G3,AD");
  });

  it("não passa airlines quando whitelist está vazia", async () => {
    mock.onPost(/run-sync-get-dataset-items/).reply(200, []);

    const { searchWithApify } = await import("../apis/apify");
    await searchWithApify(params);

    const body = JSON.parse(mock.history.post[0].data);
    expect(body.airlines).toBeUndefined();
  });

  it("ignora nomes de companhia sem mapeamento IATA", async () => {
    mock.onPost(/run-sync-get-dataset-items/).reply(200, []);

    const { config } = await import("../config");
    (config.filters as any).airlinesWhitelist = ["LATAM", "Desconhecida"];

    const { searchWithApify } = await import("../apis/apify");
    await searchWithApify(params);

    (config.filters as any).airlinesWhitelist = [];

    const body = JSON.parse(mock.history.post[0].data);
    expect(body.airlines).toBe("LA"); // só LATAM foi mapeada
  });

  describe("price_insights", () => {
    it("extrai priceInsights corretamente de um item com price_insights válido", async () => {
      mock.onPost(/run-sync-get-dataset-items/).reply(
        200,
        makeDatasetItemWithInsights([{ price: 100 }], {
          lowest_price: 80,
          price_level: "low",
          typical_price_range: [90, 200],
          price_history: [[1700000000, 95]],
        })
      );

      const { searchWithApify } = await import("../apis/apify");
      const flights = await searchWithApify(params);

      expect(flights[0].priceInsights).toEqual({
        lowestPrice: 80,
        priceLevel: "low",
        typicalPriceRange: [90, 200],
        priceHistory: [[1700000000, 95]],
      });
    });

    it("propaga priceInsights para todos os voos do mesmo item (best + other)", async () => {
      mock.onPost(/run-sync-get-dataset-items/).reply(200, [
        {
          best_flights: [{ price: 100, flights: [{ departure_airport: { id: "BSB", time: "2026-06-01 08:00" }, arrival_airport: { id: "GRU" }, airline: "LATAM" }] }],
          other_flights: [{ price: 120, flights: [{ departure_airport: { id: "BSB", time: "2026-06-01 12:00" }, arrival_airport: { id: "GRU" }, airline: "Gol" }] }],
          price_insights: { lowest_price: 80, price_level: "low", typical_price_range: [90, 200] },
        },
      ]);

      const { searchWithApify } = await import("../apis/apify");
      const flights = await searchWithApify(params);

      expect(flights).toHaveLength(2);
      expect(flights[0].priceInsights?.priceLevel).toBe("low");
      expect(flights[1].priceInsights?.priceLevel).toBe("low");
    });

    it("priceInsights é undefined quando item não tem price_insights", async () => {
      mock.onPost(/run-sync-get-dataset-items/).reply(200, makeDatasetItem([{ price: 100 }]));

      const { searchWithApify } = await import("../apis/apify");
      const flights = await searchWithApify(params);

      expect(flights[0].priceInsights).toBeUndefined();
    });

    it("priceInsights é undefined quando price_level tem valor desconhecido", async () => {
      mock.onPost(/run-sync-get-dataset-items/).reply(
        200,
        makeDatasetItemWithInsights([{ price: 100 }], {
          lowest_price: 80,
          price_level: "unknown_level",
          typical_price_range: [90, 200],
        })
      );

      const { searchWithApify } = await import("../apis/apify");
      const flights = await searchWithApify(params);

      expect(flights[0].priceInsights).toBeUndefined();
    });
  });

  describe("rotação de tokens", () => {
    it("usa o segundo token quando o primeiro retorna 402 (sem créditos)", async () => {
      const { config } = await import("../config");
      (config.apify as any).tokens = ["token-sem-credito", "token-valido"];

      mock.onPost(/run-sync-get-dataset-items/)
        .replyOnce(402, { error: "Insufficient credits" })
        .onPost(/run-sync-get-dataset-items/)
        .replyOnce(200, makeDatasetItem([{ price: 800 }]));

      const { searchWithApify } = await import("../apis/apify");
      const flights = await searchWithApify(params);

      (config.apify as any).tokens = ["test-token"];

      expect(mock.history.post).toHaveLength(2);
      expect(mock.history.post[0].headers!["Authorization"]).toBe("Bearer token-sem-credito");
      expect(mock.history.post[1].headers!["Authorization"]).toBe("Bearer token-valido");
      expect(flights).toHaveLength(1);
    });

    it("tenta todos os tokens e lança erro quando todos ficam sem créditos", async () => {
      const { config } = await import("../config");
      (config.apify as any).tokens = ["token-1", "token-2", "token-3"];

      mock.onPost(/run-sync-get-dataset-items/).reply(402, { error: "Insufficient credits" });

      const { searchWithApify } = await import("../apis/apify");
      await expect(searchWithApify(params)).rejects.toBeDefined();

      (config.apify as any).tokens = ["test-token"];

      expect(mock.history.post).toHaveLength(3); // tentou os 3 tokens
    });

    it("rotaciona quando o primeiro retorna 403 com mensagem de crédito", async () => {
      const { config } = await import("../config");
      (config.apify as any).tokens = ["token-sem-credito", "token-valido"];

      mock.onPost(/run-sync-get-dataset-items/)
        .replyOnce(403, { error: "insufficient credit balance" })
        .onPost(/run-sync-get-dataset-items/)
        .replyOnce(200, makeDatasetItem([{ price: 700 }]));

      const { searchWithApify } = await import("../apis/apify");
      const flights = await searchWithApify(params);

      (config.apify as any).tokens = ["test-token"];

      expect(mock.history.post).toHaveLength(2);
      expect(flights).toHaveLength(1);
    });

    it("não rotaciona quando o erro não é de créditos (ex: 500)", async () => {
      const { config } = await import("../config");
      (config.apify as any).tokens = ["token-1", "token-2"];

      mock.onPost(/run-sync-get-dataset-items/).replyOnce(500, { error: "Internal server error" });

      const { searchWithApify } = await import("../apis/apify");
      await expect(searchWithApify(params)).rejects.toBeDefined();

      (config.apify as any).tokens = ["test-token"];

      expect(mock.history.post).toHaveLength(1); // parou no primeiro erro
    });

    it("usa token único sem rotação quando só há um token", async () => {
      mock.onPost(/run-sync-get-dataset-items/).reply(200, makeDatasetItem([{ price: 600 }]));

      const { searchWithApify } = await import("../apis/apify");
      const flights = await searchWithApify(params);

      expect(mock.history.post).toHaveLength(1);
      expect(flights).toHaveLength(1);
    });
  });
});
