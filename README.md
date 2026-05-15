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
| `--chat`, `-c` | Start the terminal AI agent (manage alerts + export CSV with natural language) |

---

## Terminal AI Agent

`caloogy --chat` opens a terminal REPL powered by your configured AI provider (Gemini, OpenAI, or Claude). No server needs to be running — it works completely standalone.

```bash
caloogy --chat
```

The AI has access to the following capabilities, all triggered through plain English:

### Available tools

| Tool | What it does |
|---|---|
| **Alert management** | Add, list, and remove price/indicator alerts |
| **CSV export** | Fetch OHLCV price data and save to a local `.csv` file |
| **Read file** | Read any file on your machine |
| **Write file** | Create or overwrite a file (directories are created automatically) |
| **List directory** | Browse the contents of any folder |
| **Run command** | Execute any shell command and see its output |

### Examples

**Manage alerts**
```
You: alert me when BTC drops more than 6% in 3 hours
AI:  Done — alert added (ID: k3x9a2b). BTCUSDT will trigger when price drops ≥6% over 3 candles.

You: show my alerts
AI:  1. [ON] BTCUSDT  price_change  (pct=6, lookback=3, direction=below) — ID: k3x9a2b — never triggered

You: remove the BTC alert
AI:  Removed alert k3x9a2b.
```

**Export price data to CSV**
```
You: export ETH daily data for the last 100 days to eth_daily.csv
AI:  Saved 100 candles to /Users/you/eth_daily.csv
```

The CSV contains columns: `timestamp, open, high, low, close, volume`. Supported intervals: `1H`, `4H`, `1D`, `1W`.

**Read and write files**
```
You: read my trading notes at ~/notes/btc.txt
AI:  [contents of the file]

You: save a summary of today's BTC analysis to ~/notes/analysis.md
AI:  Written 340 chars to /Users/you/notes/analysis.md
```

**Browse directories**
```
You: what files are in my Downloads folder?
AI:  /Users/you/Downloads
     btc_1H_1234567890.csv
     eth_daily.csv
     report.pdf
```

**Run shell commands**
```
You: what's my current Python version?
AI:  Python 3.11.4

You: how much disk space do I have left?
AI:  Filesystem  Size  Used  Avail  Use%
     /dev/disk3  460G  210G   250G   46%
```

Type `exit` or `quit` to leave the chat.

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

- **Candlestick charts** — 30+ crypto coins (BTC, ETH, SOL, BNB…) via OKX & Binance, plus 22 US stocks/ETFs via Yahoo Finance
- **Timeframes** — 1H, 4H, 1D, 1W
- **Built-in indicators** — SMA, EMA, Bollinger Bands, RSI, MACD
- **19 backtest strategies** — MA Cross, RSI Bands, BB Bounce, Supertrend, Ichimoku, Donchian, Stochastic, and more
- **Strategy builder** — answer a few questions, get an AI-generated investment analysis in plain English
- **Caloogy Code editor** — write custom JavaScript **or Python** indicators and run them live on the chart; 48 built-in examples (24 JS + 24 Python)
- **AI chat** — describe any strategy in plain English → AI writes the code and runs it instantly
- **Price & indicator alerts** — background monitoring for crypto and US stocks, with Gmail, Discord, and Telegram notifications
- **Light / dark mode** toggle
- **Auto coin switching** — mention ETH or SOL in your AI prompt and the chart switches automatically

---

## US Stock Charts

Caloogy Code supports US stocks and ETFs alongside crypto — no API key required. Data is fetched from the Yahoo Finance public API via a local proxy (no CORS issues).

### Supported symbols

| Category | Symbols |
|----------|---------|
| **Mega-cap tech** | AAPL, TSLA, NVDA, MSFT, GOOGL, AMZN, META, NFLX, AMD, INTC |
| **Finance** | JPM, BAC, GS |
| **Other** | DIS, UBER, XOM, V, MA |
| **Index ETFs** | SPY, QQQ, IWM |
| **Commodity ETF** | GLD |

