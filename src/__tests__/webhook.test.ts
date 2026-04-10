import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import http from "http";

jest.mock("../config", () => ({
  config: {
    telegram: {
      botToken: "test-token",
      chatId: "999",
    },
    search: {
      origin: "BSB",
      destinations: ["GRU", "FOR"],
      departureDate: "2026-06-01",
      returnDate: undefined,
      tripType: "one-way",
      maxPriceBRL: 300,
    },
  },
}));

jest.mock("../apis/apify", () => ({
  searchWithApify: jest.fn(),
}));

jest.mock("../apis/rapidapi", () => ({
  searchWithRapidAPI: jest.fn(),
}));

jest.mock("../services/history", () => ({
  loadHistory: jest.fn(),
}));

import { searchWithApify } from "../apis/apify";
import { searchWithRapidAPI } from "../apis/rapidapi";
import { loadHistory } from "../services/history";
import {
  sendReply,
  handleBuscar,
  handleHistorico,
  handleStatus,
  handleUpdate,
  createWebhookServer,
} from "../services/webhook";

const mockApify = searchWithApify as jest.MockedFunction<typeof searchWithApify>;
const mockRapidAPI = searchWithRapidAPI as jest.MockedFunction<typeof searchWithRapidAPI>;
const mockLoadHistory = loadHistory as jest.MockedFunction<typeof loadHistory>;

const mock = new MockAdapter(axios);

afterEach(() => {
  mock.reset();
  jest.clearAllMocks();
});

const baseFlight = {
  origin: "BSB",
  destination: "GRU",
  departureDate: "2026-06-01",
  tripType: "one-way" as const,
  price: 250,
  currency: "BRL",
  priceBRL: 250,
  link: "https://example.com/flight",
  source: "apify" as const,
};

// ─── sendReply ────────────────────────────────────────────────────────────────

describe("sendReply", () => {
  it("envia mensagem para o chatId informado", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });
    await sendReply(123, "Olá!");
    const body = JSON.parse(mock.history.post[0].data);
    expect(body.chat_id).toBe(123);
    expect(body.text).toBe("Olá!");
    expect(body.parse_mode).toBe("Markdown");
  });
});

// ─── handleBuscar ─────────────────────────────────────────────────────────────

describe("handleBuscar", () => {
  it("avisa sobre uso incorreto quando destino não é fornecido", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });
    await handleBuscar(123, "");
    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("/buscar DESTINO");
  });

  it("envia mensagem de aguarde e depois retorna melhores preços", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });
    mockApify.mockResolvedValueOnce([
      { ...baseFlight, priceBRL: 250, airline: "LATAM" },
      { ...baseFlight, priceBRL: 180 },
    ]);

    await handleBuscar(123, "GRU");

    expect(mock.history.post.length).toBeGreaterThanOrEqual(2);
    const aguardeBody = JSON.parse(mock.history.post[0].data);
    expect(aguardeBody.text).toContain("aguarde");

    const resultBody = JSON.parse(mock.history.post[1].data);
    expect(resultBody.text).toContain("BSB → GRU");
    expect(resultBody.text).toContain("2 voo(s)");
    expect(resultBody.text).toContain("LATAM");
  });

  it("converte destino para maiúsculas", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });
    mockApify.mockResolvedValueOnce([{ ...baseFlight, destination: "GRU" }]);

    await handleBuscar(123, "gru");

    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("GRU");
  });

  it("informa quando não há voos encontrados", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });
    mockApify.mockResolvedValueOnce([]);

    await handleBuscar(123, "GRU");

    const resultBody = JSON.parse(mock.history.post[1].data);
    expect(resultBody.text).toContain("Nenhum voo encontrado");
  });

  it("usa RapidAPI como fallback quando Apify falha", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });
    mockApify.mockRejectedValueOnce(new Error("Apify down"));
    mockRapidAPI.mockResolvedValueOnce([{ ...baseFlight, priceBRL: 199, source: "rapidapi" }]);

    await handleBuscar(123, "GRU");

    const resultBody = JSON.parse(mock.history.post[1].data);
    expect(resultBody.text).toContain("BSB → GRU");
  });

  it("envia erro quando ambas as APIs falham", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });
    mockApify.mockRejectedValueOnce(new Error("Apify down"));
    mockRapidAPI.mockRejectedValueOnce(new Error("RapidAPI down"));

    await handleBuscar(123, "GRU");

    const resultBody = JSON.parse(mock.history.post[1].data);
    expect(resultBody.text).toContain("Falha ao buscar");
  });

  it("indica quantos voos estão abaixo do threshold", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });
    mockApify.mockResolvedValueOnce([
      { ...baseFlight, priceBRL: 200 },
      { ...baseFlight, priceBRL: 400 },
    ]);

    await handleBuscar(123, "GRU");

    const resultBody = JSON.parse(mock.history.post[1].data);
    expect(resultBody.text).toContain("1 abaixo de");
  });

  it("indica quando nenhum voo está abaixo do threshold", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });
    mockApify.mockResolvedValueOnce([{ ...baseFlight, priceBRL: 999 }]);

    await handleBuscar(123, "GRU");

    const resultBody = JSON.parse(mock.history.post[1].data);
    expect(resultBody.text).toContain("Nenhum abaixo de");
  });
});

// ─── handleHistorico ──────────────────────────────────────────────────────────

