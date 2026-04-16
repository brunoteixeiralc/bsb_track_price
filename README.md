# ✈️ BSB Price Track

Monitora passagens aéreas saindo de Brasília (BSB) e envia alertas no Telegram quando o preço está abaixo do threshold configurado. Roda automaticamente via GitHub Actions duas vezes ao dia.

## Funcionalidades

- 🔍 **Múltiplos destinos** — busca BSB→GRU, BSB→SDL, BSB→FOR de uma vez
- 🔁 **Múltiplas origens** — `ORIGINS=BSB,GRU` varre todas as combinações nos dois sentidos (útil para quem viajou e quer monitorar a volta)
- 🗓️ **Intervalo de datas** — varre N dias a partir da data de saída e alerta a data mais barata
- 📅 **Offset de data** — `DEPARTURE_DATE_OFFSET=7` busca sempre "daqui 7 dias", sem precisar atualizar manualmente
- ✈️ **Somente ida ou ida e volta** — configurável por variável de ambiente
- 👥 **Configuração de passageiros** — suporte a múltiplos adultos e crianças
- 🔄 **Retry com backoff & Rotação de Tokens** — tenta Apify até 3x e rotaciona entre até 5 tokens se os créditos acabarem
- 💾 **Histórico SQLite** — salva cada busca em `data/history.db` (commitado automaticamente) com pruning automático configurável
- 📊 **Relatório Semanal** — resumo automático dos melhores preços da semana enviado aos domingos
- 🤖 **Bot Interativo (Webhook)** — comandos para busca em tempo real e consulta de histórico
- 🛡️ **Anti-spam configurável** — só envia alerta se o preço cair ≥ X% (padrão 5%, configurável via `PRICE_DROP_THRESHOLD`)
- ⚙️ **Filtros Avançados** — filtre por companhias aéreas, máximo de escalas e duração do voo
- 💵 **Conversão Dinâmica** — converte preços de USD/outras moedas para BRL em tempo real via API
- 📰 **Notícias de Milhas com IA** — monitora feeds (Passageiro de Primeira) e usa **IA (Claude via OpenRouter)** para resumir os artigos automaticamente
- 🏷️ **Ofertas do Dia** — busca ofertas de passagens e pacotes no feed "Quero Viajar na Faixa"
- 💚 **Health check diário** — envia uma mensagem no Telegram confirmando que o tracker rodou
- 🔒 **Webhook seguro** — comandos aceitos apenas do `TELEGRAM_CHAT_ID` autorizado
- 🧪 **Testes com cobertura** — CI bloqueia PRs com cobertura abaixo de 80%

---

## Stack

- **Node.js 22 + TypeScript** (uso de `node:sqlite` nativo)
- **APIs**: Apify (primária) → RapidAPI/Skyscanner (fallback)
- **IA**: OpenRouter (Claude/Alpha) para resumos automáticos de notícias
- **Persistência**: SQLite (histórico) e JSON (notícias/ofertas vistas)
- **Notificações**: Telegram Bot
- **CI/CD**: GitHub Actions — execuções agendadas e persistência automática no Git

---

## Setup

### 1. Clone e instale

```bash
git clone https://github.com/seu-usuario/bsb-price-track.git
cd bsb-price-track
npm install
```

### 2. Configure o `.env`

```bash
cp .env.example .env
```

Edite o `.env` com suas credenciais (veja a tabela abaixo).

### 3. Rode localmente

```bash
npm run dev
```

### 4. Rode os testes

```bash
npm test              # apenas testes
npm test -- --coverage  # testes + relatório de cobertura
```

> **Requisito**: Node.js 22 ou superior (necessário para `node:sqlite`).

---

## Variáveis de Ambiente

### Obrigatórias

| Variável | Descrição |
|---|---|
| `APIFY_API_TOKEN_1` | Token primário da API do Apify |
| `RAPIDAPI_KEY` | Chave da RapidAPI (fallback) |
| `TELEGRAM_BOT_TOKEN` | Token do bot no Telegram |
| `TELEGRAM_CHAT_ID` | ID do chat/grupo para receber alertas |
| `DESTINATIONS` | Destinos separados por vírgula (ex: `GRU,SDL,FOR`) |
| `OPENROUTER_API_KEY` | (Opcional) Chave da OpenRouter para resumos de notícias com IA |

### Opcionais

