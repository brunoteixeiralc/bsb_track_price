import fs from "fs";
import path from "path";

const TMP_DIR = path.resolve(__dirname, "../../.tmp-test-health");
const TMP_FILE = path.join(TMP_DIR, "health.json");

jest.mock("path", () => {
  const actual = jest.requireActual("path");
  return {
    ...actual,
    resolve: (...args: string[]) => {
      const result = actual.resolve(...args);
      if (result.endsWith(actual.join("data", "health.json"))) return TMP_FILE;
      return result;
    },
  };
});

const mockSendHealthCheck = jest.fn();
jest.mock("../services/telegram", () => ({
  sendHealthCheck: (...args: unknown[]) => mockSendHealthCheck(...args),
}));

beforeEach(() => {
  if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true });
  jest.clearAllMocks();
  mockSendHealthCheck.mockResolvedValue(undefined);
});

afterAll(() => {
  if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true });
});

describe("maybeHealthCheck", () => {
  it("envia health check e cria o arquivo se não existe", async () => {
    const { maybeHealthCheck } = await import("../services/healthCheck");
    await maybeHealthCheck();

    expect(mockSendHealthCheck).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(TMP_FILE)).toBe(true);
  });

  it("salva a data de hoje no arquivo", async () => {
    const { maybeHealthCheck } = await import("../services/healthCheck");
    await maybeHealthCheck();

    const data = JSON.parse(fs.readFileSync(TMP_FILE, "utf-8"));
    const today = new Date().toISOString().split("T")[0];
    expect(data.lastCheck).toBe(today);
  });

  it("não envia se já foi enviado hoje", async () => {
    const today = new Date().toISOString().split("T")[0];
    fs.mkdirSync(TMP_DIR, { recursive: true });
    fs.writeFileSync(TMP_FILE, JSON.stringify({ lastCheck: today }));

    const { maybeHealthCheck } = await import("../services/healthCheck");
    await maybeHealthCheck();

    expect(mockSendHealthCheck).not.toHaveBeenCalled();
  });

  it("envia se o lastCheck foi ontem", async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    fs.mkdirSync(TMP_DIR, { recursive: true });
    fs.writeFileSync(TMP_FILE, JSON.stringify({ lastCheck: yesterday }));

    const { maybeHealthCheck } = await import("../services/healthCheck");
    await maybeHealthCheck();

    expect(mockSendHealthCheck).toHaveBeenCalledTimes(1);
  });

  it("envia se o arquivo existe mas não tem campo lastCheck", async () => {
    fs.mkdirSync(TMP_DIR, { recursive: true });
    fs.writeFileSync(TMP_FILE, JSON.stringify({})); // sem lastCheck

    const { maybeHealthCheck } = await import("../services/healthCheck");
    await maybeHealthCheck();

    expect(mockSendHealthCheck).toHaveBeenCalledTimes(1);
  });
});
