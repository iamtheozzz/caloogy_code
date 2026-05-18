use crate::portfolio::{EquityPoint, Trade};

pub struct Metrics {
    pub total_return: f64,
    pub sharpe: f64,
    pub max_drawdown: f64,
    pub calmar: f64,
    pub win_rate: f64,
    pub trade_count: usize,
    pub profit_factor: f64,
    pub sortino: f64,
}

pub fn compute(
    equity_curve: &[EquityPoint],
    trades: &[Trade],
    ann_factor: f64,
) -> Metrics {
    let n = equity_curve.len();

    let total_return = if n > 0 && equity_curve[0].value > 0.0 {
        (equity_curve[n - 1].value / equity_curve[0].value - 1.0) * 100.0
    } else {
        0.0
    };

    // Compute returns from equity curve
    let mut returns: Vec<f64> = Vec::with_capacity(n.saturating_sub(1));
    for i in 1..n {
        let prev = equity_curve[i - 1].value;
        if prev > 0.0 {
            returns.push(equity_curve[i].value / prev - 1.0);
        }
    }

    let sharpe = if returns.len() > 1 {
        let mean = returns.iter().sum::<f64>() / returns.len() as f64;
        let variance = returns.iter().map(|r| (r - mean).powi(2)).sum::<f64>() / returns.len() as f64;
        let std_dev = variance.sqrt();
        if std_dev > 1e-12 {
            mean / std_dev * ann_factor.sqrt()
        } else {
            0.0
        }
    } else {
        0.0
    };

    let sortino = if returns.len() > 1 {
        let mean = returns.iter().sum::<f64>() / returns.len() as f64;
        let downside_variance = returns.iter()
            .filter(|&&r| r < 0.0)
            .map(|r| r.powi(2))
            .sum::<f64>() / returns.len() as f64;
        let downside_std = downside_variance.sqrt();
        if downside_std > 1e-12 {
            mean / downside_std * ann_factor.sqrt()
        } else {
            0.0
        }
    } else {
        0.0
    };

    // Max drawdown
    let mut peak = f64::NEG_INFINITY;
    let mut max_drawdown = 0.0_f64;
    for pt in equity_curve {
        if pt.value > peak {
            peak = pt.value;
        }
        if peak > 0.0 {
            let dd = (peak - pt.value) / peak * 100.0;
            if dd > max_drawdown {
                max_drawdown = dd;
            }
        }
    }

    // Calmar = annualized return / max_drawdown
    let calmar = if max_drawdown > 1e-9 {
        total_return / max_drawdown
    } else {
        0.0
    };

    // Trade stats
    let trade_count = trades.len();
    let wins = trades.iter().filter(|t| t.pnl_pct > 0.0).count();
    let win_rate = if trade_count > 0 {
        wins as f64 / trade_count as f64 * 100.0
    } else {
        0.0
    };

    let gross_profit: f64 = trades.iter().filter(|t| t.pnl_pct > 0.0).map(|t| t.pnl_pct).sum();
    let gross_loss: f64 = trades.iter().filter(|t| t.pnl_pct <= 0.0).map(|t| t.pnl_pct.abs()).sum();
    let profit_factor = if gross_loss > 1e-9 {
        gross_profit / gross_loss
    } else if gross_profit > 0.0 {
        f64::INFINITY
    } else {
        0.0
    };

    Metrics {
        total_return,
        sharpe,
        max_drawdown,
        calmar,
        win_rate,
        trade_count,
        profit_factor,
        sortino,
    }
}
