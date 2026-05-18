use std::collections::HashMap;
use pyo3::prelude::*;
use pyo3::types::{PyDict, PyList};

use crate::bar::Bar;
use crate::portfolio::Portfolio;
use crate::analytics;
use crate::indicators;

fn get_f64(params: &HashMap<String, f64>, key: &str, default: f64) -> f64 {
    params.get(key).copied().unwrap_or(default)
}

pub fn run(
    py: Python<'_>,
    bars: &[Bar],
    strategy: &str,
    params: &HashMap<String, f64>,
    initial_cash: f64,
    taker_fee: f64,
    slippage: f64,
    ann_factor: f64,
) -> PyResult<PyObject> {
    let n = bars.len();
    let closes: Vec<f64> = bars.iter().map(|b| b.close).collect();

    // Compute signals: signal[i] means at end of bar[i] we have a decision.
    // Execution happens at bar[i+1].open (no lookahead).
    // signal: 1 = enter long, -1 = exit long, 0 = nothing
    let mut signals: Vec<i8> = vec![0; n];

    match strategy {
        "ma_cross" => {
            let fast = get_f64(params, "fast", 9.0) as usize;
            let slow = get_f64(params, "slow", 21.0) as usize;
            let fast_ema = indicators::ema(&closes, fast);
            let slow_ema = indicators::ema(&closes, slow);
            for i in 1..n {
                let (f0, s0) = match (fast_ema[i - 1], slow_ema[i - 1]) {
                    (Some(a), Some(b)) => (a, b),
                    _ => continue,
                };
                let (f1, s1) = match (fast_ema[i], slow_ema[i]) {
                    (Some(a), Some(b)) => (a, b),
                    _ => continue,
                };
                if f1 > s1 && f0 <= s0 {
                    signals[i] = 1;
                } else if f1 < s1 && f0 >= s0 {
                    signals[i] = -1;
                }
            }
        }
        "rsi_bands" => {
            let period = get_f64(params, "period", 14.0) as usize;
            let ob = get_f64(params, "ob", 70.0);
            let os = get_f64(params, "os", 30.0);
            let rsi_vals = indicators::rsi(&closes, period);
            for i in 1..n {
                let (r0, r1) = match (rsi_vals[i - 1], rsi_vals[i]) {
                    (Some(a), Some(b)) => (a, b),
                    _ => continue,
                };
                if r0 <= os && r1 > os {
                    signals[i] = 1;
                } else if r0 >= ob && r1 < ob {
                    signals[i] = -1;
                }
            }
        }
        "bb_bounce" => {
            let period = get_f64(params, "period", 20.0) as usize;
            let (upper, _mid, lower) = indicators::bollinger(&closes, period, 2.0);
            for i in 1..n {
                let (u0, l0) = match (upper[i - 1], lower[i - 1]) {
                    (Some(a), Some(b)) => (a, b),
                    _ => continue,
                };
                let (u1, l1) = match (upper[i], lower[i]) {
                    (Some(a), Some(b)) => (a, b),
                    _ => continue,
                };
                if closes[i - 1] < l0 && closes[i] >= l1 {
                    signals[i] = 1;
                } else if closes[i - 1] < u0 && closes[i] >= u1 {
                    signals[i] = -1;
                }
            }
        }
        "macd" => {
            let fast = get_f64(params, "fast", 12.0) as usize;
            let slow = get_f64(params, "slow", 26.0) as usize;
            let sig_period = get_f64(params, "sig", 9.0) as usize;
            let (macd_line, signal_line) = indicators::macd(&closes, fast, slow, sig_period);
            for i in 1..n {
                let (m0, s0) = match (macd_line[i - 1], signal_line[i - 1]) {
                    (Some(a), Some(b)) => (a, b),
                    _ => continue,
                };
                let (m1, s1) = match (macd_line[i], signal_line[i]) {
                    (Some(a), Some(b)) => (a, b),
                    _ => continue,
                };
                if m1 > s1 && m0 <= s0 {
                    signals[i] = 1;
                } else if m1 < s1 && m0 >= s0 {
                    signals[i] = -1;
                }
            }
        }
        _ => {
            return Err(pyo3::exceptions::PyValueError::new_err(format!(
                "Unknown strategy: {}. Supported: ma_cross, rsi_bands, bb_bounce, macd",
                strategy
            )));
        }
    }

    // Execute signals: signal at bar[i] executes at bar[i+1].open
    let mut portfolio = Portfolio::new(initial_cash, taker_fee, slippage);

    for i in 0..n {
        // Execute signal from previous bar at this bar's open (no lookahead)
        if i > 0 {
            match signals[i - 1] {
                1 => portfolio.open_long(bars[i].open, bars[i].ts),
                -1 => portfolio.close_long(bars[i].open, bars[i].ts),
                _ => {}
            }
        }
        // Record equity at close of this bar (after any trade at open)
        portfolio.record_equity(bars[i].close, bars[i].ts / 1000);
    }

    // Close any open position at last bar's close
    if portfolio.in_trade && n > 0 {
        let last = &bars[n - 1];
        portfolio.close_long(last.close, last.ts);
    }

    let metrics = analytics::compute(&portfolio.equity_curve, &portfolio.trades, ann_factor);

    // Build Python result dict
    let result = PyDict::new_bound(py);
    result.set_item("total_return", round6(metrics.total_return))?;
    result.set_item("sharpe", round6(metrics.sharpe))?;
    result.set_item("max_drawdown", round6(metrics.max_drawdown))?;
    result.set_item("calmar", round6(metrics.calmar))?;
    result.set_item("win_rate", round6(metrics.win_rate))?;
    result.set_item("trade_count", metrics.trade_count)?;
    result.set_item("profit_factor", round6(metrics.profit_factor))?;
    result.set_item("sortino", round6(metrics.sortino))?;

    // equity_curve: list of {time, value}
    let eq_list = PyList::empty_bound(py);
    for pt in &portfolio.equity_curve {
        let d = PyDict::new_bound(py);
        d.set_item("time", pt.time)?;
        d.set_item("value", round6(pt.value))?;
        eq_list.append(d)?;
    }
    result.set_item("equity_curve", eq_list)?;

    // trades: list of {entry_ts, exit_ts, entry_price, exit_price, pnl_pct, fee, side}
    let trades_list = PyList::empty_bound(py);
    for t in &portfolio.trades {
        let d = PyDict::new_bound(py);
        d.set_item("entry_ts", t.entry_ts / 1000)?;
        d.set_item("exit_ts", t.exit_ts / 1000)?;
        d.set_item("entry_price", round6(t.entry_price))?;
        d.set_item("exit_price", round6(t.exit_price))?;
        d.set_item("pnl_pct", round6(t.pnl_pct))?;
        d.set_item("fee", round6(t.fee))?;
        d.set_item("side", t.side.clone())?;
        trades_list.append(d)?;
    }
    result.set_item("trades", trades_list)?;

    Ok(result.into())
}

fn round6(v: f64) -> f64 {
    (v * 1_000_000.0).round() / 1_000_000.0
}
