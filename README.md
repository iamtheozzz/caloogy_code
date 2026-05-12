# Caloogy Code

Local crypto quant analysis tool — the same charting and AI code editor as [caloogy.ai](https://caloogy.ai), running entirely on your machine with your own AI API key.

## Quick Start

**One-time run (no install):**
```bash
npx github:iamtheozzz/caloogy_code
```

**Install globally so you can type `caloogy` anytime:**
```bash
npm install -g github:iamtheozzz/caloogy_code
caloogy
```

On first run you'll be asked to choose an AI provider and paste your API key. The browser opens automatically at `http://localhost:3000`.

## Supported AI Providers

| Provider | Where to get a key |
|----------|--------------------|
| Google Gemini | [aistudio.google.com](https://aistudio.google.com/app/apikey) |
| OpenAI (GPT-4o) | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| Anthropic Claude | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) |

Your key is stored locally at `~/.caloogy-config.json`. To switch providers, delete that file and re-run.

## Requirements

- Node.js 18+
- An API key for one of the supported AI providers

## What's included

- Live BTC / ETH / SOL / BNB (+ 29 more) candlestick charts via OKX & Binance public APIs
- 19 built-in backtest strategies (MA Cross, RSI Bands, Supertrend, Ichimoku, …)
- Caloogy Code editor: write custom JS indicator code and run it on the chart
- AI chat panel: describe a strategy in plain English → AI generates the code

## Privacy

- Market data is fetched directly from OKX / Binance — no data passes through any third-party server
- Your AI key is stored only in `~/.caloogy-config.json` on your machine
- AI requests go directly from your machine to the provider's API
