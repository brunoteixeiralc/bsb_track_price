import fs from "fs";
import path from "path";
import { HistoryEntry } from "../types";

const HISTORY_FILE = path.resolve(process.cwd(), "data", "history.json");

export function loadHistory(): HistoryEntry[] {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8"));
}

export function appendHistory(entry: HistoryEntry): void {
  const history = loadHistory();
  history.push(entry);
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  console.log(`[history] ${history.length} entrada(s) no histórico.`);
}
