# CLAUDE.md — BSB Price Track

Documentação técnica para o assistente de IA. Atualizado em: 2026-04-20.

---

## Visão Geral

Bot de Telegram + rastreador agendado para monitorar passagens aéreas baratas e notícias de milhas. Suporte multi-usuário com sistema de autorização pelo admin.

---

## Stack

| Componente | Tecnologia |
|---|---|
| Linguagem | Node.js + TypeScript |
| Banco de dados | Turso (libsql / SQLite Cloud) |
| Crawler principal | Apify (Google Flights scraper) |
| Crawler fallback | RapidAPI (SkyScrapper / Skyscanner unofficial) |
| IA / Resumo | OpenRouter API — modelo `openrouter/elephant-alpha` (via axios, sem SDK) |
| Bot | Telegram Bot API (webhook mode) |
| Servidor bot | Railway (24/7, porta dinâmica `$PORT`) |
| Agendamentos | GitHub Actions (cron) |

---

## Infraestrutura

### Railway (Bot Webhook — 24/7)
- Entry point: `src/webhook.ts` → compila para `dist/webhook.js`
- Comando de start: `npm run start:webhook` (definido em `nixpacks.toml`)
- Porta: usa `process.env.PORT` (Railway injeta dinamicamente, ex: 8080). Fallback: `WEBHOOK_PORT` → `3000`
- Saúde: Railway faz GET health checks → servidor responde `200 OK` e ignora (só processa POST)
- Inicialização: `startWebhookServer()` ANTES de `initTables()` para o Railway não dar timeout

### GitHub Actions (Agendamentos)
- `check-flights.yml` — 2x/dia (8h e 20h BRT): verifica alertas de todos os usuários
- `check-news.yml` — 3x/dia (8h, 13h, 20h BRT): RSS de notícias de milhas + resumo IA
- `check-offers.yml` — a cada 2h: RSS de ofertas
- `ci.yml` — em cada push/PR: typecheck + testes com cobertura
- `test-summarize.yml` — dispatch manual: smoke test do OpenRouter

---

## Estrutura de Arquivos Principais

```
src/
├── webhook.ts              # Entry point do bot Railway
├── index.ts                # Entry point do tracker de voos
├── index-news.ts           # Entry point do tracker de notícias
├── index-offers.ts         # Entry point do tracker de ofertas
├── config.ts               # Lê todas as env vars (dotenv)
├── types.ts                # Tipos globais: Flight, SearchParams, etc.
├── apis/
│   ├── apify.ts            # Busca principal (Google Flights via Apify)
│   └── rapidapi.ts         # Busca fallback (Skyscanner via RapidAPI)
├── services/
│   ├── db.ts               # Cliente Turso + initTables()
│   ├── user.ts             # CRUD de usuários e alertas
│   ├── webhook.ts          # Handlers do bot Telegram (servidor HTTP + comandos)
│   ├── webhook_legacy.ts   # Handler /buscar (busca on-demand)
│   ├── news.ts             # RSS tracker + sumarização OpenRouter
│   ├── tracker.ts          # Lógica de tracking agendado de voos
│   ├── telegram.ts         # sendAlert() para notificações de preço
│   ├── currency.ts         # Conversão USD→BRL (cache de 1h)
│   ├── history.ts          # Leitura/escrita de histórico no Turso
│   ├── healthCheck.ts      # health.json
│   └── weeklyReport.ts     # Relatório semanal por rota
├── utils/
│   ├── dates.ts            # Helpers de datas
│   ├── priceHistory.ts     # Análise de histórico de preços
│   └── retry.ts            # Retry com backoff exponencial
└── scripts/
    └── test-summarize.ts   # Smoke test manual do OpenRouter
```

---

## Banco de Dados — Turso (tabelas)

### `users`
```sql
chat_id       TEXT PRIMARY KEY   -- ID do chat Telegram
username      TEXT
first_name    TEXT
is_authorized INTEGER DEFAULT 0  -- -1=recusado, 0=pendente, 1=autorizado
receives_news INTEGER DEFAULT 1  -- 1=quer notícias, 0=não quer
created_at    TEXT
```

### `alerts`
```sql
id             INTEGER PRIMARY KEY AUTOINCREMENT
chat_id        TEXT NOT NULL REFERENCES users(chat_id)
origin         TEXT NOT NULL        -- ex: "BSB"
destination    TEXT NOT NULL        -- ex: "GRU"
departure_date TEXT NOT NULL        -- ex: "2026-07-20"
return_date    TEXT                 -- só para ida e volta
trip_type      TEXT DEFAULT 'one-way'
max_price_brl  REAL NOT NULL
is_active      INTEGER DEFAULT 1
created_at     TEXT
```

