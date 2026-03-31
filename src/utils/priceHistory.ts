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
