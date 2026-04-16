import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import { handleUpdate, sendReply } from "../services/webhook";
import * as userService from "../services/user";

jest.mock("../config", () => ({
  config: {
    telegram: {
      botToken: "test-token",
      chatId: "ADMIN_ID", // ID do administrador
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
    execute: jest.fn().mockResolvedValue({ rows: [], rowsAffected: 1 })
  })
}));

const mock = new MockAdapter(axios);

beforeEach(() => {
  mock.reset();
  jest.clearAllMocks();
});

describe("Webhook Multi-usuário", () => {
  const adminChatId = "ADMIN_ID";
  const userChatId = "USER_123";

  describe("handleUpdate - Permissões", () => {
    it("autoriza automaticamente o administrador no /start", async () => {
      mock.onPost(/sendMessage/).reply(200, { ok: true });
      
      await handleUpdate({
        update_id: 1,
        message: {
          message_id: 1,
          chat: { id: parseInt(adminChatId), type: "private" },
          text: "/start",
          from: { id: parseInt(adminChatId), first_name: "Admin" }
        }
      });

      // Deve ter enviado mensagem de boas vindas ao admin
      const body = JSON.parse(mock.history.post[0].data);
      expect(body.text).toContain("Olá, Administrador");
    });

    it("pede autorização para novos usuários no /start", async () => {
      mock.onPost(/sendMessage/).reply(200, { ok: true });
      (userService.isUserAuthorized as jest.Mock).mockResolvedValue(false);

      await handleUpdate({
        update_id: 2,
        message: {
          message_id: 2,
          chat: { id: parseInt(userChatId), type: "private" },
          text: "/start",
          from: { id: parseInt(userChatId), first_name: "Visitante" }
        }
      });

      const body = JSON.parse(mock.history.post[0].data);
      expect(body.text).toContain("acesso está pendente");
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
          chat: { id: parseInt(userChatId), type: "private" },
          text: "/alerta BSB GRU 20/12/2026 500",
          from: { id: parseInt(userChatId), first_name: "User" }
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
  });
});