describe("handleHistorico", () => {
  it("avisa sobre uso incorreto quando destino não é fornecido", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });
    await handleHistorico(123, "");
    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("/historico DESTINO");
  });

  it("informa quando não há histórico para o destino", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });
    mockLoadHistory.mockReturnValueOnce([]);

    await handleHistorico(123, "GRU");

    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("Sem histórico");
    expect(body.text).toContain("GRU");
  });

  it("exibe as últimas entradas do histórico para o destino", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });
    mockLoadHistory.mockReturnValueOnce([
      {
        timestamp: "2026-06-01T10:00:00.000Z",
        origin: "BSB",
        destination: "GRU",
        departureDate: "2026-06-01",
        totalFound: 5,
        cheapestPriceBRL: 220,
        flights: [],
      },
    ]);

    await handleHistorico(123, "GRU");

    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("Histórico BSB → GRU");
    expect(body.text).toContain("5 voo(s)");
    expect(body.text).toContain("R$");
  });

  it("filtra histórico apenas para o destino solicitado", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });
    mockLoadHistory.mockReturnValueOnce([
      {
        timestamp: "2026-06-01T10:00:00.000Z",
        origin: "BSB",
        destination: "FOR",
        departureDate: "2026-06-01",
        totalFound: 3,
        cheapestPriceBRL: 150,
        flights: [],
      },
    ]);

    await handleHistorico(123, "GRU");

    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("Sem histórico");
  });

  it("exibe '—' quando cheapestPriceBRL é null", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });
    mockLoadHistory.mockReturnValueOnce([
      {
        timestamp: "2026-06-01T10:00:00.000Z",
        origin: "BSB",
        destination: "GRU",
        departureDate: "2026-06-01",
        totalFound: 0,
        cheapestPriceBRL: null,
        flights: [],
      },
    ]);

    await handleHistorico(123, "GRU");

    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("—");
  });
});

// ─── handleStatus ─────────────────────────────────────────────────────────────

describe("handleStatus", () => {
  it("envia mensagem de status com informações do tracker", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    await handleStatus(123);

    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("Tracker ativo");
    expect(body.text).toContain("BSB");
    expect(body.text).toContain("GRU");
    expect(body.text).toContain("2026-06-01");
  });
});

// ─── handleUpdate ─────────────────────────────────────────────────────────────

describe("handleUpdate", () => {
  it("ignora updates sem mensagem de texto", async () => {
    await handleUpdate({ update_id: 1 });
    expect(mock.history.post.length).toBe(0);
  });

  it("roteia /buscar corretamente", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });
    mockApify.mockResolvedValueOnce([]);

    await handleUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        chat: { id: 999, type: "private" },
        text: "/buscar GRU",
      },
    });

    expect(mock.history.post.length).toBeGreaterThan(0);
  });

  it("roteia /historico corretamente", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });
    mockLoadHistory.mockReturnValueOnce([]);

    await handleUpdate({
      update_id: 2,
      message: {
        message_id: 2,
        chat: { id: 999, type: "private" },
        text: "/historico GRU",
      },
    });

    expect(mock.history.post.length).toBeGreaterThan(0);
  });

  it("roteia /status corretamente", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    await handleUpdate({
      update_id: 3,
      message: {
        message_id: 3,
        chat: { id: 999, type: "private" },
        text: "/status",
      },
    });

    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("Tracker ativo");
  });

  it("responde com lista de comandos para comando desconhecido", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    await handleUpdate({
      update_id: 4,
      message: {
        message_id: 4,
        chat: { id: 999, type: "private" },
        text: "/desconhecido",
      },
    });

    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("Comando não reconhecido");
    expect(body.text).toContain("/buscar");
    expect(body.text).toContain("/historico");
    expect(body.text).toContain("/status");
  });

  it("remove sufixo de bot username do comando", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    await handleUpdate({
      update_id: 5,
      message: {
        message_id: 5,
        chat: { id: 999, type: "private" },
        text: "/status@MeuTrackerBot",
      },
    });

    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("Tracker ativo");
  });
});

// ─── createWebhookServer ──────────────────────────────────────────────────────

describe("createWebhookServer", () => {
  let server: http.Server;

  afterEach((done) => {
    if (server?.listening) server.close(done);
    else done();
  });

  it("responde 405 para métodos não-POST", (done) => {
    server = createWebhookServer();
    server.listen(0, () => {
      const addr = server.address() as { port: number };
      const req = http.request(
        { host: "localhost", port: addr.port, method: "GET", path: "/" },
        (res) => {
          expect(res.statusCode).toBe(405);
          done();
        }
      );
      req.end();
    });
  });

  it("responde 200 para POST válido", (done) => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });
    mockLoadHistory.mockReturnValue([]);

    server = createWebhookServer();
    server.listen(0, () => {
      const addr = server.address() as { port: number };
      const body = JSON.stringify({
        update_id: 1,
        message: {
          message_id: 1,
          chat: { id: 999, type: "private" },
          text: "/status",
        },
      });

      const req = http.request(
        {
          host: "localhost",
          port: addr.port,
          method: "POST",
          path: "/",
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        },
        (res) => {
          expect(res.statusCode).toBe(200);
          done();
        }
      );
      req.write(body);
      req.end();
    });
  });

  it("responde 200 mesmo para JSON inválido", (done) => {
    server = createWebhookServer();
    server.listen(0, () => {
      const addr = server.address() as { port: number };
      const body = "not-valid-json";

      const req = http.request(
        {
          host: "localhost",
          port: addr.port,
          method: "POST",
          path: "/",
          headers: { "Content-Length": Buffer.byteLength(body) },
        },
        (res) => {
          expect(res.statusCode).toBe(200);
          done();
        }
      );
      req.write(body);
      req.end();
    });
  });
});
