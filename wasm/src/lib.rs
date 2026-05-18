use wasm_bindgen::prelude::*;

// ── EMA ──────────────────────────────────────────────────────────────────────
/// Exponential moving average. Returns NaN for indices before the first valid
/// value (i.e., indices 0..period-1).
#[wasm_bindgen]
pub fn ema(prices: &[f64], span: usize) -> Vec<f64> {
    let n = prices.len();
    let mut out = vec![f64::NAN; n];
    if span == 0 || n < span {
        return out;
    }
    let k = 2.0 / (span as f64 + 1.0);
    // Seed with simple average of first `span` values
    let seed: f64 = prices[..span].iter().sum::<f64>() / span as f64;
    let mut prev = seed;
    out[span - 1] = prev;
    for i in span..n {
        prev = prices[i] * k + prev * (1.0 - k);
        out[i] = prev;
    }
    out
}

// ── SMA ──────────────────────────────────────────────────────────────────────
/// Simple moving average. Returns NaN for indices before period-1.
#[wasm_bindgen]
pub fn sma(prices: &[f64], period: usize) -> Vec<f64> {
    let n = prices.len();
    let mut out = vec![f64::NAN; n];
    if period == 0 || n < period {
        return out;
    }
    let mut window_sum: f64 = prices[..period].iter().sum();
    out[period - 1] = window_sum / period as f64;
    for i in period..n {
        window_sum += prices[i] - prices[i - period];
        out[i] = window_sum / period as f64;
    }
    out
}

// ── RSI ──────────────────────────────────────────────────────────────────────
/// Wilder's RSI. Returns NaN for the first `period` indices.
#[wasm_bindgen]
pub fn rsi(prices: &[f64], period: usize) -> Vec<f64> {
    let n = prices.len();
    let mut out = vec![f64::NAN; n];
    if period == 0 || n <= period {
        return out;
    }
    // Seed: average gain/loss over first `period` differences
    let mut avg_gain = 0.0f64;
    let mut avg_loss = 0.0f64;
    for i in 1..=period {
        let d = prices[i] - prices[i - 1];
        if d > 0.0 { avg_gain += d; } else { avg_loss -= d; }
    }
    avg_gain /= period as f64;
    avg_loss /= period as f64;
    let rs = if avg_loss == 0.0 { 1e9 } else { avg_gain / avg_loss };
    out[period] = 100.0 - 100.0 / (1.0 + rs);

    for i in (period + 1)..n {
        let d = prices[i] - prices[i - 1];
        avg_gain = (avg_gain * (period as f64 - 1.0) + d.max(0.0)) / period as f64;
        avg_loss = (avg_loss * (period as f64 - 1.0) + (-d).max(0.0)) / period as f64;
        let rs = if avg_loss == 0.0 { 1e9 } else { avg_gain / avg_loss };
        out[i] = 100.0 - 100.0 / (1.0 + rs);
    }
    out
}

// ── MACD ─────────────────────────────────────────────────────────────────────
/// Returns interleaved [macd0, signal0, hist0, macd1, signal1, hist1, ...]
/// NaN is used where a value is not yet defined.
#[wasm_bindgen]
pub fn macd_line(prices: &[f64], fast: usize, slow: usize, signal: usize) -> Vec<f64> {
    let n = prices.len();
    let fast_ema = ema(prices, fast);
    let slow_ema = ema(prices, slow);

    // MACD line = fast EMA - slow EMA
    let macd: Vec<f64> = (0..n)
        .map(|i| {
            if fast_ema[i].is_nan() || slow_ema[i].is_nan() {
                f64::NAN
            } else {
                fast_ema[i] - slow_ema[i]
            }
        })
        .collect();

    // Signal line: EMA of MACD (skipping NaN entries, counting from first valid)
    let mut sig_out = vec![f64::NAN; n];
    let k = 2.0 / (signal as f64 + 1.0);
    let mut prev: Option<f64> = None;
    let mut count = 0usize;
    for i in 0..n {
        if macd[i].is_nan() {
            continue;
        }
        count += 1;
        prev = Some(match prev {
            None => macd[i],
            Some(p) => macd[i] * k + p * (1.0 - k),
        });
        if count >= signal {
            sig_out[i] = prev.unwrap();
        }
    }

    // Interleave [macd, signal, histogram]
    let mut out = vec![f64::NAN; n * 3];
    for i in 0..n {
        out[i * 3]     = macd[i];
        out[i * 3 + 1] = sig_out[i];
        out[i * 3 + 2] = if macd[i].is_nan() || sig_out[i].is_nan() {
            f64::NAN
        } else {
            macd[i] - sig_out[i]
        };
    }
    out
}

// ── Bollinger Bands ───────────────────────────────────────────────────────────
/// Returns interleaved [upper0, mid0, lower0, upper1, mid1, lower1, ...]
/// NaN for entries before period-1.
#[wasm_bindgen]
pub fn bollinger_bands(prices: &[f64], period: usize, mult: f64) -> Vec<f64> {
    let n = prices.len();
    let mut out = vec![f64::NAN; n * 3];
    if period == 0 || n < period {
        return out;
    }
    for i in (period - 1)..n {
        let slice = &prices[(i + 1 - period)..=i];
        let mean: f64 = slice.iter().sum::<f64>() / period as f64;
        let variance: f64 = slice.iter().map(|&x| (x - mean) * (x - mean)).sum::<f64>() / period as f64;
        let std = variance.sqrt();
        out[i * 3]     = mean + mult * std;
        out[i * 3 + 1] = mean;
        out[i * 3 + 2] = mean - mult * std;
    }
    out
}

// ── ATR ───────────────────────────────────────────────────────────────────────
/// Wilder's ATR (RMA smoothing). Returns NaN for indices before period-1.
#[wasm_bindgen]
pub fn atr_values(highs: &[f64], lows: &[f64], closes: &[f64], period: usize) -> Vec<f64> {
    let n = highs.len();
    let mut out = vec![f64::NAN; n];
    if period == 0 || n < period || lows.len() < n || closes.len() < n {
        return out;
    }
    // True range for each bar
    let tr: Vec<f64> = (0..n)
        .map(|i| {
            let hl = highs[i] - lows[i];
            if i == 0 {
                hl
            } else {
                let pc = closes[i - 1];
                hl.max((highs[i] - pc).abs()).max((lows[i] - pc).abs())
            }
        })
        .collect();

    // Seed: simple average of first `period` true ranges
    let seed: f64 = tr[..period].iter().sum::<f64>() / period as f64;
    out[period - 1] = seed;
    for i in period..n {
        out[i] = (out[i - 1] * (period as f64 - 1.0) + tr[i]) / period as f64;
    }
    out
}