### `history`
```sql
id               INTEGER PRIMARY KEY AUTOINCREMENT
timestamp        TEXT NOT NULL
origin           TEXT NOT NULL
destination      TEXT NOT NULL
departureDate    TEXT NOT NULL
returnDate       TEXT
totalFound       INTEGER NOT NULL
cheapestPriceBRL REAL
flights          TEXT NOT NULL DEFAULT '[]'  -- JSON
```

### `news_seen`
```sql
guid       TEXT PRIMARY KEY   -- URL/GUID do artigo RSS
tag        TEXT NOT NULL      -- ex: "news", "news-promocoes"
created_at TEXT
```

---

## Telegram Bot — Comandos

### Públicos (sem autorização)
| Comando | Descrição |
|---|---|
| `/start` | Cadastra usuário; admin é auto-autorizado; novos usuários ficam pendentes e notificam o admin com botões inline |
| `/meuid` | Exibe o chat ID do usuário (útil para configurar `TELEGRAM_CHAT_ID`) |

### Autenticados (`is_authorized = 1`)
| Comando | Descrição |
|---|---|
| `/alerta ORIGEM DESTINO DATA PRECO` | Cria alerta de ida. Ex: `/alerta BSB GRU 20/07/2026 350` |
| `/alerta ORIGEM DESTINO DATA_IDA DATA_VOLTA PRECO` | Cria alerta ida e volta |
| `/meusalertas` | Lista alertas ativos do usuário |
| `/remover ID` | Remove alerta pelo ID |
| `/editar ID NOVO_PRECO` | Atualiza preço máximo de um alerta |
| `/buscar DESTINO` | Busca on-demand usando origem padrão e data de hoje+7 |
| `/buscar ORIGEM DESTINO` | Busca com origem customizada |
| `/buscar ORIGEM DESTINO DATA` | Busca numa data específica (DD/MM/YYYY) |
| `/status` | Exibe estado do servidor (apenas admin) |
| `/autorizar ID` | Autoriza usuário manualmente (apenas admin, alternativa aos botões) |

### Fluxo de Autorização (botões inline)
1. Usuário envia `/start` → bot salva no DB, responde "pendente"
2. Admin recebe mensagem com botões **✅ Autorizar / ❌ Recusar**
3. Admin clica → `callback_query` chega ao bot → `handleCallbackQuery()` executa
4. Bot chama `authorizeUser()` ou `rejectUser()`, notifica o usuário alvo, edita a mensagem do admin
5. Se usuário já existia no DB (retornou ao `/start`): NÃO notifica admin novamente

---

## Fluxo de Busca de Voos

```
SearchParams { origin, destination, departureDate, returnDate?, tripType, ignoreMaxPrice? }
    ↓
searchWithApify()          ← tenta tokens 1..5, rotaciona em 402/403
    ↓ falha
searchWithRapidAPI()       ← fallback
    ↓
Flight[] { priceBRL, airline, stops, durationMinutes, link, priceInsights? }
```

**`ignoreMaxPrice`**: quando `true` (usado em `/buscar`), o parâmetro `max_price` NÃO é enviado ao Apify — retorna todos os preços e o bot exibe os 3 mais baratos. Quando `false` (tracker agendado), aplica o filtro `MAX_PRICE_BRL / USD_rate`.

---

## OpenRouter — Sumarização de Notícias

- Arquivo: `src/services/news.ts`
- Endpoint: `POST https://openrouter.ai/api/v1/chat/completions`
- Modelo: `openrouter/elephant-alpha`
- Auth: `Authorization: Bearer $OPENROUTER_API_KEY`
- Sem SDK — usa `axios` diretamente (já dependência do projeto)
- Resposta: `response.data.choices[0].message.content`
- `shouldSummarize()` só retorna `true` se `OPENROUTER_API_KEY` está definida E o artigo tem score < 2

---

## Variáveis de Ambiente

### Railway (obrigatórias)
```
TELEGRAM_BOT_TOKEN        Token do bot @BotFather
TELEGRAM_CHAT_ID          Chat ID PESSOAL do admin (não o grupo!)
TURSO_DATABASE_URL        URL do banco Turso (libsql://...)
TURSO_AUTH_TOKEN          Token de autenticação do Turso
APIFY_API_TOKEN_1         Token Apify (pode ter até _5 para rotação)
RAPIDAPI_KEY              Chave RapidAPI (fallback)
ORIGINS                   Ex: "BSB" ou "BSB,GRU"
DESTINATIONS              Ex: "GRU,FOR,REC"
```

