import { startWebhookServer } from "./services/webhook";

async function main(): Promise<void> {
  console.log("=".repeat(50));
  console.log(`🤖 Webhook Bot iniciado em ${new Date().toISOString()}`);
  console.log("=".repeat(50));

  const { initTables } = await import("./services/db");
  await initTables();

  startWebhookServer();
}

main().catch(console.error);
