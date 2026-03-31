import { calcTrend, bestDayOfWeek } from "../utils/priceHistory";

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

  it("suporta janela customizada (ex: 3 dias, referência: 30 dias)", () => {
    const history: [number, number][] = [
      [daysAgo(6), 100], // fora da janela de 3 dias → ignorado
      [daysAgo(2), 200],
      [daysAgo(1), 250], // alta de 25%
    ];
    const result = calcTrend(history, 3, NOW_MS);
    expect(result!.direction).toBe("up");
  });
});

// ─── Helpers para bestDayOfWeek ──────────────────────────────────────────────
// 2026-03-31 é terça-feira (UTC dayIndex = 2)
// Gera timestamp para um dia específico da semana relativo a uma segunda referência
// Usamos datas absolutas para controle total sobre o dayIndex UTC

/** Retorna timestamp unix (segundos) para uma data UTC específica */
function tsFor(isoDate: string): number {
  return Math.floor(new Date(isoDate).getTime() / 1000);
}

// Dias conhecidos:
// 2026-03-23 = segunda-feira (1)
// 2026-03-24 = terça-feira  (2)
// 2026-03-25 = quarta-feira (3)
// 2026-03-26 = quinta-feira (4)
// 2026-03-27 = sexta-feira  (5)
// 2026-03-28 = sábado       (6)
// 2026-03-29 = domingo      (0)

describe("bestDayOfWeek", () => {
  it("retorna null quando há menos de 2 pontos no histórico", () => {
    expect(bestDayOfWeek([[tsFor("2026-03-23"), 400]])).toBeNull();
  });

  it("retorna null quando todos os pontos caem no mesmo dia da semana", () => {
    // três segundas-feiras
    const history: [number, number][] = [
      [tsFor("2026-03-23"), 400], // segunda
      [tsFor("2026-03-16"), 380], // segunda
      [tsFor("2026-03-09"), 420], // segunda
    ];
    expect(bestDayOfWeek(history)).toBeNull();
  });

  it("identifica o dia com menor preço médio", () => {
    const history: [number, number][] = [
      [tsFor("2026-03-23"), 500], // segunda  → média 500
      [tsFor("2026-03-25"), 300], // quarta   → média 300 ← melhor
      [tsFor("2026-03-27"), 450], // sexta    → média 450
    ];
    const result = bestDayOfWeek(history);
    expect(result).not.toBeNull();
    expect(result!.dayIndex).toBe(3); // quarta-feira
    expect(result!.dayName).toBe("quarta-feira");
  });

  it("calcula média corretamente quando há múltiplos pontos no mesmo dia", () => {
    // quarta com dois valores: 200 e 400 → média 300
    // segunda com um valor: 350 → média 350
    // quarta deve ganhar
    const history: [number, number][] = [
      [tsFor("2026-03-25"), 200], // quarta
      [tsFor("2026-03-18"), 400], // quarta
      [tsFor("2026-03-23"), 350], // segunda
    ];
    const result = bestDayOfWeek(history);
    expect(result!.dayIndex).toBe(3); // quarta-feira
    expect(result!.avgPrice).toBe(300);
  });

  it("retorna o avgPrice arredondado", () => {
    const history: [number, number][] = [
      [tsFor("2026-03-23"), 100], // segunda
      [tsFor("2026-03-24"), 101], // terça
      [tsFor("2026-03-16"), 102], // segunda → média segunda = (100+102)/2 = 101
    ];
    const result = bestDayOfWeek(history);
    // terça tem média 101, segunda tem 101 — empate; vence o primeiro encontrado
    expect(result!.avgPrice).toBe(101);
  });

  it("retorna nome do dia em português", () => {
    const history: [number, number][] = [
      [tsFor("2026-03-29"), 200], // domingo (0)
      [tsFor("2026-03-28"), 500], // sábado  (6)
    ];
    const result = bestDayOfWeek(history);
    expect(result!.dayName).toBe("domingo");
  });

  it("usa todo o histórico (sem janela de dias)", () => {
    // ponto de 6 meses atrás deve ser incluído
    const oldMonday = tsFor("2025-09-01"); // segunda-feira
    const history: [number, number][] = [
      [oldMonday, 200],              // segunda antiga → preço baixo
      [tsFor("2026-03-25"), 500],    // quarta recente → preço alto
    ];
    const result = bestDayOfWeek(history);
    expect(result!.dayIndex).toBe(1); // segunda
  });
});

