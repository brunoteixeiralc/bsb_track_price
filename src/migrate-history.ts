/**
 * Script de migração: importa data/history.json → data/history.db (Turso)
 *
 * Execute uma única vez após o deploy da feature de SQLite:
 *   npx ts-node src/migrate-history.ts
 */
import fs from "fs";
import path from "path";
import { appendHistory, loadHistory } from "./services/history";
import { HistoryEntry } from "./types";
import { initTables } from "./services/db";

const JSON_FILE = path.resolve(process.cwd(), "data", "history.json");

async function main(): Promise<void> {
  // Inicializa tabelas no Turso antes de tudo
  await initTables();

  if (!fs.existsSync(JSON_FILE)) {
    console.log("[migrate] history.json não encontrado. Nada a migrar.");
    return;
  }

  const raw: HistoryEntry[] = JSON.parse(fs.readFileSync(JSON_FILE, "utf-8"));

  if (raw.length === 0) {
    console.log("[migrate] history.json está vazio. Nada a migrar.");
    return;
  }

  const existing = await loadHistory();
  if (existing.length > 0) {
    console.log(
      `[migrate] Banco já possui ${existing.length} entrada(s). Migração ignorada para evitar duplicatas.`
    );
    return;
  }

  console.log(`[migrate] Migrando ${raw.length} entrada(s) de history.json para o Banco na Nuvem…`);
  for (const entry of raw) {
    await appendHistory(entry);
  }

  const after = await loadHistory();
  console.log(`[migrate] ✅ Migração concluída. ${after.length} entrada(s) no banco.`);
}

main().catch((err) => {
  console.error("[migrate] ❌ Erro:", err);
  process.exit(1);
});
