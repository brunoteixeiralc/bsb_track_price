import { getDb } from "./db";

export interface User {
  chat_id: string;
  username?: string;
  first_name?: string;
  is_authorized: boolean;
}

export interface UserAlert {
  id?: number;
  chat_id: string;
  origin: string;
  destination: string;
  departure_date: string;
  return_date?: string;
  trip_type: string;
  max_price_brl: number;
  is_active: boolean;
}

/** Salva ou atualiza um usuário no banco */
export async function saveUser(chatId: string, firstName?: string, username?: string): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO users (chat_id, first_name, username) 
          VALUES (?, ?, ?)
          ON CONFLICT(chat_id) DO UPDATE SET 
            first_name = excluded.first_name,
            username = excluded.username`,
    args: [chatId, firstName ?? null, username ?? null],
  });
}

/** Verifica se um usuário está autorizado */
export async function isUserAuthorized(chatId: string): Promise<boolean> {
  const db = getDb();
  const result = await db.execute({
    sql: "SELECT is_authorized FROM users WHERE chat_id = ?",
    args: [chatId],
  });
  const row = result.rows[0];
  return row ? Boolean(row.is_authorized) : false;
}

/** Adiciona um novo alerta de viagem */
export async function addAlert(alert: UserAlert): Promise<number> {
  const db = getDb();
  const result = await db.execute({
    sql: `INSERT INTO alerts 
          (chat_id, origin, destination, departure_date, return_date, trip_type, max_price_brl)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      alert.chat_id,
      alert.origin.toUpperCase(),
      alert.destination.toUpperCase(),
      alert.departure_date,
      alert.return_date ?? null,
      alert.trip_type,
      alert.max_price_brl
    ],
  });
  return Number(result.lastInsertRowid);
}

/** Lista alertas ativos de um usuário */
export async function listUserAlerts(chatId: string): Promise<UserAlert[]> {
  const db = getDb();
  const result = await db.execute({
    sql: "SELECT * FROM alerts WHERE chat_id = ? AND is_active = 1",
    args: [chatId],
  });
  return result.rows.map(row => ({
    id: Number(row.id),
    chat_id: String(row.chat_id),
    origin: String(row.origin),
    destination: String(row.destination),
    departure_date: String(row.departure_date),
    return_date: row.return_date ? String(row.return_date) : undefined,
    trip_type: String(row.trip_type),
    max_price_brl: Number(row.max_price_brl),
    is_active: Boolean(row.is_active),
  }));
}

/** Remove (desativa) um alerta */
export async function removeAlert(chatId: string, alertId: number): Promise<boolean> {
  const db = getDb();
  const result = await db.execute({
    sql: "DELETE FROM alerts WHERE id = ? AND chat_id = ?",
    args: [alertId, chatId],
  });
  return Number(result.rowsAffected) > 0;
}

/** Atualiza o preço máximo de um alerta */
export async function updateAlertPrice(chatId: string, alertId: number, newPrice: number): Promise<boolean> {
  const db = getDb();
  const result = await db.execute({
    sql: "UPDATE alerts SET max_price_brl = ? WHERE id = ? AND chat_id = ?",
    args: [newPrice, alertId, chatId],
  });
  return Number(result.rowsAffected) > 0;
}

/** Busca todos os alertas ativos de todos os usuários (usado pelo Tracker) */
export async function getAllActiveAlerts(): Promise<UserAlert[]> {
  const db = getDb();
  // Só busca alertas de usuários autorizados
  const result = await db.execute(`
    SELECT a.* FROM alerts a
    JOIN users u ON a.chat_id = u.chat_id
    WHERE a.is_active = 1 AND u.is_authorized = 1
  `);
  return result.rows.map(row => ({
    id: Number(row.id),
    chat_id: String(row.chat_id),
    origin: String(row.origin),
    destination: String(row.destination),
    departure_date: String(row.departure_date),
    return_date: row.return_date ? String(row.return_date) : undefined,
    trip_type: String(row.trip_type),
    max_price_brl: Number(row.max_price_brl),
    is_active: Boolean(row.is_active),
  }));
}
