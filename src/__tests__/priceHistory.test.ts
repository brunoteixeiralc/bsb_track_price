import { calcTrend } from "../utils/priceHistory";

// Referência fixa: 2026-03-31T12:00:00Z
const NOW_MS = new Date("2026-03-31T12:00:00Z").getTime();
const DAY_S = 24 * 60 * 60; // segundos por dia

// Gera um timestamp unix em segundos relativo a agora
function daysAgo(d: number): number {
  return Math.floor((NOW_MS - d * DAY_S * 1000) / 1000);
}

describe("calcTrend", () => {
  it("retorna null quando não há pontos suficientes na janela de 7 dias", () => {
    const history: [number, number][] = [
      [daysAgo(10), 500], // fora da janela
      [daysAgo(15), 480], // fora da janela
    ];
    expect(calcTrend(history, 7, NOW_MS)).toBeNull();
  });

  it("retorna null quando há apenas 1 ponto na janela", () => {
    const history: [number, number][] = [
      [daysAgo(3), 500],
      [daysAgo(10), 480],
    ];
    expect(calcTrend(history, 7, NOW_MS)).toBeNull();
  });

  it("detecta tendência de queda quando preço caiu mais de 3%", () => {
    const history: [number, number][] = [
      [daysAgo(6), 600],
      [daysAgo(3), 550],
      [daysAgo(1), 510], // queda de ~15% do primeiro ao último
    ];
    const result = calcTrend(history, 7, NOW_MS);
    expect(result).not.toBeNull();
    expect(result!.direction).toBe("down");
    expect(result!.pct).toBeLessThan(-3);
  });

  it("detecta tendência de alta quando preço subiu mais de 3%", () => {
    const history: [number, number][] = [
      [daysAgo(5), 400],
      [daysAgo(2), 430],
      [daysAgo(0), 450], // alta de ~12%
    ];
    const result = calcTrend(history, 7, NOW_MS);
    expect(result!.direction).toBe("up");
    expect(result!.pct).toBeGreaterThan(3);
  });

  it("detecta estabilidade quando variação é de ±3% ou menos", () => {
    const history: [number, number][] = [
      [daysAgo(6), 500],
      [daysAgo(3), 502],
      [daysAgo(1), 501], // variação de +0,2%
    ];
    const result = calcTrend(history, 7, NOW_MS);
    expect(result!.direction).toBe("stable");
    expect(Math.abs(result!.pct)).toBeLessThanOrEqual(3);
  });

  it("usa apenas pontos dentro da janela de dias especificada", () => {
    // fora da janela: preço baixo; dentro: preço alto → deve detectar alta
    const history: [number, number][] = [
      [daysAgo(20), 200], // fora → ignorado
      [daysAgo(5), 400],
      [daysAgo(1), 450],
    ];
    const result = calcTrend(history, 7, NOW_MS);
    expect(result!.direction).toBe("up");
  });

  it("retorna null quando firstPrice é zero (evita divisão por zero)", () => {
    const history: [number, number][] = [
      [daysAgo(5), 0],
      [daysAgo(1), 400],
    ];
    expect(calcTrend(history, 7, NOW_MS)).toBeNull();
  });

  it("calcula pct corretamente: queda exata de 15%", () => {
    const history: [number, number][] = [
      [daysAgo(6), 200],
      [daysAgo(1), 170], // (170-200)/200 = -15%
    ];
    const result = calcTrend(history, 7, NOW_MS);
    expect(result!.pct).toBe(-15);
  });

  it("ordena pontos por timestamp antes de calcular (mesmo fora de ordem no array)", () => {
    const history: [number, number][] = [
      [daysAgo(1), 170], // mais recente (último)
      [daysAgo(6), 200], // mais antigo (primeiro)
    ];
    const result = calcTrend(history, 7, NOW_MS);
    expect(result!.pct).toBe(-15); // primeiro=200, último=170
  });

  it("suporta janela customizada (ex: 3 dias)", () => {
    const history: [number, number][] = [
      [daysAgo(6), 100], // fora da janela de 3 dias → ignorado
      [daysAgo(2), 200],
      [daysAgo(1), 250], // alta de 25%
    ];
    const result = calcTrend(history, 3, NOW_MS);
    expect(result!.direction).toBe("up");
  });
});
