export interface TrendResult {
  direction: "up" | "down" | "stable";
  pct: number; // variação percentual do primeiro ao último ponto (positivo = alta)
}

/**
 * Calcula a tendência de preço a partir do histórico dos últimos `days` dias.
 *
 * @param history  Array de [timestamp_unix_segundos, preço] vindo do Apify price_history
 * @param days     Janela de análise em dias (padrão: 7)
 * @param nowMs    Timestamp atual em milissegundos (injetável para testes)
 * @returns TrendResult ou null se não houver dados suficientes na janela
 */
export function calcTrend(
  history: [number, number][],
  days = 7,
  nowMs: number = Date.now()
): TrendResult | null {
  const cutoffMs = nowMs - days * 24 * 60 * 60 * 1000;

  // timestamps do Apify estão em segundos → converter para ms na comparação
  const window = history
    .filter(([ts]) => ts * 1000 >= cutoffMs)
    .sort((a, b) => a[0] - b[0]);

  if (window.length < 2) return null;

  const firstPrice = window[0][1];
  const lastPrice = window[window.length - 1][1];

  if (firstPrice === 0) return null;

  const pct = Math.round(((lastPrice - firstPrice) / firstPrice) * 100);

  const direction: TrendResult["direction"] =
    pct > 3 ? "up" : pct < -3 ? "down" : "stable";

  return { direction, pct };
}

const PT_DAYS = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];

export interface BestDayResult {
  dayIndex: number; // 0 = domingo … 6 = sábado
  dayName: string;  // em português
  avgPrice: number; // preço médio (mesma unidade que o histórico)
}

/**
 * Retorna o dia da semana com menor preço médio histórico.
 *
 * Usa todo o histórico disponível (sem janela de dias) para maximizar
 * a quantidade de amostras por dia.
 * Requer pelo menos 2 dias da semana distintos representados nos dados.
 *
 * @param history  Array de [timestamp_unix_segundos, preço]
 * @returns BestDayResult ou null se não houver dados suficientes
 */
export function bestDayOfWeek(history: [number, number][]): BestDayResult | null {
  if (history.length < 2) return null;

  // Agrupa preços por dia da semana (UTC)
  const groups = new Map<number, number[]>();
  for (const [ts, price] of history) {
    const dayIndex = new Date(ts * 1000).getUTCDay();
    if (!groups.has(dayIndex)) groups.set(dayIndex, []);
    groups.get(dayIndex)!.push(price);
  }

  // Precisa de pelo menos 2 dias distintos para ter comparação significativa
  if (groups.size < 2) return null;

  let bestDay = -1;
  let bestAvg = Infinity;

  for (const [day, prices] of groups) {
    const avg = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    if (avg < bestAvg) {
      bestAvg = avg;
      bestDay = day;
    }
  }

  return {
    dayIndex: bestDay,
    dayName: PT_DAYS[bestDay],
    avgPrice: Math.round(bestAvg),
  };
}
