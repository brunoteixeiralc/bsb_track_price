# ✈️ BSB Price Track

Monitora passagens aéreas saindo de Brasília (BSB) e envia alertas no Telegram quando o preço está abaixo do threshold configurado. Roda automaticamente via GitHub Actions duas vezes ao dia.

## Funcionalidades

- 🔍 **Múltiplos destinos** — busca BSB→GRU, BSB→SDL, BSB→FOR de uma vez
- 🗓️ **Intervalo de datas** — varre N dias a partir da data de saída e alerta a data mais barata
- ✈️ **Somente ida ou ida e volta** — configurável por variável de ambiente
- 🔄 **Retry com backoff** — tenta Apify até 3x antes de cair para o RapidAPI
- 💾 **Histórico de preços** — salva cada busca em `data/history.json` (commitado automaticamente)
- 💚 **Health check diário** — envia uma mensagem no Telegram confirmando que o tracker rodou
- 🧪 **Testes com cobertura** — CI bloqueia PRs com cobertura abaixo de 80%

---

## Stack

- **Node.js + TypeScript** com `ts-node`
- **APIs**: Apify (primária) → RapidAPI/Skyscanner (fallback)
- **Notificações**: Telegram Bot
- **Testes**: Jest + `axios-mock-adapter`, cobertura ≥ 80%
- **CI/CD**: GitHub Actions — CI em todo push/PR, tracker rodando 2x ao dia (08h e 20h BRT)

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

---

## Variáveis de Ambiente

### Obrigatórias

| Variável | Descrição |
|---|---|
| `APIFY_API_TOKEN` | Token da API do Apify |
| `RAPIDAPI_KEY` | Chave da RapidAPI (fallback) |
| `TELEGRAM_BOT_TOKEN` | Token do bot no Telegram |
| `TELEGRAM_CHAT_ID` | ID do chat/grupo para receber alertas |
| `DESTINATIONS` | Destinos separados por vírgula (ex: `GRU,SDL,FOR`) |
| `DEPARTURE_DATE` | Data de ida no formato `YYYY-MM-DD` |

### Opcionais

| Variável | Padrão | Descrição |
|---|---|---|
| `ORIGIN` | `BSB` | Código IATA de origem |
| `TRIP_TYPE` | `one-way` | Tipo de viagem: `one-way` ou `round-trip` |
| `RETURN_DATE` | — | Data de volta `YYYY-MM-DD` (**obrigatório** se `TRIP_TYPE=round-trip`) |
| `DATE_RANGE_DAYS` | `1` | Quantos dias varrer a partir de `DEPARTURE_DATE` |
| `MAX_PRICE_BRL` | `300` | Threshold máximo em reais |
| `APIFY_ACTOR_ID` | `tri_angle~google-flights-scraper` | Actor ID do Apify |
| `RAPIDAPI_HOST` | `sky-scrapper.p.rapidapi.com` | Host da RapidAPI |

### Exemplo de `.env`

```env
APIFY_API_TOKEN=apify_api_xxxxx
RAPIDAPI_KEY=xxxxx
TELEGRAM_BOT_TOKEN=123456:ABC-xxxxx
TELEGRAM_CHAT_ID=-100xxxxxxxx

ORIGIN=BSB
DESTINATIONS=GRU,SDL,FOR
DEPARTURE_DATE=2026-07-10
TRIP_TYPE=round-trip
RETURN_DATE=2026-07-20
DATE_RANGE_DAYS=7
MAX_PRICE_BRL=400
```

---

## GitHub Actions

### Secrets necessários

Vá em **Settings → Secrets and variables → Actions** e adicione:

| Secret | Obrigatório |
|---|---|
| `APIFY_API_TOKEN` | ✅ |
| `RAPIDAPI_KEY` | ✅ |
| `TELEGRAM_BOT_TOKEN` | ✅ |
| `TELEGRAM_CHAT_ID` | ✅ |
| `DESTINATIONS` | ✅ |
| `DEPARTURE_DATE` | ✅ |
| `TRIP_TYPE` | opcional (`one-way` é o padrão) |
| `RETURN_DATE` | obrigatório se `TRIP_TYPE=round-trip` |
| `DATE_RANGE_DAYS` | opcional |
| `MAX_PRICE_BRL` | opcional |
| `ORIGIN` | opcional |
| `APIFY_ACTOR_ID` | opcional |
| `RAPIDAPI_HOST` | opcional |

### Workflows

| Workflow | Gatilho | O que faz |
|---|---|---|
| `ci.yml` | Push e Pull Request | Roda testes + coverage (bloqueia se < 80%) |
| `check-flights.yml` | Cron 08h/20h BRT + manual | Busca voos, envia alertas, commita histórico |

---

## Estrutura do Projeto

```
bsb-price-track/
├── src/
│   ├── index.ts                  # Entry point
│   ├── config.ts                 # Leitura e validação de env vars
│   ├── types.ts                  # Tipos TypeScript (Flight, SearchParams, etc.)
│   ├── apis/
│   │   ├── apify.ts              # Integração Apify (Google Flights scraper)
│   │   └── rapidapi.ts           # Integração RapidAPI/Skyscanner (fallback)
│   ├── services/
│   │   ├── tracker.ts            # Lógica principal: busca, retry, alertas
│   │   ├── telegram.ts           # Envio de mensagens no Telegram
│   │   ├── currency.ts           # Conversão de moeda para BRL
│   │   ├── history.ts            # Leitura/escrita de data/history.json
│   │   └── healthCheck.ts        # Health check diário no Telegram
│   ├── utils/
│   │   ├── retry.ts              # withRetry — backoff exponencial genérico
│   │   └── dates.ts              # generateDateRange — gera intervalo de datas
│   └── __tests__/                # Testes unitários (Jest)
├── data/
│   ├── history.json              # Histórico de buscas (auto-commitado pelo CI)
│   └── health.json               # Controle de health check diário
├── .github/
│   └── workflows/
│       ├── ci.yml                # CI — testes em todo push/PR
│       └── check-flights.yml     # Tracker — cron 2x ao dia
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

---

## Fluxo de Busca

```
Para cada destino em DESTINATIONS:
  ├── Gera intervalo de datas (DATE_RANGE_DAYS)
  │
  ├── Se apenas 1 data:
  │   └── Busca → alerta todos os voos abaixo do threshold → envia resumo
  │
  └── Se múltiplas datas:
      ├── Para cada data:
      │   ├── Tenta Apify (até 3x com retry)
      │   ├── Se falhar → tenta RapidAPI
      │   └── Salva resultado em data/history.json
      ├── Encontra a data com o voo mais barato
      ├── Se abaixo do threshold → envia alerta
      └── Envia resumo do intervalo
```

---

## Desenvolvimento

### Comandos úteis

```bash
npm run dev          # Executa o tracker uma vez (ts-node)
npm test             # Roda todos os testes
npm test -- --coverage  # Testes + relatório de cobertura
npm run build        # Compila TypeScript para dist/
```

### Adicionando um novo destino

Basta adicionar o código IATA na variável `DESTINATIONS` (ou no secret do GitHub):

```env
DESTINATIONS=GRU,SDL,FOR,CNF,VCP
```

### Ajustando o intervalo de busca

```env
DEPARTURE_DATE=2026-07-10
DATE_RANGE_DAYS=14   # varre de 10/07 até 23/07
```
