import { getWeeklySummary } from "./history";
import { sendWeeklyReport } from "./telegram";

export function isSunday(date: Date = new Date()): boolean {
  return date.getDay() === 0;
}

export async function runWeeklyReport(): Promise<void> {
  console.log("[weeklyReport] Gerando relatório semanal...");
  const summaries = getWeeklySummary();
  console.log(`[weeklyReport] ${summaries.length} rota(s) encontrada(s) no histórico.`);
  await sendWeeklyReport(summaries);
  console.log("[weeklyReport] Relatório semanal concluído.");
}
