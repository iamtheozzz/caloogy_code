"""Persistent Python worker for Caloogy backtest engine.

Node.js spawns this once at server start and communicates via newline-delimited JSON on stdin/stdout.

Protocol (newline-delimited JSON):
  Node -> Worker: {"cmd":"backtest","_id":42,"symbol":"BTCUSDT","interval":"1H",
                   "strategy":"ma_cross","params":{"fast":9,"slow":21},
                   "initial_cash":10000,"taker_fee":0.0005,"slippage":0.0001}
  Worker -> Node: {"_id":42,"type":"progress","msg":"Loading bars..."}
                  {"_id":42,"type":"result","total_return":12.5,...}

  Node -> Worker: {"cmd":"ping","_id":0}
  Worker -> Node: {"_id":0,"type":"pong"}
"""

import os
import sys
import json
import math
import time
import traceback

# ── Rust engine (optional) ─────────────────────────────────────────────────────
try:
    import caloogy_engine as _rust
    _RUST_AVAILABLE = True
except ImportError:
    _rust = None
    _RUST_AVAILABLE = False

# ── DuckDB path ────────────────────────────────────────────────────────────────
_DB_PATH = os.environ.get("CALOOGY_DB_PATH", os.path.expanduser("~/.caloogy/market.duckdb"))

# ── Global request context (for emit helper) ──────────────────────────────────
_current_id = None


def emit(obj: dict) -> None:
    """Write a JSON object to stdout, injecting _id if inside a request."""
    if _current_id is not None and "_id" not in obj:
        obj = dict(obj)
        obj["_id"] = _current_id
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


# ── DuckDB loader with retry ───────────────────────────────────────────────────

def _load_bars(symbol: str, interval: str) -> list:
    """Load OHLCV bars from DuckDB. Retries up to 5s if DB is locked/missing."""
    deadline = time.time() + 5.0
    last_err = None
    while time.time() < deadline:
        try:
            import duckdb
            conn = duckdb.connect(_DB_PATH, read_only=True)
            rows = conn.execute(
                "SELECT ts, open, high, low, close, volume "
                "FROM candles WHERE symbol=? AND interval=? ORDER BY ts",
                [symbol, interval],
            ).fetchall()
            conn.close()
            bars = []
            for row in rows:
                bars.append({
                    "ts": int(row[0]),
                    "open": float(row[1]),
                    "high": float(row[2]),
                    "low": float(row[3]),
                    "close": float(row[4]),
                    "volume": float(row[5]),
                })
            return bars
        except Exception as exc:
            last_err = exc
            time.sleep(0.2)
    raise RuntimeError(f"Could not load bars from DuckDB after 5s: {last_err}")


# ── Pure Python indicator helpers ──────────────────────────────────────────────

def _ema(prices: list, span: int) -> list:
    n = len(prices)
    out = [None] * n
    if span <= 0 or n < span:
        return out
    k = 2.0 / (span + 1)
    prev = sum(prices[:span]) / span
    out[span - 1] = prev
    for i in range(span, n):
        prev = prices[i] * k + prev * (1.0 - k)
        out[i] = prev
    return out


def _rsi(prices: list, period: int = 14) -> list:
    n = len(prices)
    out = [None] * n
    if period <= 0 or n <= period:
        return out
    avg_gain = 0.0
    avg_loss = 0.0
    for i in range(1, period + 1):
        d = prices[i] - prices[i - 1]
        if d > 0:
            avg_gain += d
        else:
            avg_loss += -d
    avg_gain /= period
    avg_loss /= period
    rs = avg_gain / avg_loss if avg_loss > 1e-12 else 1e9
    out[period] = 100.0 - 100.0 / (1.0 + rs)
    for i in range(period + 1, n):
        d = prices[i] - prices[i - 1]
        gain = d if d > 0 else 0.0
        loss = -d if d < 0 else 0.0
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period
        rs = avg_gain / avg_loss if avg_loss > 1e-12 else 1e9
        out[i] = 100.0 - 100.0 / (1.0 + rs)
    return out


