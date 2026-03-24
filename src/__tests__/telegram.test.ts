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

const mock = new MockAdapter(axios);

afterEach(() => {
  mock.reset();
});

const baseFlight: Flight = {
  origin: "BSB",
  destination: "GRU",
  departureDate: "2026-06-01",
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
});

describe("sendSummary", () => {
  it("envia mensagem de nenhuma passagem encontrada quando found === 0", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    const { sendSummary } = await import("../services/telegram");
    await sendSummary(0, 10);

    const requestBody = JSON.parse(mock.history.post[0].data);
    expect(requestBody.text).toContain("nenhuma passagem");
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
