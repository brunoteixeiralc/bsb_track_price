# ✈️ Flight Tracker — BSB → Destino

Monitora passagens baratas saindo de Brasília e envia alertas no Telegram quando o preço está abaixo do threshold configurado.

## Stack

- **Node.js + TypeScript**
- **APIs**: Apify (primária) + RapidAPI (fallback)
- **Notificações**: Telegram Bot
- **Execução**: GitHub Actions (2x ao dia — 08h e 20h BRT)

---

## Setup

### 1. Clone o repositório

```bash
git clone https://github.com/seu-usuario/flight-tracker.git
cd flight-tracker
npm install
```

### 2. Configure as variáveis de ambiente

Copie o `.env.example` e preencha:

```bash
cp .env.example .env
```

| Variável | Descrição |
|---|---|
| `APIFY_API_TOKEN` | Token da API do Apify |
| `RAPIDAPI_KEY` | Chave da RapidAPI |
| `TELEGRAM_BOT_TOKEN` | Token do seu bot no Telegram |
| `TELEGRAM_CHAT_ID` | ID do chat/grupo onde receber alertas |
| `ORIGIN` | Código IATA de origem (ex: `BSB`) |
| `DESTINATION` | Código IATA de destino (ex: `GRU`) |
| `MAX_PRICE_BRL` | Threshold máximo em reais (ex: `300`) |
| `DEPARTURE_DATE` | Data de ida no formato `YYYY-MM-DD` |
| `RETURN_DATE` | Data de volta (opcional) `YYYY-MM-DD` |

### 3. Configure os Secrets no GitHub

Vá em **Settings → Secrets and variables → Actions** e adicione todas as variáveis acima como secrets.

### 4. Rode localmente

```bash
npm run dev
```

---

## Estrutura do Projeto

```
flight-tracker/
├── src/
│   ├── index.ts          # Entry point
│   ├── config.ts         # Configurações e env vars
│   ├── apis/
│   │   ├── apify.ts      # Integração Apify
│   │   └── rapidapi.ts   # Integração RapidAPI (fallback)
│   ├── services/
│   │   ├── tracker.ts    # Lógica principal de busca
│   │   ├── currency.ts   # Conversão de moeda para BRL
│   │   └── telegram.ts   # Envio de alertas
│   └── types.ts          # Tipos TypeScript
├── .github/
│   └── workflows/
│       └── check-flights.yml
├── .env.example
├── package.json
└── tsconfig.json
```

---

## Mensagem no Telegram

Quando encontrar passagem abaixo do threshold:

```
✈️ Passagem barata encontrada!

🛫 BSB → GRU
📅 15/08/2025
💰 R$ 249,90
🔗 Ver passagem
```