### GitHub Actions (secrets)
```
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
TURSO_DATABASE_URL
TURSO_AUTH_TOKEN
APIFY_API_TOKEN_1
RAPIDAPI_KEY
OPENROUTER_API_KEY        Para sumarização de notícias
ORIGINS / DESTINATIONS
MAX_PRICE_BRL             Limite de preço para alertas agendados
DEPARTURE_DATE / DEPARTURE_DATE_OFFSET
```

---

## Padrões de Código Importantes

### Webhook — resposta imediata + processamento assíncrono
```typescript
req.on("end", () => {
  res.writeHead(200); res.end("OK");   // responde ANTES de processar
  if (!body) return;
  (async () => { await handleUpdate(JSON.parse(body)); })();
});
```

### User service — detecção de usuário novo
```typescript
const existingUser = await userService.getUserInfo(chatId);  // ANTES de saveUser
const isNewUser = existingUser === null;
await userService.saveUser(chatId, firstName, username);
// só notifica admin se isNewUser === true
```

### Apify — rotação de tokens
```typescript
for (let i = 0; i < tokens.length; i++) {
  try { return await callApify(tokens[i]); }
  catch (err) {
    if (isCreditsError(err) && i < tokens.length - 1) continue;  // 402/403 → próximo token
    throw err;
  }
}
```

---

## Testes

```bash
npm test                    # roda todos os testes
npm test -- --coverage      # com relatório de cobertura
```

- Framework: Jest + ts-jest
- Mock HTTP: `axios-mock-adapter`
- Cobertura mínima: 50% linhas/funções, 40% branches
- Excluídos da cobertura: entry points, config, db, scripts
- Arquivo de setup: `src/__tests__/setup.ts`

### Padrão de mock para OpenRouter (em testes)
```typescript
mock.onPost("https://openrouter.ai/api/v1/chat/completions").reply(200, {
  choices: [{ message: { content: "• Ponto 1\n• Ponto 2" } }],
});
```

---

## Mudanças Recentes (histórico)

### 2026-04 — Multi-usuário + autorização inline
- Adicionado `UserRecord` interface e `getUserInfo()` em `user.ts`
- `isUserAuthorized()` corrigido: `Boolean(-1) === true` → `Number() === 1`
- Adicionado `authorizeUser()` e `rejectUser()` em `user.ts`
- `handleStart()` reescrito: detecta novo usuário ANTES de `saveUser()`
- Botões inline no Telegram (✅/❌) para o admin autorizar/rejeitar
- `handleCallbackQuery()` adicionado para processar cliques nos botões
- Bot ignora mensagens de grupos/supergrupos/canais (`chat.type !== "private"`)
- Comando `/meuid` adicionado (público, sem autenticação)
- Servidor HTTP Railway corrigido: porta dinâmica `$PORT`, health check GET, fire-and-forget async
- `nixpacks.toml` criado para garantir `tsc` no deploy Railway

### 2026-04 — Migração OpenRouter
- Removido `@anthropic-ai/sdk` do projeto
- `summarizeArticle()` agora usa `axios.post` para OpenRouter (sem SDK)
- `ANTHROPIC_API_KEY` → `OPENROUTER_API_KEY` em todos os arquivos
- Modelo: `claude-haiku-4-5-20251001` → `openrouter/elephant-alpha`

### 2026-04 — Melhorias /buscar
- `handleBuscar()` em `webhook_legacy.ts` aceita agora args variáveis:
  - `/buscar DESTINO` — usa origem padrão e data do config
  - `/buscar ORIGEM DESTINO` — origem customizada
  - `/buscar ORIGEM DESTINO DATA` — data específica (DD/MM/YYYY)
- `SearchParams.ignoreMaxPrice` adicionado: quando `true`, não envia `max_price` ao Apify
- `/buscar` usa `ignoreMaxPrice: true` → retorna todos os preços, exibe top 3
- Data mostrada na mensagem "Buscando..." para transparência

### 2026-04 — Suporte a múltiplos tokens Apify
- `config.apify.tokens` lê `APIFY_API_TOKEN_1` até `APIFY_API_TOKEN_5`
- Rotação automática em 402/403 (sem créditos)

### 2026-04 — Multi-usuário DB (Turso)
- Tabelas `users`, `alerts`, `news_seen` migradas para Turso (cloud SQLite)
- `getSubscribedUsers()` retorna apenas usuários `is_authorized=1 AND receives_news=1`
- `toggleNewsPreference()` permite usuário ativar/desativar notícias