def _bollinger(prices: list, period: int = 20, mult: float = 2.0):
    n = len(prices)
    upper = [None] * n
    middle = [None] * n
    lower = [None] * n
    if period <= 0 or n < period:
        return upper, middle, lower
    for i in range(period - 1, n):
        sl = prices[i + 1 - period: i + 1]
        mean = sum(sl) / period
        std = math.sqrt(sum((p - mean) ** 2 for p in sl) / period)
        upper[i] = mean + mult * std
        middle[i] = mean
        lower[i] = mean - mult * std
    return upper, middle, lower


def _macd(prices: list, fast: int = 12, slow: int = 26, sig: int = 9):
    n = len(prices)
    fast_ema = _ema(prices, fast)
    slow_ema = _ema(prices, slow)
    macd_line = [None] * n
    for i in range(n):
        if fast_ema[i] is not None and slow_ema[i] is not None:
            macd_line[i] = fast_ema[i] - slow_ema[i]
    valid_vals = [v for v in macd_line if v is not None]
    valid_idx = [i for i, v in enumerate(macd_line) if v is not None]
    signal_line = [None] * n
    if len(valid_vals) >= sig:
        sig_ema = _ema(valid_vals, sig)
        for j, orig_i in enumerate(valid_idx):
            if sig_ema[j] is not None:
                signal_line[orig_i] = sig_ema[j]
    return macd_line, signal_line


# ── Pure Python fallback backtest ─────────────────────────────────────────────

