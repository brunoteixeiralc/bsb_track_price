import { maybeHealthCheck } from "./services/healthCheck";
import { runWeeklyReport, isSunday } from "./services/weeklyReport";
import { initTables } from "./services/db";

async function main(): Promise<void> {
  console.log("=".repeat(50));
  console.log(`🛫 Flight Tracker iniciado em ${new Date().toISOString()}`);
  console.log("=".repeat(50));

  try {
    // 1. Garante que o banco está pronto
    await initTables();

    // 2. Roda o rastreador de voos (Passageiros e Alertas Globais)
    const { runTracker } = await import("./services/tracker");
    await runTracker();

    // 3. Roda o rastreador de notícias e promoções (Turso Cloud)
    const { runNewsTracker } = await import("./services/news");
    await runNewsTracker();

    // 4. Relatório semanal se for domingo
    if (isSunday()) {
      console.log("[main] Domingo detectado — executando relatório semanal.");
      await runWeeklyReport();
    }

    // 5. Check-in de saúde do bot
    await maybeHealthCheck();
    
    console.log("✅ Execução concluída com sucesso.");
    process.exit(0);
  } catch (err) {
    console.error(`❌ Erro fatal: ${(err as Error).message ?? String(err)}`);
    process.exit(1);
  }
}

main();
