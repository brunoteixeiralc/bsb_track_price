import fs from "fs";
import path from "path";
import { sendHealthCheck } from "./telegram";

const HEALTH_FILE = path.resolve(process.cwd(), "data", "health.json");

export async function maybeHealthCheck(): Promise<void> {
  const today = new Date().toISOString().split("T")[0];

  let lastCheck = "";
  if (fs.existsSync(HEALTH_FILE)) {
    lastCheck = JSON.parse(fs.readFileSync(HEALTH_FILE, "utf-8")).lastCheck ?? "";
  }

  if (lastCheck === today) {
    console.log("[health] Health check já enviado hoje.");
    return;
  }

  await sendHealthCheck();
  fs.mkdirSync(path.dirname(HEALTH_FILE), { recursive: true });
  fs.writeFileSync(HEALTH_FILE, JSON.stringify({ lastCheck: today }, null, 2));
}
