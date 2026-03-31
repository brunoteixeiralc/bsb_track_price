import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import { Flight } from "../types";

// Mock do config para evitar erros de variáveis de ambiente ausentes
jest.mock("../config", () => ({
  config: {
    telegram: {
      botToken: "test-token",
      chatId: "123456",
    },
  },
}));

jest.mock("../services/currency", () => ({
  formatBRL: (v: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v),
  convertToBRL: jest.fn().mockImplementation(async (amount: number) =>
    Math.round(amount * 5.5 * 100) / 100
  ),
}));

const mock = new MockAdapter(axios);

afterEach(() => {
  mock.reset();
});

const baseFlight: Flight = {
  origin: "BSB",
  destination: "GRU",
  departureDate: "2026-06-01",
  tripType: "one-way",
  price: 250,
  currency: "BRL",
  priceBRL: 250,
  link: "https://example.com/flight",
  source: "apify",
};

describe("sendFlightAlert", () => {
  it("envia mensagem com origem, destino e preço formatados", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    const { sendFlightAlert } = await import("../services/telegram");
    await sendFlightAlert(baseFlight);

    const requestBody = JSON.parse(mock.history.post[0].data);
    expect(requestBody.chat_id).toBe("123456");
    expect(requestBody.parse_mode).toBe("Markdown");
    expect(requestBody.text).toContain("BSB → GRU");
    expect(requestBody.text).toContain("01/06/2026");
    expect(requestBody.text).toContain("R$");
    expect(requestBody.text).toContain("https://example.com/flight");
  });

  it("inclui data de volta quando presente", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    const { sendFlightAlert } = await import("../services/telegram");
    await sendFlightAlert({ ...baseFlight, returnDate: "2026-06-10" });

    const requestBody = JSON.parse(mock.history.post[0].data);
    expect(requestBody.text).toContain("10/06/2026");
  });

  it("inclui companhia aérea quando presente", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    const { sendFlightAlert } = await import("../services/telegram");
    await sendFlightAlert({ ...baseFlight, airline: "LATAM" });

    const requestBody = JSON.parse(mock.history.post[0].data);
    expect(requestBody.text).toContain("LATAM");
  });

  it("lança erro quando a API do Telegram falha", async () => {
    mock.onPost(/sendMessage/).networkError();

    const { sendFlightAlert } = await import("../services/telegram");
    await expect(sendFlightAlert(baseFlight)).rejects.toThrow();
  });

  it("exibe label 'Somente Ida' para voos one-way", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    const { sendFlightAlert } = await import("../services/telegram");
    await sendFlightAlert({ ...baseFlight, tripType: "one-way" });

    const requestBody = JSON.parse(mock.history.post[0].data);
    expect(requestBody.text).toContain("Somente Ida");
  });

  it("exibe label 'Ida e Volta' para voos round-trip", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    const { sendFlightAlert } = await import("../services/telegram");
    await sendFlightAlert({
      ...baseFlight,
      tripType: "round-trip",
      returnDate: "2026-06-10",
    });

    const requestBody = JSON.parse(mock.history.post[0].data);
    expect(requestBody.text).toContain("Ida e Volta");
    expect(requestBody.text).toContain("10/06/2026");
  });

  it("inclui linhas 📊 e 💡 quando priceInsights presente e preço abaixo da média", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    // priceBRL = 250, range [100, 300] USD → BRL: [550, 1650], midpoint = 1100
    // diffPct = round((1100 - 250) / 1100 * 100) = 77%
    const { sendFlightAlert } = await import("../services/telegram");
    await sendFlightAlert({
      ...baseFlight,
      priceBRL: 250,
      source: "apify",
      priceInsights: {
        lowestPrice: 80,
        priceLevel: "low",
        typicalPriceRange: [100, 300],
      },
    });

    const { text } = JSON.parse(mock.history.post[0].data);
    expect(text).toContain("📊 Nível: *BAIXO*");
    expect(text).toContain("💡 Este preço está");
    expect(text).toContain("abaixo da média histórica");
  });

  it("exibe 'acima da média' quando priceBRL supera o ponto médio da faixa típica", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    // range [10, 20] USD → BRL: [55, 110], midpoint = 82.5; priceBRL = 500 > midpoint
    const { sendFlightAlert } = await import("../services/telegram");
    await sendFlightAlert({
      ...baseFlight,
      priceBRL: 500,
      source: "apify",
      priceInsights: {
        lowestPrice: 10,
        priceLevel: "high",
        typicalPriceRange: [10, 20],
      },
    });

    const { text } = JSON.parse(mock.history.post[0].data);
    expect(text).toContain("📊 Nível: *ALTO*");
    expect(text).toContain("acima da média histórica");
  });

  it("não inclui linhas 📊/💡 quando priceInsights ausente", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    const { sendFlightAlert } = await import("../services/telegram");
    await sendFlightAlert({ ...baseFlight, priceInsights: undefined });

    const { text } = JSON.parse(mock.history.post[0].data);
    expect(text).not.toContain("📊");
    expect(text).not.toContain("💡");
  });

  it("exibe header de nível histórico BAIXO quando lowLevelAlert=true", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    const { sendFlightAlert } = await import("../services/telegram");
    await (sendFlightAlert as (f: typeof baseFlight, low: boolean) => Promise<void>)(baseFlight, true);

    const { text } = JSON.parse(mock.history.post[0].data);
    expect(text).toContain("📉");
    expect(text).toContain("nível histórico BAIXO");
    expect(text).not.toContain("Passagem barata encontrada");
  });

  it("exibe header padrão quando lowLevelAlert=false (default)", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    const { sendFlightAlert } = await import("../services/telegram");
    await sendFlightAlert(baseFlight);

    const { text } = JSON.parse(mock.history.post[0].data);
    expect(text).toContain("Passagem barata encontrada");
    expect(text).not.toContain("nível histórico BAIXO");
  });

  it("não inclui linhas 📊/💡 quando source é rapidapi", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    const { sendFlightAlert } = await import("../services/telegram");
    await sendFlightAlert({
      ...baseFlight,
      source: "rapidapi",
      priceInsights: {
        lowestPrice: 80,
        priceLevel: "low",
        typicalPriceRange: [100, 300],
      },
    });

    const { text } = JSON.parse(mock.history.post[0].data);
    expect(text).not.toContain("📊");
    expect(text).not.toContain("💡");
  });
});

