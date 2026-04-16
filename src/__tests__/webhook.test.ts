import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import { handleUpdate } from "../services/webhook";
import * as userService from "../services/user";

jest.mock("../config", () => ({
  config: {
    telegram: {
      botToken: "test-token",
      chatId: "123456789", // ID do administrador REAL (número em string)
    },
    search: {
      origin: "BSB"
    }
  },
}));

jest.mock("../services/user");
jest.mock("../services/history");
jest.mock("../services/db", () => ({
  getDb: jest.fn().mockReturnValue({
    execute: jest.fn().mockResolvedValue({ rows: [{ n: 0 }], rowsAffected: 1 }),
    close: jest.fn()
  }),
  initTables: jest.fn().mockResolvedValue(undefined)
}));

const mock = new MockAdapter(axios);

beforeEach(() => {
  mock.reset();
  jest.clearAllMocks();
});

describe("Webhook Multi-usuário", () => {
  const adminChatId = 123456789;
  const userChatId = 987654321;

  describe("handleUpdate - Permissões", () => {
    it("autoriza automaticamente o administrador no /start", async () => {
      mock.onPost(/sendMessage/).reply(200, { ok: true });
      
      await handleUpdate({
        update_id: 1,
        message: {
          message_id: 1,
          chat: { id: adminChatId, type: "private" },
          text: "/start",
          from: { id: adminChatId, first_name: "Admin" }
        }
      });

      const body = JSON.parse(mock.history.post[0].data);
      expect(body.text).toContain("Administrador");
      expect(body.text).not.toContain("pendente");
    });

    it("pede autorização para novos usuários no /start", async () => {
      mock.onPost(/sendMessage/).reply(200, { ok: true });
      (userService.isUserAuthorized as jest.Mock).mockResolvedValue(false);

      await handleUpdate({
        update_id: 2,
        message: {
          message_id: 2,
          chat: { id: userChatId, type: "private" },
          text: "/start",
          from: { id: userChatId, first_name: "Visitante" }
        }
      });

      const body = JSON.parse(mock.history.post[0].data);
      expect(body.text).toContain("pendente");
    });
  });

  describe("Comandos de Alerta", () => {
    it("permite criar alerta quando autorizado", async () => {
      mock.onPost(/sendMessage/).reply(200, { ok: true });
      (userService.isUserAuthorized as jest.Mock).mockResolvedValue(true);

      await handleUpdate({
        update_id: 3,
        message: {
          message_id: 3,
          chat: { id: userChatId, type: "private" },
          text: "/alerta BSB GRU 20/12/2026 500",
          from: { id: userChatId, first_name: "User" }
        }
      });

      expect(userService.addAlert).toHaveBeenCalledWith(expect.objectContaining({
        origin: "BSB",
        destination: "GRU",
        max_price_brl: 500
      }));
      
      const body = JSON.parse(mock.history.post[0].data);
      expect(body.text).toContain("Alerta criado");
    });

    it("permite editar preço de um alerta existente", async () => {
      mock.onPost(/sendMessage/).reply(200, { ok: true });
      (userService.isUserAuthorized as jest.Mock).mockResolvedValue(true);
      (userService.updateAlertPrice as jest.Mock).mockResolvedValue(true);

      await handleUpdate({
        update_id: 4,
        message: {
          message_id: 4,
          chat: { id: userChatId, type: "private" },
          text: "/editar 5 600",
          from: { id: userChatId, first_name: "User" }
        }
      });

      expect(userService.updateAlertPrice).toHaveBeenCalledWith("987654321", 5, 600);
      const body = JSON.parse(mock.history.post[0].data);
      expect(body.text).toContain("atualizado para R$ 600");
    });

    it("permite remover um alerta existente", async () => {
      mock.onPost(/sendMessage/).reply(200, { ok: true });
      (userService.isUserAuthorized as jest.Mock).mockResolvedValue(true);
      (userService.removeAlert as jest.Mock).mockResolvedValue(true);

      await handleUpdate({
        update_id: 5,
        message: {
          message_id: 5,
          chat: { id: userChatId, type: "private" },
          text: "/remover 10",
          from: { id: userChatId, first_name: "User" }
        }
      });

      expect(userService.removeAlert).toHaveBeenCalledWith("987654321", 10);
      const body = JSON.parse(mock.history.post[0].data);
      expect(body.text).toContain("removido com sucesso");
    });
  });
});
