import { startWebhookServer } from "./services/webhook";

console.log("=".repeat(50));
console.log(`🤖 Webhook Bot iniciado em ${new Date().toISOString()}`);
console.log("=".repeat(50));

startWebhookServer();
