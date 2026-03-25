import { generateDateRange } from "../utils/dates";

describe("generateDateRange", () => {
  it("retorna array com uma única data quando days=1", () => {
    expect(generateDateRange("2026-06-01", 1)).toEqual(["2026-06-01"]);
  });

  it("retorna sequência de 3 datas consecutivas", () => {
    expect(generateDateRange("2026-06-01", 3)).toEqual([
      "2026-06-01",
      "2026-06-02",
      "2026-06-03",
    ]);
  });

  it("cruza corretamente a virada de mês", () => {
    const result = generateDateRange("2026-01-30", 3);
    expect(result).toEqual(["2026-01-30", "2026-01-31", "2026-02-01"]);
  });

  it("cruza corretamente a virada de ano", () => {
    const result = generateDateRange("2025-12-30", 4);
    expect(result).toEqual([
      "2025-12-30",
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
    ]);
  });

  it("retorna array vazio quando days=0", () => {
    expect(generateDateRange("2026-06-01", 0)).toEqual([]);
  });

  it("gera 30 datas a partir de uma data base", () => {
    const result = generateDateRange("2026-06-01", 30);
    expect(result).toHaveLength(30);
    expect(result[0]).toBe("2026-06-01");
    expect(result[29]).toBe("2026-06-30");
  });
});
