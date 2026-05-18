pub fn ema(prices: &[f64], span: usize) -> Vec<Option<f64>> {
    let n = prices.len();
    let mut out = vec![None; n];
    if span == 0 || n < span {
        return out;
    }
    let k = 2.0 / (span as f64 + 1.0);
    // Seed with simple average of first `span` bars
    let seed: f64 = prices[..span].iter().sum::<f64>() / span as f64;
    let mut prev = seed;
    out[span - 1] = Some(prev);
    for i in span..n {
        prev = prices[i] * k + prev * (1.0 - k);
        out[i] = Some(prev);
    }
    out
}

pub fn sma(prices: &[f64], period: usize) -> Vec<Option<f64>> {
    let n = prices.len();
    let mut out = vec![None; n];
    if period == 0 || n < period {
        return out;
    }
    let mut window_sum: f64 = prices[..period].iter().sum();
    out[period - 1] = Some(window_sum / period as f64);
    for i in period..n {
        window_sum += prices[i] - prices[i - period];
        out[i] = Some(window_sum / period as f64);
    }
    out
}

pub fn rsi(prices: &[f64], period: usize) -> Vec<Option<f64>> {
    let n = prices.len();
    let mut out = vec![None; n];
    if period == 0 || n <= period {
        return out;
    }
    // Wilder's smoothed RSI
    let mut avg_gain = 0.0_f64;
    let mut avg_loss = 0.0_f64;
    for i in 1..=period {
        let diff = prices[i] - prices[i - 1];
        if diff > 0.0 {
            avg_gain += diff;
        } else {
            avg_loss += -diff;
        }
    }
    avg_gain /= period as f64;
    avg_loss /= period as f64;

    let rs = if avg_loss < 1e-12 { 1e9 } else { avg_gain / avg_loss };
    out[period] = Some(100.0 - 100.0 / (1.0 + rs));

    for i in (period + 1)..n {
        let diff = prices[i] - prices[i - 1];
        let gain = if diff > 0.0 { diff } else { 0.0 };
        let loss = if diff < 0.0 { -diff } else { 0.0 };
        avg_gain = (avg_gain * (period as f64 - 1.0) + gain) / period as f64;
        avg_loss = (avg_loss * (period as f64 - 1.0) + loss) / period as f64;
        let rs = if avg_loss < 1e-12 { 1e9 } else { avg_gain / avg_loss };
        out[i] = Some(100.0 - 100.0 / (1.0 + rs));
    }
    out
}

/// Returns (macd_line, signal_line) both as Vec<Option<f64>>
pub fn macd(
    prices: &[f64],
    fast: usize,
    slow: usize,
    sig: usize,
) -> (Vec<Option<f64>>, Vec<Option<f64>>) {
    let n = prices.len();
    let fast_ema = ema(prices, fast);
    let slow_ema = ema(prices, slow);

    let mut macd_line = vec![None; n];
    for i in 0..n {
        if let (Some(f), Some(s)) = (fast_ema[i], slow_ema[i]) {
            macd_line[i] = Some(f - s);
        }
    }

    // Signal line = EMA of macd_line (only over valid values)
    let mut signal_line = vec![None; n];
    let valid_macd: Vec<f64> = macd_line.iter().filter_map(|x| *x).collect();
    let valid_indices: Vec<usize> = macd_line
        .iter()
        .enumerate()
        .filter_map(|(i, x)| x.map(|_| i))
        .collect();

    if valid_macd.len() >= sig {
        let sig_ema = ema(&valid_macd, sig);
        for (j, &orig_idx) in valid_indices.iter().enumerate() {
            if let Some(v) = sig_ema[j] {
                signal_line[orig_idx] = Some(v);
            }
        }
    }

    (macd_line, signal_line)
}

/// Bollinger Bands: returns (upper, middle, lower) as Vec<Option<f64>> each
pub fn bollinger(
    prices: &[f64],
    period: usize,
    mult: f64,
) -> (Vec<Option<f64>>, Vec<Option<f64>>, Vec<Option<f64>>) {
    let n = prices.len();
    let mut upper = vec![None; n];
    let mut middle = vec![None; n];
    let mut lower = vec![None; n];
    if period == 0 || n < period {
        return (upper, middle, lower);
    }
    for i in (period - 1)..n {
        let slice = &prices[(i + 1 - period)..=i];
        let mean = slice.iter().sum::<f64>() / period as f64;
        let variance = slice.iter().map(|p| (p - mean).powi(2)).sum::<f64>() / period as f64;
        let std = variance.sqrt();
        upper[i] = Some(mean + mult * std);
        middle[i] = Some(mean);
        lower[i] = Some(mean - mult * std);
    }
    (upper, middle, lower)
}