def _py_backtest(
    bars: list,
    strategy: str,
    params: dict,
    initial_cash: float,
    taker_fee: float,
    slippage: float,
    ann_factor: float,
) -> dict:
    n = len(bars)
    closes = [b["close"] for b in bars]
    signals = [0] * n  # 1=buy, -1=sell, 0=hold

    if strategy == "ma_cross":
        fast = int(params.get("fast", 9))
        slow = int(params.get("slow", 21))
        fe = _ema(closes, fast)
        se = _ema(closes, slow)
        for i in range(1, n):
            if fe[i] is None or fe[i - 1] is None or se[i] is None or se[i - 1] is None:
                continue
            if fe[i] > se[i] and fe[i - 1] <= se[i - 1]:
                signals[i] = 1
            elif fe[i] < se[i] and fe[i - 1] >= se[i - 1]:
                signals[i] = -1

    elif strategy == "rsi_bands":
        period = int(params.get("period", 14))
        ob = float(params.get("ob", 70.0))
        os_ = float(params.get("os", 30.0))
        rsi_vals = _rsi(closes, period)
        for i in range(1, n):
            r0, r1 = rsi_vals[i - 1], rsi_vals[i]
            if r0 is None or r1 is None:
                continue
            if r0 <= os_ and r1 > os_:
                signals[i] = 1
            elif r0 >= ob and r1 < ob:
                signals[i] = -1

    elif strategy == "bb_bounce":
        period = int(params.get("period", 20))
        upper, _, lower = _bollinger(closes, period, 2.0)
        for i in range(1, n):
            if upper[i] is None or lower[i] is None or upper[i - 1] is None or lower[i - 1] is None:
                continue
            if closes[i - 1] < lower[i - 1] and closes[i] >= lower[i]:
                signals[i] = 1
            elif closes[i - 1] < upper[i - 1] and closes[i] >= upper[i]:
                signals[i] = -1

    elif strategy == "macd":
        fast = int(params.get("fast", 12))
        slow = int(params.get("slow", 26))
        sig_p = int(params.get("sig", 9))
        macd_line, signal_line = _macd(closes, fast, slow, sig_p)
        for i in range(1, n):
            m0, s0 = macd_line[i - 1], signal_line[i - 1]
            m1, s1 = macd_line[i], signal_line[i]
            if m0 is None or s0 is None or m1 is None or s1 is None:
                continue
            if m1 > s1 and m0 <= s0:
                signals[i] = 1
            elif m1 < s1 and m0 >= s0:
                signals[i] = -1
    else:
        raise ValueError(f"Unknown strategy: {strategy}")

    # Simulate portfolio
    # signal[i] executes at bar[i+1].open
    cash = initial_cash
    position = 0.0
    entry_price = 0.0
    entry_ts = 0
    in_trade = False
    trades = []
    equity_curve = []

    for i in range(n):
        bar = bars[i]
        ts_sec = bar["ts"] // 1000

        # Execute signal from previous bar at this bar's open
        if i > 0:
            sig = signals[i - 1]
            exec_price_buy = bar["open"] * (1.0 + slippage)
            exec_price_sell = bar["open"] * (1.0 - slippage)

            if sig == 1 and not in_trade:
                fee = cash * taker_fee
                cash -= fee
                position = cash / exec_price_buy
                cash = 0.0
                entry_price = exec_price_buy
                entry_ts = bar["ts"]
                in_trade = True

            elif sig == -1 and in_trade:
                gross = position * exec_price_sell
                fee = gross * taker_fee
                net = gross - fee
                pnl_pct = (exec_price_sell / entry_price - 1.0) * 100.0
                total_fee = entry_price * position * taker_fee + fee
                trades.append({
                    "entry_ts": entry_ts // 1000,
                    "exit_ts": bar["ts"] // 1000,
                    "entry_price": round(entry_price, 6),
                    "exit_price": round(exec_price_sell, 6),
                    "pnl_pct": round(pnl_pct, 6),
                    "fee": round(total_fee, 6),
                    "side": "long",
                })
                cash = net
                position = 0.0
                in_trade = False

        # Record equity using close price
        eq_value = position * bar["close"] if in_trade else cash
        equity_curve.append({"time": ts_sec, "value": round(eq_value, 6)})

    # Close open position at last bar's close
    if in_trade and n > 0:
        last = bars[n - 1]
        exec_price = last["close"] * (1.0 - slippage)
        gross = position * exec_price
        fee = gross * taker_fee
        net = gross - fee
        pnl_pct = (exec_price / entry_price - 1.0) * 100.0
        total_fee = entry_price * position * taker_fee + fee
        trades.append({
            "entry_ts": entry_ts // 1000,
            "exit_ts": last["ts"] // 1000,
            "entry_price": round(entry_price, 6),
            "exit_price": round(exec_price, 6),
            "pnl_pct": round(pnl_pct, 6),
            "fee": round(total_fee, 6),
            "side": "long",
        })
        cash = net
        equity_curve[-1]["value"] = round(cash, 6)

    # Analytics
    nec = len(equity_curve)
    total_return = 0.0
    if nec > 0 and equity_curve[0]["value"] > 0:
        total_return = (equity_curve[-1]["value"] / equity_curve[0]["value"] - 1.0) * 100.0

    returns = []
    for i in range(1, nec):
        prev = equity_curve[i - 1]["value"]
        if prev > 0:
            returns.append(equity_curve[i]["value"] / prev - 1.0)

    sharpe = 0.0
    sortino = 0.0
    if len(returns) > 1:
        mean_r = sum(returns) / len(returns)
        std_r = math.sqrt(sum((r - mean_r) ** 2 for r in returns) / len(returns))
        if std_r > 1e-12:
            sharpe = mean_r / std_r * math.sqrt(ann_factor)
        down_var = sum(r ** 2 for r in returns if r < 0) / len(returns)
        down_std = math.sqrt(down_var)
        if down_std > 1e-12:
            sortino = mean_r / down_std * math.sqrt(ann_factor)

    peak = float("-inf")
    max_drawdown = 0.0
    for pt in equity_curve:
        v = pt["value"]
        if v > peak:
            peak = v
        if peak > 0:
            dd = (peak - v) / peak * 100.0
            if dd > max_drawdown:
                max_drawdown = dd

    calmar = total_return / max_drawdown if max_drawdown > 1e-9 else 0.0

    trade_count = len(trades)
    wins = sum(1 for t in trades if t["pnl_pct"] > 0)
    win_rate = wins / trade_count * 100.0 if trade_count > 0 else 0.0

    gross_profit = sum(t["pnl_pct"] for t in trades if t["pnl_pct"] > 0)
    gross_loss = sum(abs(t["pnl_pct"]) for t in trades if t["pnl_pct"] <= 0)
    if gross_loss > 1e-9:
        profit_factor = gross_profit / gross_loss
    elif gross_profit > 0:
        profit_factor = float("inf")
    else:
        profit_factor = 0.0

    return {
        "total_return": round(total_return, 6),
        "sharpe": round(sharpe, 6),
        "max_drawdown": round(max_drawdown, 6),
        "calmar": round(calmar, 6),
        "win_rate": round(win_rate, 6),
        "trade_count": trade_count,
        "profit_factor": round(profit_factor, 6) if math.isfinite(profit_factor) else profit_factor,
        "sortino": round(sortino, 6),
        "equity_curve": equity_curve,
        "trades": trades,
    }