| Variável | Padrão | Descrição |
|---|---|---|
| `DEPARTURE_DATE` | — | Data de ida fixa no formato `YYYY-MM-DD`. Tem prioridade sobre `DEPARTURE_DATE_OFFSET`. |
| `DEPARTURE_DATE_OFFSET` | `0` | Dias a partir de hoje para calcular a data de ida automaticamente. Ex: `7` = sempre daqui 7 dias. |
| `ORIGIN` | `BSB` | Código IATA de origem (única) |
| `ORIGINS` | — | Múltiplas origens separadas por vírgula (ex: `BSB,GRU`). Tem prioridade sobre `ORIGIN`. Varre todas as combinações origem→destino nos dois sentidos, ignorando pares onde origem = destino. |
| `TRIP_TYPE` | `one-way` | Tipo de viagem: `one-way` ou `round-trip` |
| `RETURN_DATE` | — | Data de volta `YYYY-MM-DD` (**obrigatório** se `TRIP_TYPE=round-trip`) |
| `DATE_RANGE_DAYS` | `1` | Quantos dias varrer a partir da data de partida |
| `ADULTS` | `1` | Número de passageiros adultos |
| `CHILDREN` | `0` | Número de passageiros crianças |
| `MAX_PRICE_BRL` | `300` | Threshold máximo em reais |
| `PRICE_DROP_THRESHOLD` | `0.95` | Fator de queda para acionar o alerta (0.95 = queda de 5%). Ex: `0.90` para alertar só com queda ≥ 10%. |
| `HISTORY_RETENTION_DAYS` | `365` | Quantos dias de histórico manter. Entradas mais antigas são removidas automaticamente. |
| `WEBHOOK_PORT` | `3000` | Porta para o servidor de webhook do bot |
| `AIRLINES_WHITELIST` | — | Lista de companhias (ex: `LATAM,GOL`) |
| `MAX_STOPS` | — | Máximo de escalas (0 = direto) |
| `MAX_DURATION_HOURS`| — | Duração máxima do voo em horas |
| `APIFY_API_TOKEN_2..5`| — | Tokens adicionais para rotação (opcional) |
| `APIFY_ACTOR_ID` | `johnvc~google-flights...` | Actor ID do Apify |
| `RAPIDAPI_HOST` | `sky-scrapper.p.rapidapi.com` | Host da RapidAPI |

### Data de partida — precedência

```
DEPARTURE_DATE definido  →  usa essa data
DEPARTURE_DATE_OFFSET=7  →  busca sempre daqui 7 dias (recalculado em cada run)
nenhum dos dois          →  busca para hoje
```

### Exemplo de `.env`

```env
APIFY_API_TOKEN_1=apify_api_xxxxx
RAPIDAPI_KEY=xxxxx
TELEGRAM_BOT_TOKEN=123456:ABC-xxxxx
TELEGRAM_CHAT_ID=-100xxxxxxxx

ORIGIN=BSB
DESTINATIONS=GRU,SDL,FOR
DEPARTURE_DATE_OFFSET=7
TRIP_TYPE=round-trip
RETURN_DATE=2026-07-20
DATE_RANGE_DAYS=7
MAX_PRICE_BRL=400
PRICE_DROP_THRESHOLD=0.90
HISTORY_RETENTION_DAYS=180
```

---

## GitHub Actions

### Secrets necessários

Vá em **Settings → Secrets and variables → Actions → Secrets** e adicione:

| Secret | Obrigatório |
|---|---|
| `APIFY_API_TOKEN_1` | ✅ |
| `RAPIDAPI_KEY` | ✅ |
| `TELEGRAM_BOT_TOKEN` | ✅ |
| `TELEGRAM_CHAT_ID` | ✅ |

### Variables necessárias

Vá em **Settings → Secrets and variables → Actions → Variables** e adicione:

| Variable | Obrigatório | Exemplo |
|---|---|---|
| `DESTINATIONS` | ✅ | `GRU,SDL,FOR` |
| `DEPARTURE_DATE_OFFSET` | recomendado | `7` |
| `DEPARTURE_DATE` | opcional (fixo) | `2026-07-10` |
| `TRIP_TYPE` | opcional | `one-way` |
| `RETURN_DATE` | se round-trip | `2026-07-20` |
| `DATE_RANGE_DAYS` | opcional | `7` |
| `MAX_PRICE_BRL` | opcional | `400` |
| `ORIGIN` | opcional | `BSB` |
| `ORIGINS` | opcional | `BSB,GRU` |
| `PRICE_DROP_THRESHOLD` | opcional | `0.90` |
| `HISTORY_RETENTION_DAYS` | opcional | `365` |
| `APIFY_ACTOR_ID` | opcional | — |
| `RAPIDAPI_HOST` | opcional | — |

