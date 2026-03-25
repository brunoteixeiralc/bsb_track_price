// Importa apenas os tipos — a implementação é carregada dinamicamente em cada teste
import type { formatBRL as FormatBRL, getUSDtoBRL as GetUSDtoBRL, convertToBRL as ConvertToBRL } from "../services/currency";

// Helper: carrega currency.ts isolado com um axios.get mockado
async function loadCurrencyWith(
  getImpl: jest.Mock
): Promise<{ getUSDtoBRL: typeof GetUSDtoBRL; convertToBRL: typeof ConvertToBRL }> {
  let mod: { getUSDtoBRL: typeof GetUSDtoBRL; convertToBRL: typeof ConvertToBRL };

  jest.isolateModules(() => {
    jest.doMock("axios", () => ({ get: getImpl, post: jest.fn() }));
    mod = require("../services/currency");
    jest.dontMock("axios");
  });

  return mod!;
}

describe("formatBRL", () => {
  // formatBRL é pura — não depende de axios, carrega direto
  const { formatBRL } = jest.requireActual<{ formatBRL: typeof FormatBRL }>(
    "../services/currency"
  );

  it("formata número como moeda brasileira", () => {
    expect(formatBRL(300)).toBe("R$\u00a0300,00");
  });

  it("formata zero corretamente", () => {
    expect(formatBRL(0)).toBe("R$\u00a00,00");
  });

  it("formata valores grandes com separador de milhar", () => {
    expect(formatBRL(1500.5)).toBe("R$\u00a01.500,50");
  });
});

describe("getUSDtoBRL", () => {
  it("retorna a taxa da API", async () => {
    const getMock = jest.fn().mockResolvedValue({ data: { rates: { BRL: 5.75 } } });
    const { getUSDtoBRL } = await loadCurrencyWith(getMock);

    const rate = await getUSDtoBRL();
    expect(rate).toBe(5.75);
  });

  it("usa fallback 5.0 quando a API falha", async () => {
    const getMock = jest.fn().mockRejectedValue(new Error("Network Error"));
    const { getUSDtoBRL } = await loadCurrencyWith(getMock);

    const rate = await getUSDtoBRL();
    expect(rate).toBe(5.0);
  });

  it("usa o cache na segunda chamada (não faz nova request)", async () => {
    const getMock = jest.fn().mockResolvedValue({ data: { rates: { BRL: 5.5 } } });
    const { getUSDtoBRL } = await loadCurrencyWith(getMock);

    await getUSDtoBRL();
    await getUSDtoBRL();

    // Apenas 1 chamada HTTP mesmo sendo invocada 2 vezes
    expect(getMock).toHaveBeenCalledTimes(1);
  });
});

describe("convertToBRL", () => {
  it("retorna o valor sem conversão quando currency === BRL", async () => {
    const getMock = jest.fn();
    const { convertToBRL } = await loadCurrencyWith(getMock);

    const result = await convertToBRL(250, "BRL");
    expect(result).toBe(250);
    expect(getMock).not.toHaveBeenCalled();
  });

  it("converte USD para BRL usando a taxa da API", async () => {
    const getMock = jest.fn().mockResolvedValue({ data: { rates: { BRL: 6.0 } } });
    const { convertToBRL } = await loadCurrencyWith(getMock);

    const result = await convertToBRL(100, "USD");
    expect(result).toBe(600);
  });

  it("usa fallback de 5.0 quando a API de câmbio falha", async () => {
    const getMock = jest.fn().mockRejectedValue(new Error("Network Error"));
    const { convertToBRL } = await loadCurrencyWith(getMock);

    const result = await convertToBRL(100, "USD");
    expect(result).toBe(500);
  });

  it("converte moeda não-USD/BRL usando taxa direta da API", async () => {
    const getMock = jest.fn().mockResolvedValue({ data: { rates: { BRL: 1.2 } } });
    const { convertToBRL } = await loadCurrencyWith(getMock);

    const result = await convertToBRL(100, "EUR");
    expect(result).toBe(120);
  });

  it("usa fallback USD intermediário quando API de moeda não-USD falha", async () => {
    const getMock = jest.fn()
      .mockRejectedValueOnce(new Error("API error"))       // primeira chamada: taxa direta falha
      .mockRejectedValueOnce(new Error("API error"))       // segunda chamada: taxa USD falha
      .mockResolvedValueOnce({ data: { rates: { BRL: 5.0 } } }); // terceira: USD→BRL
    const { convertToBRL } = await loadCurrencyWith(getMock);

    const result = await convertToBRL(100, "EUR");
    expect(result).toBeGreaterThan(0);
  });
});
