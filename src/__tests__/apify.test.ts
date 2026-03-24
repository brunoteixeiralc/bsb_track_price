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
};

describe("searchWithApify", () => {
  it("retorna voos mapeados quando o actor finaliza com sucesso", async () => {
    mock.onPost(/acts\/test-actor\/runs/).reply(200, {
      data: { id: "run1", status: "SUCCEEDED", defaultDatasetId: "ds1" },
    });
    mock.onGet(/datasets\/ds1\/items/).reply(200, [
      {
        price: 100,
        currency: "USD",
        origin: "BSB",
        destination: "GRU",
        departureDate: "2026-06-01",
        url: "https://example.com",
        airline: "LATAM",
      },
    ]);

    const { searchWithApify } = await import("../apis/apify");
    const flights = await searchWithApify(params);

    expect(flights).toHaveLength(1);
    expect(flights[0].source).toBe("apify");
    expect(flights[0].link).toBe("https://example.com");
    expect(flights[0].airline).toBe("LATAM");
    expect(flights[0].priceBRL).toBe(500);
  });

  it("usa o campo 'link' quando 'url' não está presente", async () => {
    mock.onPost(/acts\/test-actor\/runs/).reply(200, {
      data: { id: "run1", status: "SUCCEEDED", defaultDatasetId: "ds1" },
    });
    mock.onGet(/datasets\/ds1\/items/).reply(200, [
      { price: 200, currency: "BRL", link: "https://booking.com/flight" },
    ]);

    const { searchWithApify } = await import("../apis/apify");
    const flights = await searchWithApify(params);

    expect(flights).toHaveLength(1);
    expect(flights[0].link).toBe("https://booking.com/flight");
  });

  it("usa o campo 'bookingUrl' quando 'url' e 'link' não estão presentes", async () => {
    mock.onPost(/acts\/test-actor\/runs/).reply(200, {
      data: { id: "run1", status: "SUCCEEDED", defaultDatasetId: "ds1" },
    });
    mock.onGet(/datasets\/ds1\/items/).reply(200, [
      { price: 200, currency: "BRL", bookingUrl: "https://booking.com/alt" },
    ]);

    const { searchWithApify } = await import("../apis/apify");
    const flights = await searchWithApify(params);

    expect(flights).toHaveLength(1);
    expect(flights[0].link).toBe("https://booking.com/alt");
  });

  it("ignora itens sem preço", async () => {
    mock.onPost(/acts\/test-actor\/runs/).reply(200, {
      data: { id: "run1", status: "SUCCEEDED", defaultDatasetId: "ds1" },
    });
    mock.onGet(/datasets\/ds1\/items/).reply(200, [
      { currency: "BRL", url: "https://example.com" },
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

  it("usa parâmetros de busca como fallback para campos ausentes no item", async () => {
    mock.onPost(/acts\/test-actor\/runs/).reply(200, {
      data: { id: "run1", status: "SUCCEEDED", defaultDatasetId: "ds1" },
    });
    mock.onGet(/datasets\/ds1\/items/).reply(200, [
      { price: 300, currency: "BRL", url: "https://example.com" },
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
});
