import { startWebhookServer } from "./services/webhook";

async function main(): Promise<void> {
  console.log("=".repeat(50));
  console.log(`🤖 Webhook Bot iniciado em ${new Date().toISOString()}`);
  console.log("=".repeat(50));

  // Inicia o servidor ANTES de conectar ao banco — Railway já começa a rotear
  startWebhookServer();

  // Tenta inicializar as tabelas do Turso (não bloqueia o servidor)
  try {
    const { initTables } = await import("./services/db");
    await initTables();
    console.log("[webhook] Banco de dados inicializado com sucesso.");
  } catch (err) {
    console.error("[webhook] ⚠️ Falha ao inicializar banco de dados:", err instanceof Error ? err.message : err);
    console.error("[webhook] Bot rodando sem banco — comandos que dependem de DB irão falhar.");
  }
}

main().catch(console.error);
