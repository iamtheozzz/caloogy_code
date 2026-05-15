"""Caloogy Python utilities — auto-installed to ~/.caloogy/caloogy_utils.py on startup."""
import os, json, math

_DB_PATH = os.environ.get('CALOOGY_DB_PATH', os.path.expanduser('~/.caloogy/market.duckdb'))


def load_db(symbol, interval='1D', limit=None):
    """Load OHLCV candles from local DB. Returns pandas DataFrame indexed by datetime.
    Requires: pip install duckdb pandas"""
    import duckdb, pandas as pd
    conn = duckdb.connect(_DB_PATH, read_only=True)
    sql  = ("SELECT ts,open,high,low,close,volume FROM candles "
            "WHERE symbol=? AND interval=? ORDER BY ts")
    args = [symbol, interval]
    if limit:
        sql += f" LIMIT {int(limit)}"
    df = conn.execute(sql, args).df()
    conn.close()
    if df.empty:
        return df
    df.index = pd.to_datetime(df['ts'], unit='ms', utc=True).dt.tz_localize(None)
    df.index.name = 'date'
    return df.drop(columns=['ts'])


def list_symbols():
    """Return DataFrame of all symbol/interval combos in the DB."""
    import duckdb, pandas as pd
    conn = duckdb.connect(_DB_PATH, read_only=True)
    df   = conn.execute(
        "SELECT symbol, interval, source, row_count, "
        "first_ts/1000 as first_unix, last_ts/1000 as last_unix "
        "FROM sync_meta ORDER BY symbol, interval"
    ).df()
    conn.close()
    return df


def clean_candles(df):
    """Drop null-close rows, deduplicate index, sort ascending."""
    df = df[df['close'].notna()]
    df = df[~df.index.duplicated(keep='last')]
    return df.sort_index()


def resample_ohlcv(df, rule):
    """Resample OHLCV DataFrame to a lower frequency.
    rule examples: '4h', '1D', '1W' (pandas offset aliases)"""
    return df.resample(rule).agg({
        'open':   'first',
        'high':   'max',
        'low':    'min',
        'close':  'last',
        'volume': 'sum',
    }).dropna(subset=['close'])


class SimpleBacktest:
    """Vectorized backtest. signal: pandas Series of +1 (long), -1 (short), 0 (flat).
    Applies signal on the NEXT bar's close (avoids look-ahead).
    fee: one-way cost as a fraction (default 0.001 = 0.1%)."""

    def __init__(self, df, signal, fee=0.001):
        self.df     = df.copy()
        self.signal = signal.shift(1).fillna(0)
        self.fee    = fee

    def run(self):
        import pandas as pd
        ret    = self.df['close'].pct_change().fillna(0)
        strat  = ret * self.signal
        costs  = self.signal.diff().abs().fillna(0) * self.fee
        net    = strat - costs
        equity = (1 + net).cumprod()
        dd     = equity / equity.cummax() - 1

        n      = max(len(net), 1)
        annual = min(n, 252)
        sharpe = float(net.mean() / net.std() * (annual ** 0.5)) if net.std() > 1e-9 else 0.0

        return {
            'sharpe':    round(sharpe, 3),
            'total_ret': round(float(equity.iloc[-1] - 1), 4),
            'max_dd':    round(float(dd.min()), 4),
            'win_rate':  round(float((net > 0).sum() / n), 3),
            'n_trades':  int(self.signal.diff().abs().sum() / 2),
            'equity':    [round(v, 6) for v in equity.tolist()],
        }
