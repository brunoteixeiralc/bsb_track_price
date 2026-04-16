/**
 * Smoke test da integração Claude API → resumo de artigo.
 * Pega o primeiro item do feed de notícias, busca o artigo completo,
 * gera o resumo com Claude Haiku 4.5 e loga o resultado.
 * Se TELEGRAM_BOT_TOKEN estiver definido, envia o resultado ao Telegram.
 *
 * Uso: npx ts-node src/scripts/test-summarize.ts
 */
import axios from "axios";
import {
  parseRssItems,
  fetchArticleText,
  summarizeArticle,
  shouldSummarize,
} from "../services/news";

const RSS_URL = "https://passageirodeprimeira.com/categorias/noticias/feed/";
const TIMEOUT_MS = 15_000;

async function sendTelegram(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log("ℹ️  TELEGRAM_BOT_TOKEN não definido — pulando envio ao Telegram.");
    return;
  }
  await axios.post(
    `https://api.telegram.org/bot${token}/sendMessage`,
    { chat_id: chatId, text, parse_mode: "Markdown", disable_web_page_preview: true },
    { timeout: TIMEOUT_MS }
  );
  console.log("📨 Resultado enviado ao Telegram.");
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ ANTHROPIC_API_KEY não definida. Abortando.");
    process.exit(1);
  }

  // ── 1. Buscar RSS ───────────────────────────────────────────────────────────
  console.log(`\n🔍 Buscando RSS: ${RSS_URL}`);
  const res = await axios.get<string>(RSS_URL, {
    timeout: TIMEOUT_MS,
    headers: { Accept: "application/rss+xml, application/xml" },
  });
  const items = parseRssItems(res.data);

  if (items.length === 0) {
    console.error("❌ Nenhum item encontrado no feed.");
    process.exit(1);
  }

  const item = items[0];
  console.log(`\n📰 Item selecionado: ${item.title}`);
  console.log(`🔗 Link:             ${item.link}`);
  console.log(`📝 Descrição RSS:    ${item.description.slice(0, 150).replace(/\n/g, " ")}${item.description.length > 150 ? "…" : ""}`);
  console.log(`🤔 shouldSummarize:  ${shouldSummarize(item)} (resumo forçado para teste)`);

  // ── 2. Buscar artigo completo ───────────────────────────────────────────────
  console.log(`\n📄 Buscando artigo completo...`);
  const articleText = await fetchArticleText(item.link);
  console.log(`✅ Texto extraído:   ${articleText.slice(0, 200).replace(/\n/g, " ")}…`);
  console.log(`   (${articleText.split(/\s+/).length} palavras)`);

  // ── 3. Chamar Claude Haiku 4.5 ──────────────────────────────────────────────
  console.log(`\n🤖 Chamando Claude Haiku 4.5...`);
  const t0 = Date.now();
  const summary = await summarizeArticle(item.title, articleText);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  if (!summary) {
    console.error("❌ Resumo não foi gerado (API retornou null).");
    process.exit(1);
  }

  console.log(`\n✅ Resumo gerado em ${elapsed}s:`);
  console.log("─".repeat(60));
  console.log(summary);
  console.log("─".repeat(60));

  // ── 4. Enviar ao Telegram ───────────────────────────────────────────────────
  const telegramMsg = [
    `🧪 *Teste de Resumo — Claude Haiku 4.5*`,
    ``,
    `📰 *${item.title}*`,
    `🔗 [Ver artigo](${item.link})`,
    ``,
    `📝 *Resumo gerado em ${elapsed}s:*`,
    summary,
    ``,
    `✅ API funcionando corretamente`,
  ].join("\n");

  await sendTelegram(telegramMsg);
  console.log("\n🎉 Teste concluído com sucesso.");
}

main().catch((err: Error) => {
  console.error(`\n❌ Erro fatal: ${err.message}`);
  process.exit(1);
});