describe("sendSummary", () => {
  it("envia mensagem de nenhuma passagem encontrada quando found === 0", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    const { sendSummary } = await import("../services/telegram");
    await sendSummary(0, 10);

    const requestBody = JSON.parse(mock.history.post[0].data);
    expect(requestBody.text).toContain("Nenhuma passagem");
    expect(requestBody.text).toContain("10");
  });

  it("envia mensagem de passagens encontradas quando found > 0", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    const { sendSummary } = await import("../services/telegram");
    await sendSummary(3, 15);

    const requestBody = JSON.parse(mock.history.post[0].data);
    expect(requestBody.text).toContain("3");
  });
});

describe("sendDateRangeSummary", () => {
  const bestFlight: Flight = {
    origin: "BSB",
    destination: "GRU",
    departureDate: "2026-06-05",
    tripType: "one-way",
    price: 200,
    currency: "BRL",
    priceBRL: 200,
    link: "https://example.com",
    source: "apify",
    airline: "LATAM",
  };

  it("envia mensagem com melhor voo quando abaixo do threshold", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    const { sendDateRangeSummary } = await import("../services/telegram");
    await sendDateRangeSummary("BSB→GRU", 3, bestFlight, 300);

    const requestBody = JSON.parse(mock.history.post[0].data);
    expect(requestBody.text).toContain("BSB→GRU");
    expect(requestBody.text).toContain("3");
    expect(requestBody.text).toContain("200");
    expect(requestBody.text).toContain("05/06/2026");
    expect(requestBody.text).toContain("LATAM");
  });

  it("envia mensagem sem voo quando melhor preço está acima do threshold", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    const { sendDateRangeSummary } = await import("../services/telegram");
    const above: Flight = { ...bestFlight, priceBRL: 500, price: 500 };
    await sendDateRangeSummary("BSB→GRU", 3, above, 300);

    const requestBody = JSON.parse(mock.history.post[0].data);
    expect(requestBody.text).toContain("Nenhum voo");
  });

  it("envia mensagem sem voo quando bestFlight é null", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    const { sendDateRangeSummary } = await import("../services/telegram");
    await sendDateRangeSummary("BSB→GRU", 2, null, 300);

    const requestBody = JSON.parse(mock.history.post[0].data);
    expect(requestBody.text).toContain("Nenhum voo");
  });

  it("exibe label 'Somente Ida' no resumo one-way", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    const { sendDateRangeSummary } = await import("../services/telegram");
    await sendDateRangeSummary("BSB→GRU", 2, null, 300, "one-way");

    const requestBody = JSON.parse(mock.history.post[0].data);
    expect(requestBody.text).toContain("Somente Ida");
  });

  it("exibe label 'Ida e Volta' no resumo round-trip", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    const { sendDateRangeSummary } = await import("../services/telegram");
    await sendDateRangeSummary("BSB→GRU", 2, null, 300, "round-trip");

    const requestBody = JSON.parse(mock.history.post[0].data);
    expect(requestBody.text).toContain("Ida e Volta");
  });
});