Click any stock pill in the top bar (AAPL, TSLA, NVDA, MSFT, GOOGL…) or open the **More stocks** dropdown to switch. All timeframes work:

| Timeframe | Data source | History |
|-----------|-------------|---------|
| **1H** | Yahoo Finance 60-minute bars | ~200 days |
| **4H** | 1H bars aggregated every 4 candles | ~730 days |
| **1D** | Yahoo Finance daily bars | Full history |
| **1W** | Yahoo Finance weekly bars | Full history |

> **Note:** Stock data only covers regular trading hours (09:30–16:00 ET, Mon–Fri). Null bars (pre/post-market) are filtered automatically.

All built-in indicators, backtest strategies, Caloogy Code editor, and alerts work identically for stocks and crypto.

### Stock alerts

The Alerts panel and background monitor both support US stocks. Add an alert for AAPL, NVDA, or any other supported symbol exactly the same way as for BTC or ETH — just select the stock from the **Coin** dropdown in the Add Alert form.

---

## Caloogy Code Editor

The built-in code editor lets you write custom indicator scripts that run directly on the current chart. The editor supports two languages — **JavaScript** and **Python** — switchable via the JS / Python tab at the top.

### JavaScript mode

Scripts run in the browser sandbox. You have access to:

```js
// Data arrays (one value per candle)
candles  // [{ts, open, high, low, close, volume}, ...]
closes, highs, lows, opens, volumes  // number[]
times    // unix seconds[]

// Built-in math helpers
sma(array, period)                   // Simple Moving Average
ema(array, period)                   // Exponential Moving Average
calcRsi(array, period)               // RSI
bollinger(array, period, mult)       // {upper, middle, lower}[]
calcMacd(array, fast, slow, sig)     // {macd, signal}[]
calcADX(candles, period)             // {adx, diP, diM}[]
calcVWAP(candles, period)            // number[]
calcOBV(candles)                     // number[]
calcSupertrend(candles, period, mult) // {dir}[]
calcHullMA(array, period)            // number[]
// … and more

// Output functions
plot(name, array, color?)   // overlay a line on the chart
mark(index, "buy"|"sell", text?)  // add an arrow marker
```

Type `caloogy` on any line and press Enter to open the AI chat and describe what you want — the AI will write the script for you.

**24 built-in JS examples** cover: EMA Cross, Triple EMA, ADX Filter, Donchian Turtle, Bollinger Bands, BB Squeeze, Z-Score Reversion, VWAP Deviation, RSI Signal, MACD × RSI, Supertrend + RSI, Hull MA Momentum, OBV Confirmation, Ichimoku Cloud, Linear Regression Channel, RSI Divergence, Chandelier Exit, Heikin-Ashi, Volume-Weighted RSI, Multi-Factor Composite, Williams Fractal + Alligator, Elder Impulse System, Inside Bar Breakout, Mean Reversion Backtest.

### Python mode

Click the **Python** tab to switch to Python. Scripts run server-side via `python3` — you must have Python 3 installed (`python3 --version` to check).

Scripts receive candle data on **stdin** as JSON and must print a JSON result to **stdout**:

```python
import json, sys, math

d       = json.load(sys.stdin)
candles = d["candles"]   # list of {ts, open, high, low, close, volume}
closes  = [c["close"]  for c in candles]
highs   = [c["high"]   for c in candles]
lows    = [c["low"]    for c in candles]
opens   = [c["open"]   for c in candles]
volumes = [c["volume"] for c in candles]
times   = [c["ts"]//1000 for c in candles]   # unix seconds

# --- your analysis here ---

plots = [
    {
        "name":  "My Line",
        "color": "#f59e0b",
        "data":  [{"time": t, "value": v} for t, v in zip(times, my_values) if v is not None],
    }
]
markers = [
    # {"time": t, "position": "belowBar", "color": "#0d9488",
    #  "shape": "arrowUp", "text": "B"}
]

print(json.dumps({"plots": plots, "markers": markers}))
```