# ── Run using Rust engine ──────────────────────────────────────────────────────

def _rust_backtest(
    bars: list,
    strategy: str,
    params: dict,
    initial_cash: float,
    taker_fee: float,
    slippage: float,
    ann_factor: float,
) -> dict:
    rust_bars = [
        _rust.Bar(
            b["ts"],
            b["open"],
            b["high"],
            b["low"],
            b["close"],
            b["volume"],
        )
        for b in bars
    ]
    float_params = {k: float(v) for k, v in params.items()}
    result = _rust.run_backtest(
        rust_bars,
        strategy,
        float_params,
        initial_cash,
        taker_fee,
        slippage,
        ann_factor,
    )
    return result


# ── Interval -> ann_factor mapping ────────────────────────────────────────────

_ANN_FACTOR = {
    "1m": 525600,
    "3m": 175200,
    "5m": 105120,
    "15m": 35040,
    "30m": 17520,
    "1H": 8760,
    "2H": 4380,
    "4H": 2190,
    "6H": 1460,
    "8H": 1095,
    "12H": 730,
    "1D": 365,
    "3D": 122,
    "1W": 52,
    "1M": 12,
}


def _ann_factor(interval: str) -> float:
    return float(_ANN_FACTOR.get(interval, 365))


# ── Command handlers ──────────────────────────────────────────────────────────

def handle_backtest(req: dict) -> None:
    symbol = req.get("symbol", "")
    interval = req.get("interval", "1D")
    strategy = req.get("strategy", "ma_cross")
    params = req.get("params", {})
    initial_cash = float(req.get("initial_cash", 10000))
    taker_fee = float(req.get("taker_fee", 0.001))
    slippage = float(req.get("slippage", 0.0005))
    ann_factor = _ann_factor(interval)

    emit({"type": "progress", "msg": "Loading bars..."})

    bars = _load_bars(symbol, interval)
    if not bars:
        emit({"type": "error", "msg": f"No data found for {symbol}/{interval}"})
        return

    bar_count = len(bars)
    engine_name = "rust engine" if _RUST_AVAILABLE else "python engine"
    emit({"type": "progress", "msg": f"Running backtest on {bar_count} bars ({engine_name})..."})

    if _RUST_AVAILABLE:
        result = _rust_backtest(bars, strategy, params, initial_cash, taker_fee, slippage, ann_factor)
    else:
        result = _py_backtest(bars, strategy, params, initial_cash, taker_fee, slippage, ann_factor)

    out = dict(result)
    out["type"] = "result"
    emit(out)


def handle_ping(_req: dict) -> None:
    emit({"type": "pong"})


# ── Main loop ─────────────────────────────────────────────────────────────────

def main() -> None:
    global _current_id

    for raw_line in sys.stdin:
        raw_line = raw_line.strip()
        if not raw_line:
            continue

        try:
            req = json.loads(raw_line)
        except json.JSONDecodeError as exc:
            sys.stdout.write(json.dumps({"type": "error", "msg": f"JSON parse error: {exc}"}) + "\n")
            sys.stdout.flush()
            continue

        _current_id = req.get("_id")

        try:
            cmd = req.get("cmd", "")
            if cmd == "ping":
                handle_ping(req)
            elif cmd == "backtest":
                handle_backtest(req)
            else:
                emit({"type": "error", "msg": f"Unknown command: {cmd}"})
        except Exception as exc:
            emit({"type": "error", "msg": str(exc), "traceback": traceback.format_exc()})
        finally:
            _current_id = None


if __name__ == "__main__":
    main()
