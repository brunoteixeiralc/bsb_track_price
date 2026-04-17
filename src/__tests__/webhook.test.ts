import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import { handleUpdate } from "../services/webhook";
import * as userService from "../services/user";

// ── Mocks ─────────────────────────────────────────────────────────────────

jest.mock("../config", () => ({
  config: {
    telegram: { botToken: "test-token", chatId: "123456789" },
    search:   { origin: "BSB" },
  },
}));

jest.mock("../services/user", () => ({
  isUserAuthorized: jest.fn(),
  saveUser:         jest.fn(),
  getUserInfo:      jest.fn(),
  authorizeUser:    jest.fn(),
  rejectUser:       jest.fn(),
  addAlert:         jest.fn(),
  listUserAlerts:   jest.fn(),
  removeAlert:      jest.fn(),
  updateAlertPrice: jest.fn(),
}));

jest.mock("../services/history", () => ({
  loadHistory: jest.fn().mockReturnValue([]),
}));

jest.mock("../services/db", () => ({
  getDb: jest.fn().mockReturnValue({
    execute: jest.fn().mockResolvedValue({ rows: [], rowsAffected: 1 }),
    close:   jest.fn(),
  }),
  initTables: jest.fn().mockResolvedValue(undefined),
}));

// ── Setup ──────────────────────────────────────────────────────────────────

const mock = new MockAdapter(axios);

const ADMIN_ID = 123456789;
const USER_ID  = 987654321;

// Helpers para construir updates Telegram
const msgUpdate = (
  chatId: number,
  text: string,
  firstName = "User",
  username?: string
) => ({
  update_id: 1,
  message: {
    message_id: 1,
    chat: { id: chatId, type: "private" },
    text,
    from: { id: chatId, first_name: firstName, username },
  },
});

const callbackUpdate = (
  fromId: number,
  msgChatId: number,
  messageId: number,
  data: string
) => ({
  update_id: 2,
  callback_query: {
    id: "cq-id-1",
    from: { id: fromId, first_name: "Admin" },
    message: { message_id: messageId, chat: { id: msgChatId } },
    data,
  },
});

beforeEach(() => {
  mock.reset();
  jest.clearAllMocks();
  // Defaults seguros: sem estado no banco
  (userService.getUserInfo      as jest.Mock).mockResolvedValue(null);
  (userService.isUserAuthorized as jest.Mock).mockResolvedValue(false);
  (userService.saveUser         as jest.Mock).mockResolvedValue(undefined);
  (userService.authorizeUser    as jest.Mock).mockResolvedValue(undefined);
  (userService.rejectUser       as jest.Mock).mockResolvedValue(undefined);
});

// ── Chat privado apenas ────────────────────────────────────────────────────

describe("Mensagens de grupo são ignoradas", () => {
  it("não responde a mensagens vindas de grupos", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    await handleUpdate({
      update_id: 99,
      message: {
        message_id: 1,
        chat: { id: -100123456, type: "group" },
        text: "/start",
        from: { id: USER_ID, first_name: "João" },
      },
    });

    expect(mock.history.post).toHaveLength(0);
  });

  it("não responde a mensagens de supergrupos", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });

    await handleUpdate({
      update_id: 100,
      message: {
        message_id: 2,
        chat: { id: -100999999, type: "supergroup" },
        text: "/alerta BSB GRU 01/01/2027 400",
        from: { id: USER_ID, first_name: "João" },
      },
    });

    expect(mock.history.post).toHaveLength(0);
  });
});

// ── /start ─────────────────────────────────────────────────────────────────

describe("/start", () => {
  it("autoriza o admin automaticamente e não notifica ninguém", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true, result: { message_id: 10 } });
    (userService.getUserInfo as jest.Mock).mockResolvedValue({
      chat_id: String(ADMIN_ID), is_authorized: 1,
    });

    await handleUpdate(msgUpdate(ADMIN_ID, "/start", "Admin"));

    // Apenas uma mensagem enviada: boas-vindas ao admin
    expect(mock.history.post).toHaveLength(1);
    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("Administrador");
  });

  it("notifica o admin com botões inline quando usuário é novo", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true, result: { message_id: 11 } });
    // getUserInfo retorna null → usuário novo
    (userService.getUserInfo as jest.Mock).mockResolvedValue(null);

    await handleUpdate(msgUpdate(USER_ID, "/start", "João", "joao99"));

    // POST[0] = resposta ao usuário; POST[1] = notificação ao admin
    expect(mock.history.post).toHaveLength(2);

    const userMsg  = JSON.parse(mock.history.post[0].data);
    const adminMsg = JSON.parse(mock.history.post[1].data);

    expect(userMsg.text).toContain("pendente");
    expect(adminMsg.chat_id).toBe("123456789");
    expect(adminMsg.text).toContain("Novo usuário");
    expect(adminMsg.text).toContain(String(USER_ID));
    expect(adminMsg.reply_markup.inline_keyboard[0][0].callback_data).toBe(`authorize:${USER_ID}`);
    expect(adminMsg.reply_markup.inline_keyboard[0][1].callback_data).toBe(`reject:${USER_ID}`);
  });

  it("NÃO notifica o admin quando usuário pendente envia /start novamente", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true, result: { message_id: 12 } });
    // getUserInfo retorna pending (is_authorized = 0) → não é novo
    (userService.getUserInfo as jest.Mock).mockResolvedValue({
      chat_id: String(USER_ID), is_authorized: 0,
    });

    await handleUpdate(msgUpdate(USER_ID, "/start", "João"));

    // Apenas a resposta ao usuário — sem notificação ao admin
    expect(mock.history.post).toHaveLength(1);
    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("pendente");
  });

  it("informa usuário recusado sem notificar o admin", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true, result: { message_id: 13 } });
    (userService.getUserInfo as jest.Mock).mockResolvedValue({
      chat_id: String(USER_ID), is_authorized: -1,
    });

    await handleUpdate(msgUpdate(USER_ID, "/start", "João"));

    expect(mock.history.post).toHaveLength(1);
    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("negado");
  });

  it("envia boas-vindas de usuário já autorizado sem notificar admin", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true, result: { message_id: 14 } });
    (userService.getUserInfo as jest.Mock).mockResolvedValue({
      chat_id: String(USER_ID), is_authorized: 1,
    });

    await handleUpdate(msgUpdate(USER_ID, "/start", "João"));

    expect(mock.history.post).toHaveLength(1);
    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("autorizado");
  });
});