**Rules:**
- Use only Python standard library (`json`, `sys`, `math`, etc.) — or any packages you have installed locally
- The final `print(json.dumps(...))` is required; any other stdout output will cause a parse error
- Scripts time out after **10 seconds**
- `stderr` output is shown in the status bar on error

**24 built-in Python examples** mirror all JS examples exactly — select any `🐍` entry from the Examples dropdown.

### Dock the editor to the right panel

Click the **`›`** button (right of the Run button) to move the Caloogy Code editor from the bottom of the page to a right-side panel. Click again to move it back. This frees up vertical space for the chart while keeping the editor visible.

---

## Backtest Strategies

All 19 built-in strategies appear in the **Backtest** panel. Hover over any strategy button to see a one-line description; the panel below the chart shows the entry/exit rules and tunable parameters.

Each strategy is backtested on the candles currently visible on your chart. Green triangles = buy signals, red triangles = sell signals. The equity curve and trade statistics update live as you adjust parameters.

| Strategy | Signal logic | Good for |
|---|---|---|
| **MA Cross** | Buy when the fast EMA crosses above the slow EMA (golden cross); sell on the death cross | Trending markets |
| **RSI Bands** | Buy when RSI climbs back above the oversold line; sell when it drops back below the overbought line | Range-bound markets |
| **BB Bounce** | Buy when price closes back above the lower Bollinger Band; sell when it breaks the upper band | Mean-reverting conditions |
| **MACD Cross** | Buy when the MACD line crosses above the Signal line; sell on the reverse cross | Trend confirmation |
| **Donchian Breakout** | Buy when price breaks above the N-period highest high; sell when it breaks below the N-period lowest low (Turtle Trading style) | Breakout / momentum |
| **Mean Reversion** | Buy when price recovers from X% below its SMA; sell when price crosses back above SMA | Overextended dips |
| **Stochastic** | Buy when %K climbs back above the oversold zone; sell when it drops back below the overbought zone | Short-term reversals |
| **Supertrend** | Buy when the ATR-based Supertrend indicator flips from bearish to bullish; sell on the reverse flip | Trending markets |
| **CCI** | Buy when the Commodity Channel Index rises back above −threshold; sell when it drops back below +threshold | Overbought/oversold |
| **ROC** | Buy when the Rate of Change turns positive (momentum flips up); sell when it turns negative | Momentum breakouts |
| **Ichimoku TK Cross** | Buy when the Tenkan-sen (conversion line) crosses above the Kijun-sen (base line); sell on the reverse cross | Multi-timeframe trends |
| **Parabolic SAR** | Buy when price flips above the SAR dots (bullish phase); sell when it flips below (bearish phase) | Trailing stop trends |
| **Williams %R** | Buy when %R climbs back above the oversold zone (−80); sell when it drops back below the overbought zone (−20) | Short-term reversals |
| **ADX** | Buy when +DI crosses above −DI while ADX confirms a strong trend (> threshold); sell on the reverse DI cross | Strong-trend filters |
| **Keltner Channel** | Buy when price bounces back above the lower Keltner Channel; sell when it breaks above the upper channel | Volatility breakouts |
| **TRIX** | Buy when the triple-smoothed EMA rate of change crosses zero upward; sell on the downward zero-cross | Trend / noise filter |
| **CMO** | Buy when the Chande Momentum Oscillator rises above the negative threshold; sell when it falls below the positive threshold | Momentum reversals |
| **Hull MA Cross** | Buy when the fast Hull Moving Average crosses above the slow Hull MA; sell on the reverse cross | Low-lag trend following |
| **VWAP Deviation** | Buy when price recovers from X% below VWAP; sell when it rises X% above VWAP | Intraday mean reversion |
| **OBV Trend** | Buy when On-Balance Volume crosses above its SMA (volume confirms uptrend); sell on the downward cross | Volume-led breakouts |

> **Tip for beginners:** Start with **MA Cross** (default), then try **RSI Bands** for choppy markets. Use the **Strategy Builder** ("Create your strategy") to get an AI-generated plain-English analysis tailored to your goals and risk tolerance.

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
