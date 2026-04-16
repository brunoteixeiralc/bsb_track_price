import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import { handleUpdate } from "../services/webhook";
import * as userService from "../services/user";

// Mock do Config
jest.mock("../config", () => ({
  config: {
    telegram: {
      botToken: "test-token",
      chatId: "123456789", 
    },
    search: {
      origin: "BSB"
    }
  },
}));

// Mock dos Serviços
jest.mock("../services/user", () => ({
  isUserAuthorized: jest.fn(),
  saveUser: jest.fn(),
  addAlert: jest.fn(),
  listUserAlerts: jest.fn(),
  removeAlert: jest.fn(),
  updateAlertPrice: jest.fn(),
}));

jest.mock("../services/history", () => ({
  loadHistory: jest.fn().mockReturnValue([])
}));

jest.mock("../services/db", () => ({
  getDb: jest.fn().mockReturnValue({
    execute: jest.fn().mockResolvedValue({ rows: [], rowsAffected: 1 }),
    close: jest.fn()
  }),
  initTables: jest.fn().mockResolvedValue(undefined)
}));

const mock = new MockAdapter(axios);

describe("Webhook Multi-usuário", () => {
  const adminChatId = 123456789;
  const userChatId = 987654321;

  beforeEach(() => {
    mock.reset();
    jest.clearAllMocks();
  });

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
      (userService.addAlert as jest.Mock).mockResolvedValue(123);

      await handleUpdate({
        update_id: 3,
        message: {
          message_id: 3,
          chat: { id: userChatId, type: "private" },
          text: "/alerta BSB GRU 20/12/2026 500",
          from: { id: userChatId, first_name: "User" }
        }
      });

      expect(userService.addAlert).toHaveBeenCalled();
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

      expect(userService.updateAlertPrice).toHaveBeenCalledWith(String(userChatId), 5, 600);
      const body = JSON.parse(mock.history.post[0].data);
      expect(body.text).toContain("atualizado para");
      expect(body.text).toContain("600");
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

      expect(userService.removeAlert).toHaveBeenCalledWith(String(userChatId), 10);
      const body = JSON.parse(mock.history.post[0].data);
      expect(body.text).toContain("removido com sucesso");
    });
  });
});
