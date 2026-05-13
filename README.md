# Caloogy Code

Local crypto quant analysis tool — the same charting and AI code editor as [caloogy.com](https://caloogy.com), running entirely on your machine with your own AI API key.

![Caloogy Code](assets/p2.png)

---

## Quick Start

No install required — run directly with npx:

```bash
npx github:iamtheozzz/caloogy_code
```

![Terminal](assets/p1.png)

On first run you'll be prompted to choose an AI provider and paste your API key. The browser opens automatically at `http://localhost:3000`.

---

## Installation

### One-time run (no install)

```bash
npx github:iamtheozzz/caloogy_code
```

### Global install — type `caloogy` from anywhere

**macOS / Linux**
```bash
npm install -g github:iamtheozzz/caloogy_code
caloogy
```

**Windows (PowerShell)**
```powershell
npm install -g github:iamtheozzz/caloogy_code
caloogy
```

**Windows (Command Prompt)**
```cmd
npm install -g github:iamtheozzz/caloogy_code
caloogy
```

### Uninstall

```bash
npm uninstall -g caloogy-code
```

---

## Requirements

| Requirement | Version |
|-------------|---------|
| Node.js | 18 or later |
| npm | 7 or later (bundled with Node.js) |
| AI API key | One of: Gemini, OpenAI, or Claude |

Download Node.js: [nodejs.org](https://nodejs.org)

---

## Supported AI Providers

| Provider | Where to get a key |
|----------|--------------------|
| **Google Gemini** *(free tier available)* | [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) |
| **OpenAI** | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| **Anthropic Claude** | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) |

> **Cost:** Caloogy Code is completely free and open source. You only pay for the AI API calls you make — Gemini offers a generous free tier that is sufficient for most users.

---

## Usage

### Starting the app

```bash
caloogy
```

The browser opens automatically at `http://localhost:3000`. Press `Ctrl+C` in the terminal to stop the server.

### Changing your AI provider or API key

```bash
caloogy --reconfigure
# or
caloogy -r
```

### Flags

| Flag | Description |
|------|-------------|
| `--reconfigure`, `-r` | Re-run setup to change provider, API key, or email |
| `--alerts`, `-a` | Open the alert manager in the terminal |

---

## Price & Indicator Alerts

Caloogy Code includes a local risk management system that monitors your watched coins in the background and sends notifications when sharp price or indicator movements are detected. Alerts can be delivered via **Gmail**, **Discord**, and/or **Telegram** — configure one or all three.

### Setup

During `caloogy --reconfigure`, you will be prompted for each notification channel. All channels are optional — configure only the ones you want.

#### Gmail

- A **Gmail address** to receive alerts
- A **Gmail App Password** (16-character password generated at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords))

#### Discord

- A **Discord Webhook URL** — created in any channel via **Channel Settings → Integrations → Webhooks → New Webhook → Copy Webhook URL**

#### Telegram

- A **Telegram Bot Token** — create a bot with [@BotFather](https://t.me/BotFather), send `/newbot`, copy the token
- A **Telegram Chat ID** — send any message to your bot, then visit `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy the `chat.id` value

A test notification is sent to all configured channels automatically to confirm setup works.

### Managing alerts

**In the browser** — click the **Alerts** panel at the top of the page to add, remove, or toggle rules.

**In the terminal:**
```bash
caloogy --alerts
```
```
  Caloogy Alert Manager
  ─────────────────────
  1) List active alerts
  2) Add alert
  3) Remove alert
  4) Toggle alert on/off
  5) Send test notification
  6) Exit
```

### Supported alert types

| Type | Trigger |
|------|---------|
| **Price Spike** | Price changes by ±X% within N candles (1H) |
| **RSI Extreme** | RSI crosses above (overbought) or below (oversold) a threshold |
| **SMA Cross** | Price crosses above or below a moving average |
| **MACD Cross** | MACD line crosses above or below the Signal line |
| **BB Breakout** | Price breaks outside the upper or lower Bollinger Band |

### Updating notification settings without restarting

You can update any notification channel while `caloogy` is already running — no restart needed:

1. Open a new terminal window
2. Run `caloogy --reconfigure` and choose **4 — Skip (keep existing AI config)**
3. Enter the new credentials for the channel you want to update
4. Save — the change takes effect on the next scan (within 5 minutes)

### How it works

- The background monitor polls OKX / Binance every **5 minutes** for all watched symbols
- All notification credentials are re-read from disk on every scan, so config changes take effect without restart
- Each enabled channel (Gmail, Discord, Telegram) receives the notification concurrently
- All indicator calculations run locally — no data leaves your machine except the AI API calls
- Each alert has a configurable **cooldown** (default 60 minutes) to prevent repeated notifications
- Alert rules are stored at `~/.caloogy-alerts.json`
- Alerts are only active while `caloogy` is running in the terminal

### Example alert notification

```
Subject: [Caloogy Alert] BTC Price Spike +6.3%

Asset:    BTCUSDT
Trigger:  Price changed +6.3% in the last 3 candles (1H)
Current:  $98,420.00
Time:     Tue, 13 May 2026 14:35:00 GMT

Sent by Caloogy Code running on your local machine.
```

---

## Features

- **Live candlestick charts** — BTC, ETH, SOL, BNB and 29 more coins, powered by OKX & Binance public APIs
- **Timeframes** — 1H, 4H, 1D, 1W
- **Built-in indicators** — SMA, EMA, Bollinger Bands, RSI, MACD (open by default)
- **19 backtest strategies** — MA Cross, RSI Bands, BB Bounce, Supertrend, Ichimoku, Donchian, Stochastic, and more
- **Strategy builder** — answer a few questions, get an AI-generated investment analysis in plain English
- **Caloogy Code editor** — write custom JavaScript indicators and run them live on the chart
- **AI chat** — describe any strategy in plain English → AI writes the code and runs it instantly
- **Price & indicator alerts** — background monitoring with Gmail, Discord, and Telegram notifications
- **Light / dark mode** toggle
- **Auto coin switching** — mention ETH or SOL in your AI prompt and the chart switches automatically

---

## Privacy

- Market data is fetched directly from OKX / Binance — no data passes through any third-party server
- Your API key is stored only in `~/.caloogy-config.json` on your own machine
- AI requests go directly from your machine to the provider's API (Google / OpenAI / Anthropic)
- No analytics, no telemetry, no accounts required

---

## Troubleshooting

**Port already in use** — Caloogy Code automatically finds the next available port starting from 3000.

**`caloogy` command not found after global install** — make sure npm's global bin directory is in your PATH:
```bash
# macOS / Linux — add to ~/.zshrc or ~/.bashrc
export PATH="$(npm prefix -g)/bin:$PATH"
```

**AI error / model not found** — run `caloogy --reconfigure` to switch to a different model or provider.

**Browser doesn't open automatically** — navigate manually to the URL printed in the terminal (e.g. `http://localhost:3000`).

---

## License

MIT © [Caloogy](https://caloogy.com)