describe("sendErrorAlert", () => {
  it("envia alerta com rota e detalhes do erro", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    const { sendErrorAlert } = await import("../services/telegram");
    await sendErrorAlert("BSB→GRU", "Busca de 2026-06-01 falhou.");

    const requestBody = JSON.parse(mock.history.post[0].data);
    expect(requestBody.chat_id).toBe("123456");
    expect(requestBody.parse_mode).toBe("Markdown");
    expect(requestBody.text).toContain("BSB→GRU");
    expect(requestBody.text).toContain("Busca de 2026-06-01 falhou.");
    expect(requestBody.text).toContain("⚠️");
  });

  it("não lança erro se a API do Telegram falhar", async () => {
    mock.onPost(/sendMessage/).networkError();

    const { sendErrorAlert } = await import("../services/telegram");
    await expect(sendErrorAlert("BSB→GRU", "falha")).resolves.not.toThrow();
  });
});

describe("sendWeeklyReport", () => {
  const summaryDown = {
    route: "BSB→GRU",
    origin: "BSB",
    destination: "GRU",
    currentWeekMin: 1200,
    previousWeekMin: 1500,
    trend: "down" as const,
    checksThisWeek: 3,
  };

  const summaryUp = {
    route: "BSB→GIG",
    origin: "BSB",
    destination: "GIG",
    currentWeekMin: 900,
    previousWeekMin: 800,
    trend: "up" as const,
    checksThisWeek: 2,
  };

  const summaryUnknown = {
    route: "BSB→CNF",
    origin: "BSB",
    destination: "CNF",
    currentWeekMin: 700,
    previousWeekMin: null,
    trend: "unknown" as const,
    checksThisWeek: 1,
  };

  it("envia relatório com rota, menor preço e comparativo da semana anterior", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    const { sendWeeklyReport } = await import("../services/telegram");
    await sendWeeklyReport([summaryDown]);

    const requestBody = JSON.parse(mock.history.post[0].data);
    expect(requestBody.chat_id).toBe("123456");
    expect(requestBody.parse_mode).toBe("Markdown");
    expect(requestBody.text).toContain("BSB→GRU");
    expect(requestBody.text).toContain("1.200");  // R$ 1.200,00 em pt-BR
    expect(requestBody.text).toContain("1.500");
    expect(requestBody.text).toContain("📉");
    expect(requestBody.text).toContain("📊");
    expect(requestBody.text).toContain("Relatório Semanal");
  });

  it("exibe emoji de alta quando trend é up", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    const { sendWeeklyReport } = await import("../services/telegram");
    await sendWeeklyReport([summaryUp]);

    const requestBody = JSON.parse(mock.history.post[0].data);
    expect(requestBody.text).toContain("📈");
  });

  it("exibe mensagem de sem dados quando previousWeekMin é null", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    const { sendWeeklyReport } = await import("../services/telegram");
    await sendWeeklyReport([summaryUnknown]);

    const requestBody = JSON.parse(mock.history.post[0].data);
    expect(requestBody.text).toContain("sem dados");
    expect(requestBody.text).toContain("❓");
  });

  it("envia mensagem especial quando não há rotas", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    const { sendWeeklyReport } = await import("../services/telegram");
    await sendWeeklyReport([]);

    const requestBody = JSON.parse(mock.history.post[0].data);
    expect(requestBody.text).toContain("Nenhuma rota monitorada");
  });

  it("inclui total de verificações no rodapé", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    const { sendWeeklyReport } = await import("../services/telegram");
    await sendWeeklyReport([summaryDown, summaryUp]);

    const requestBody = JSON.parse(mock.history.post[0].data);
    // summaryDown.checksThisWeek (3) + summaryUp.checksThisWeek (2) = 5
    expect(requestBody.text).toContain("5");
  });

  it("lança erro quando a API do Telegram falha", async () => {
    mock.onPost(/sendMessage/).networkError();

    const { sendWeeklyReport } = await import("../services/telegram");
    await expect(sendWeeklyReport([summaryDown])).rejects.toThrow();
  });
});