### Workflows

| Workflow | Gatilho | O que faz |
|---|---|---|
| `ci.yml` | Push e Pull Request | Roda testes + coverage (bloqueia se < 80%) |
| `check-flights.yml` | Cron 08h/20h BRT + manual | Busca voos, envia alertas, commita `history.db` e `health.json` |
| `check-news.yml` | Cron 3x ao dia | Monitora notícias de milhas e pontos |
| `check-offers.yml` | Cron a cada 2 horas | Busca novas ofertas de passagens/viagens |

> Todos os workflows usam **Node.js 22** (obrigatório para `node:sqlite`).

---

## Estrutura do Projeto

```
bsb-price-track/
├── src/
│   ├── index.ts                  # Entry point (Flight Tracker)
│   ├── index-news.ts             # Entry point (News/Miles)
│   ├── index-offers.ts           # Entry point (Offers)
│   ├── config.ts                 # Leitura e validação de env vars
│   ├── types.ts                  # Tipos TypeScript (Flight, SearchParams, etc.)
│   ├── apis/
│   │   ├── apify.ts              # Integração Apify (Google Flights scraper)
│   │   └── rapidapi.ts           # Integração RapidAPI/Skyscanner (fallback)
│   ├── services/
│   │   ├── tracker.ts            # Lógica principal: busca, retry, alertas
│   │   ├── news.ts               # Lógica de fetch e filtro de RSS (Milhas/Notícias)
│   │   ├── telegram.ts           # Envio de mensagens no Telegram
│   │   ├── currency.ts           # Conversão de moeda para BRL
│   │   ├── history.ts            # Leitura/escrita do histórico SQLite (history.db)
│   │   ├── healthCheck.ts        # Health check diário no Telegram
│   │   ├── webhook.ts            # Lógica do servidor de webhook
│   │   └── weeklyReport.ts       # Geração de relatório semanal
│   ├── utils/
│   │   ├── retry.ts              # withRetry — backoff exponencial genérico
│   │   └── dates.ts              # generateDateRange — gera intervalo de datas
│   └── __tests__/                # Testes unitários (Jest)
├── data/
│   ├── history.db                # Histórico de buscas em SQLite (auto-commitado pelo CI)
│   ├── health.json               # Controle de health check diário
│   ├── news-seen.json            # Banco de notícias já enviadas
│   └── offers-seen.json          # Banco de ofertas já enviadas
├── .github/
│   └── workflows/
│       ├── ci.yml                # CI — testes em todo push/PR
│       ├── check-flights.yml     # Tracker de voos — cron 2x ao dia
│       ├── check-news.yml        # Tracker de notícias — cron 3x ao dia
│       └── check-offers.yml      # Tracker de ofertas — cron a cada 2h
├── .gitattributes                # Marca *.db como binário (evita diff de texto no SQLite)
├── .env.example
├── package.json
└── tsconfig.json
```

---

## Mensagens no Telegram

### Alerta de passagem barata (one-way)

```
✈️ Passagem barata encontrada!

🛫 BSB → GRU
🏷️ ✈️ Somente Ida
📅 Ida: 15/07/2026
🏢 LATAM
💰 R$ 249,90

🔗 Ver passagem
_Fonte: apify_
```

### Alerta de passagem barata (round-trip)

```
✈️ Passagem barata encontrada!

🛫 BSB → GRU
🏷️ 🔄 Ida e Volta
📅 Ida: 15/07/2026
📅 Volta: 22/07/2026
🏢 GOL
💰 R$ 589,00

🔗 Ver passagem
_Fonte: rapidapi_
```

### Resumo de intervalo de datas

```
🗓️ BSB→GRU (✈️ Somente Ida) — 7 data(s) verificada(s).
💰 Melhor: R$ 249,90 em 18/07/2026 (LATAM)
```

### Health check diário

```
💚 Tracker ativo — 25/03/2026, 08:05:12
```

### Relatório Semanal

Enviado automaticamente aos domingos, compara os preços atuais com os da semana anterior.

