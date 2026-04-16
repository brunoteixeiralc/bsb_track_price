// Define variáveis de ambiente necessárias para os testes
process.env.TURSO_DATABASE_URL = "libsql://test-db.turso.io";
process.env.TURSO_AUTH_TOKEN = "test-token";

// Mock global do Cliente do Turso para evitar conexões reais
jest.mock("@libsql/client", () => ({
  createClient: jest.fn().mockReturnValue({
    execute: jest.fn().mockResolvedValue({ 
      rows: [{ n: 0, count: 0 }], // Retorna uma linha padrão para COUNT(*)
      rowsAffected: 0 
    }),
    batch: jest.fn().mockResolvedValue([]),
    close: jest.fn(),
  }),
}));
