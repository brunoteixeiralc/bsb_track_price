import axios from "axios";
import MockAdapter from "axios-mock-adapter";

jest.mock("../config", () => ({
  config: {
    rapidapi: { key: "test-key", host: "sky-scrapper.p.rapidapi.com" },
    apify: { token: "tok", actorId: "actor" },
    telegram: { botToken: "bot", chatId: "chat" },
    search: {
      origin: "BSB", destination: "GRU",
      departureDate: "2026-06-01", returnDate: undefined, maxPriceBRL: 300,
    },
  },
}));

jest.mock("../services/currency", () => ({
  convertToBRL: jest.fn().mockResolvedValue(500),
}));

const mock = new MockAdapter(axios);

const params = { origin: "BSB", destination: "GRU", departureDate: "2026-06-01", tripType: "one-way" as const };

const airportReply = { data: [{ skyId: "BSB", entityId: "1234" }] };

function makeItinerary(price: number, deeplink = "https://skyscanner.com/flight") {
  return {
    price: { raw: price },
    deeplink,
    legs: [{
      origin: { displayCode: "BSB" },
      destination: { displayCode: "GRU" },
      departure: "2026-06-01T10:00:00",
      carriers: { marketing: [{ name: "LATAM" }] },
    }],
  };
}

afterEach(() => {
  mock.reset();
  jest.clearAllMocks();
});

describe("searchWithRapidAPI", () => {
  it("retorna voos mapeados com campos corretos", async () => {
    mock.onGet(/searchAirport/).reply(200, airportReply);
    mock.onGet(/searchFlights/).reply(200, {
      data: { itineraries: [makeItinerary(1500)] },
    });

    const { searchWithRapidAPI } = await import("../apis/rapidapi");
    const flights = await searchWithRapidAPI(params);

    expect(flights).toHaveLength(1);
    expect(flights[0].source).toBe("rapidapi");
    expect(flights[0].airline).toBe("LATAM");
    expect(flights[0].origin).toBe("BSB");
    expect(flights[0].priceBRL).toBe(500);
  });

  it("ignora itinerários sem preço ou sem deeplink", async () => {
    mock.onGet(/searchAirport/).reply(200, airportReply);
    mock.onGet(/searchFlights/).reply(200, {
      data: {
        itineraries: [
          { price: { raw: 1000 } },             // sem deeplink
          { deeplink: "https://example.com" },   // sem preço
          makeItinerary(1200),                   // válido
        ],
      },
    });

    const { searchWithRapidAPI } = await import("../apis/rapidapi");
    const flights = await searchWithRapidAPI(params);

    expect(flights).toHaveLength(1);
  });

  it("retorna array vazio quando não há itinerários", async () => {
    mock.onGet(/searchAirport/).reply(200, airportReply);
    mock.onGet(/searchFlights/).reply(200, { data: { itineraries: [] } });

    const { searchWithRapidAPI } = await import("../apis/rapidapi");
    const flights = await searchWithRapidAPI(params);

    expect(flights).toHaveLength(0);
  });

  it("usa origin/destination como fallback quando skyId não encontrado", async () => {
    mock.onGet(/searchAirport/).reply(200, { data: [] }); // sem resultados
    mock.onGet(/searchFlights/).reply(200, {
      data: { itineraries: [makeItinerary(900)] },
    });

    const { searchWithRapidAPI } = await import("../apis/rapidapi");
    const flights = await searchWithRapidAPI(params);

    expect(flights[0].origin).toBe("BSB");
    expect(flights[0].destination).toBe("GRU");
  });

  it("lança erro quando a requisição HTTP falha", async () => {
    mock.onGet(/searchAirport/).networkError();

    const { searchWithRapidAPI } = await import("../apis/rapidapi");
    await expect(searchWithRapidAPI(params)).rejects.toThrow();
  });

  it("propaga tripType para os voos retornados", async () => {
    mock.onGet(/searchAirport/).reply(200, airportReply);
    mock.onGet(/searchFlights/).reply(200, {
      data: { itineraries: [makeItinerary(1200)] },
    });

    const { searchWithRapidAPI } = await import("../apis/rapidapi");
    const flights = await searchWithRapidAPI({ ...params, tripType: "round-trip" });

    expect(flights[0].tripType).toBe("round-trip");
  });
});
