import { createClient, Client } from "@libsql/client";
import { config } from "../config";

let _client: Client | null = null;

export function getDb(): Client {
  if (!_client) {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;

    if (!url) {
      throw new Error("TURSO_DATABASE_URL is not defined in .env");
    }

    _client = createClient({
      url: url,
      authToken: authToken,
    });
  }
  return _client;
}

/**
 * Função auxiliar para garantir que as tabelas necessárias existam no Turso.
 * No Turso não usamos DatabaseSync, então usaremos o cliente assíncrono.
 */
export async function initTables(): Promise<void> {
  const db = getDb();
  
  // Tabela de Histórico (Migrada do node:sqlite)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS history (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp  TEXT    NOT NULL,
      origin     TEXT    NOT NULL,
      destination TEXT   NOT NULL,
      departureDate TEXT NOT NULL,
      returnDate TEXT,
      totalFound INTEGER NOT NULL,
      cheapestPriceBRL REAL,
      flights    TEXT    NOT NULL DEFAULT '[]'
    )
  `);

  // Tabela de Usuários (Nova para Multi-usuário)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      chat_id TEXT PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      is_authorized INTEGER DEFAULT 0,
      receives_news INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  try {
    await db.execute("ALTER TABLE users ADD COLUMN receives_news INTEGER DEFAULT 1");
  } catch (e) {
    // Ignora se a coluna já existir
  }

  // Tabela de Alertas (Nova para Multi-usuário)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      origin TEXT NOT NULL,
      destination TEXT NOT NULL,
      departure_date TEXT NOT NULL,
      return_date TEXT,
      trip_type TEXT DEFAULT 'one-way',
      max_price_brl REAL NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (chat_id) REFERENCES users(chat_id)
    )
  `);

  // Tabela para evitar duplicidade de notícias e ofertas
  await db.execute(`
    CREATE TABLE IF NOT EXISTS news_seen (
      guid TEXT PRIMARY KEY,
      tag TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
}
