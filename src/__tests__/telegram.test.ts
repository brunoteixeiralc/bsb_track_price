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
    expect(requestBody.text).toContain("2026-06-01");
    expect(requestBody.text).toContain("R$");
    expect(requestBody.text).toContain("https://example.com/flight");
  });

  it("exibe header de nível histórico BAIXO quando isHistoricLow=true", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    const { sendFlightAlert } = await import("../services/telegram");
    await sendFlightAlert(baseFlight, true);

    const { text } = JSON.parse(mock.history.post[0].data);
    expect(text).toContain("🔥");
    expect(text).toContain("histórico BAIXO");
  });
});

describe("sendSummary", () => {
  it("envia mensagem de resumo de busca", async () => {
    // Nota: sendSummary agora apenas faz log, mas vamos testar se não quebra
    const { sendSummary } = await import("../services/telegram");
    await sendSummary(3, 15, "BSB→GRU");
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

  it("envia resumo de intervalo de datas", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    const { sendDateRangeSummary } = await import("../services/telegram");
    await sendDateRangeSummary("BSB→GRU", 3, bestFlight, 300, "one-way", "2026-06-01", "2026-06-03");

    const requestBody = JSON.parse(mock.history.post[0].data);
    expect(requestBody.text).toContain("BSB→GRU");
    expect(requestBody.text).toContain("3");
    expect(requestBody.text).toContain("200");
  });
});

describe("sendErrorAlert", () => {
  it("envia alerta de erro", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    const { sendErrorAlert } = await import("../services/telegram");
    await sendErrorAlert("BSB→GRU", "Erro de teste");

    const requestBody = JSON.parse(mock.history.post[0].data);
    expect(requestBody.text).toContain("Erro no Tracker");
    expect(requestBody.text).toContain("BSB→GRU");
  });
});