// ── callback_query — botões inline ─────────────────────────────────────────

describe("callback_query", () => {
  it("admin autoriza usuário via botão — atualiza DB, notifica usuário e edita mensagem", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true, result: { message_id: 20 } });
    mock.onPost(/answerCallbackQuery/).reply(200, { ok: true });
    mock.onPost(/editMessageText/).reply(200, { ok: true });

    await handleUpdate(callbackUpdate(ADMIN_ID, ADMIN_ID, 99, `authorize:${USER_ID}`));

    expect(userService.authorizeUser).toHaveBeenCalledWith(String(USER_ID));

    // answerCallbackQuery + sendMessage (usuário) + editMessageText
    const urls = mock.history.post.map(r => r.url);
    expect(urls).toContain(`https://api.telegram.org/bottest-token/answerCallbackQuery`);
    expect(urls).toContain(`https://api.telegram.org/bottest-token/sendMessage`);
    expect(urls).toContain(`https://api.telegram.org/bottest-token/editMessageText`);

    const userNotif = mock.history.post.find(r =>
      r.url?.includes("sendMessage") && JSON.parse(r.data).chat_id === String(USER_ID)
    );
    expect(JSON.parse(userNotif!.data).text).toContain("aprovado");
  });

  it("admin recusa usuário via botão — atualiza DB, notifica usuário e edita mensagem", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true, result: { message_id: 21 } });
    mock.onPost(/answerCallbackQuery/).reply(200, { ok: true });
    mock.onPost(/editMessageText/).reply(200, { ok: true });

    await handleUpdate(callbackUpdate(ADMIN_ID, ADMIN_ID, 99, `reject:${USER_ID}`));

    expect(userService.rejectUser).toHaveBeenCalledWith(String(USER_ID));

    const userNotif = mock.history.post.find(r =>
      r.url?.includes("sendMessage") && JSON.parse(r.data).chat_id === String(USER_ID)
    );
    expect(JSON.parse(userNotif!.data).text).toContain("negado");
  });

  it("não-admin não consegue acionar botão de autorização", async () => {
    mock.onPost(/answerCallbackQuery/).reply(200, { ok: true });

    const OUTSIDER_ID = 111222333;
    await handleUpdate(callbackUpdate(OUTSIDER_ID, ADMIN_ID, 99, `authorize:${USER_ID}`));

    expect(userService.authorizeUser).not.toHaveBeenCalled();

    const answer = JSON.parse(mock.history.post[0].data);
    expect(answer.text).toContain("não permitida");
  });

  it("ignora callback_query com dados inválidos (sem ':')", async () => {
    mock.onPost(/answerCallbackQuery/).reply(200, { ok: true });

    await handleUpdate(callbackUpdate(ADMIN_ID, ADMIN_ID, 99, "malformed_data"));

    expect(userService.authorizeUser).not.toHaveBeenCalled();
    expect(userService.rejectUser).not.toHaveBeenCalled();
  });
});

// ── Comandos autenticados ──────────────────────────────────────────────────

describe("Comandos de Alerta", () => {
  beforeEach(() => {
    (userService.isUserAuthorized as jest.Mock).mockResolvedValue(true);
  });

  it("permite criar alerta quando autorizado", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });
    (userService.addAlert as jest.Mock).mockResolvedValue(123);

    await handleUpdate(msgUpdate(USER_ID, "/alerta BSB GRU 20/12/2026 500"));

    expect(userService.addAlert).toHaveBeenCalled();
    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("Alerta criado");
  });

  it("permite editar preço de um alerta existente", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });
    (userService.updateAlertPrice as jest.Mock).mockResolvedValue(true);

    await handleUpdate(msgUpdate(USER_ID, "/editar 5 600"));

    expect(userService.updateAlertPrice).toHaveBeenCalledWith(String(USER_ID), 5, 600);
    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("atualizado para");
  });

  it("permite remover um alerta existente", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });
    (userService.removeAlert as jest.Mock).mockResolvedValue(true);

    await handleUpdate(msgUpdate(USER_ID, "/remover 10"));

    expect(userService.removeAlert).toHaveBeenCalledWith(String(USER_ID), 10);
    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("removido com sucesso");
  });

  it("bloqueia comandos para usuários não autorizados", async () => {
    mock.onPost(/sendMessage/).reply(200, { ok: true });
    (userService.isUserAuthorized as jest.Mock).mockResolvedValue(false);

    await handleUpdate(msgUpdate(USER_ID, "/meusalertas"));

    const body = JSON.parse(mock.history.post[0].data);
    expect(body.text).toContain("Acesso negado");
  });
});