```
📊 Relatório Semanal de Passagens
📅 29/03/2026, 09:00:00

✈️ BSB → GRU
💰 Menor preço esta semana: R$ 249,90
📊 Semana anterior: R$ 270,00
📉 Variação: -7.4% (-R$ 20,10)

✈️ BSB → FOR
💰 Menor preço esta semana: R$ 450,00
📊 Semana anterior: sem dados
➡️ Tendência: sem dados suficientes para comparar

_14 verificação(ões) realizadas esta semana_
```

---

## Bot Interativo (Webhook)

O projeto conta com um servidor de webhook para responder a comandos diretamente no Telegram. Apenas mensagens do `TELEGRAM_CHAT_ID` configurado são aceitas.

### Comandos disponíveis

- `/buscar [DESTINO]` — Realiza uma busca em tempo real para o destino informado (ex: `/buscar GRU`).
- `/historico [DESTINO]` — Mostra as últimas 5 buscas realizadas para aquele destino, permitindo acompanhar a evolução do preço.
- `/status` — Exibe o status atual do tracker, incluindo origem, destinos monitorados e threshold de preço.

### Como rodar o Bot

1. Configure a `WEBHOOK_PORT` no `.env` (padrão é 3000).
2. Exponha sua porta local (use `ngrok`, `cloudflare tunnel` ou deploy em servidor).
3. Configure o Webhook no Telegram:
   `https://api.telegram.org/bot<TOKEN>/setWebhook?url=<SUA_URL>`
4. Inicie o servidor:
   ```bash
   npm run webhook
   ```

---

## Filtros Avançados

Você pode refinar sua busca utilizando variáveis de ambiente para evitar alertas de voos indesejados.

- **Companhias Específicas**: Use `AIRLINES_WHITELIST=LATAM,GOL` para receber alertas apenas dessas empresas.
- **Voos Diretos**: Configure `MAX_STOPS=0` para ignorar voos com escalas.
- **Duração do Voo**: Use `MAX_DURATION_HOURS=5` para filtrar voos muito longos.

### Anti-Spam Configurável

Um novo alerta só é disparado para uma mesma rota e data se o preço atual for pelo menos X% menor que o menor preço encontrado na busca anterior. O percentual é configurável:

```env
PRICE_DROP_THRESHOLD=0.95   # alerta se cair ≥ 5% (padrão)
PRICE_DROP_THRESHOLD=0.90   # alerta só se cair ≥ 10%
PRICE_DROP_THRESHOLD=1.00   # sempre alerta (sem filtro)
```

---

## Fluxo de Busca

```
Para cada origem em ORIGINS:
  Para cada destino em DESTINATIONS (ignorando origem = destino):
    ├── Calcula data de partida (DEPARTURE_DATE > DEPARTURE_DATE_OFFSET > hoje)
    ├── Gera intervalo de datas (DATE_RANGE_DAYS)
    │
    ├── Se apenas 1 data:
    │   ├── Tenta Apify (até 3x com retry, rotação de tokens se 402/403)
    │   ├── Se falhar → tenta RapidAPI
    │   ├── Aplica filtros avançados
    │   ├── Salva em data/history.db (pruning automático)
    │   └── Se abaixo do threshold E queda ≥ PRICE_DROP_THRESHOLD → envia alerta
    │
    └── Se múltiplas datas:
        ├── Para cada data: busca → filtra → salva
        ├── Encontra a data com o voo mais barato
        ├── Se abaixo do threshold E queda ≥ PRICE_DROP_THRESHOLD → envia alerta
        └── Envia resumo do intervalo
```

---

## Desenvolvimento

### Comandos úteis

```bash
npm run dev          # Executa o tracker de voos uma vez
npm run news         # Executa o tracker de notícias de milhas
npm run offers       # Executa o tracker de ofertas
npm run webhook      # Inicia o bot interativo via webhook
npm test             # Roda todos os testes
npm test -- --coverage  # Testes + relatório de cobertura
npm run build        # Compila TypeScript para dist/
npm run start:webhook # Inicia o bot compilado (production)
```

### Adicionando um novo destino

Basta adicionar o código IATA na variável `DESTINATIONS` (ou na Variable do GitHub):

```env
DESTINATIONS=GRU,SDL,FOR,CNF,VCP
```

### Configurando busca dinâmica de datas

```env
# Sempre busca daqui 14 dias, varrendo 7 dias
DEPARTURE_DATE_OFFSET=14
DATE_RANGE_DAYS=7
```
