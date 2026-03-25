import { runTracker } from "./services/tracker";
import { maybeHealthCheck } from "./services/healthCheck";

async function main(): Promise<void> {
  console.log("=".repeat(50));
  console.log(`🛫 Flight Tracker iniciado em ${new Date().toISOString()}`);
  console.log("=".repeat(50));

  try {
    await runTracker();
    await maybeHealthCheck();
    console.log("✅ Execução concluída com sucesso.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Erro fatal:", err);
    process.exit(1);
  }
}

main();
