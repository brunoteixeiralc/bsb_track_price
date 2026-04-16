// Define variáveis de ambiente necessárias para os testes
process.env.TURSO_DATABASE_URL = "libsql://test-db.turso.io";
process.env.TURSO_AUTH_TOKEN = "test-token";

// Mock global do Cliente do Turso para evitar conexões reais
jest.mock("@libsql/client", () => ({
  createClient: jest.fn().mockReturnValue({
    execute: jest.fn().mockImplementation(async (stmt) => {
      const sql = typeof stmt === "string" ? stmt : stmt.sql;
      
      // Se for uma query de contagem, retorna 0
      if (sql.toUpperCase().includes("COUNT(*)")) {
        return { 
          rows: [{ n: 0, count: 0 }], 
          rowsAffected: 0 
        };
      }
      
      // Para qualquer outra busca (SELECT *), retorna vazio
      return { 
        rows: [], 
        rowsAffected: 0 
      };
    }),
    batch: jest.fn().mockResolvedValue([]),
    close: jest.fn(),
  }),
}));
