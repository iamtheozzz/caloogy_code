#[derive(Clone, Debug)]
pub struct Trade {
    pub entry_ts: i64,
    pub exit_ts: i64,
    pub entry_price: f64,
    pub exit_price: f64,
    pub pnl_pct: f64,
    pub fee: f64,
    pub side: String,
}

#[derive(Clone, Debug)]
pub struct EquityPoint {
    pub time: i64,
    pub value: f64,
}

pub struct Portfolio {
    pub cash: f64,
    pub position: f64,
    pub entry_price: f64,
    pub entry_ts: i64,
    pub in_trade: bool,
    pub trades: Vec<Trade>,
    pub equity_curve: Vec<EquityPoint>,
    pub taker_fee: f64,
    pub slippage: f64,
}

impl Portfolio {
    pub fn new(initial_cash: f64, taker_fee: f64, slippage: f64) -> Self {
        Portfolio {
            cash: initial_cash,
            position: 0.0,
            entry_price: 0.0,
            entry_ts: 0,
            in_trade: false,
            trades: Vec::new(),
            equity_curve: Vec::new(),
            taker_fee,
            slippage,
        }
    }

    pub fn open_long(&mut self, price: f64, ts: i64) {
        if self.in_trade {
            return;
        }
        let exec_price = price * (1.0 + self.slippage);
        let fee = self.cash * self.taker_fee;
        self.cash -= fee;
        self.position = self.cash / exec_price;
        self.cash = 0.0;
        self.entry_price = exec_price;
        self.entry_ts = ts;
        self.in_trade = true;
    }

    pub fn close_long(&mut self, price: f64, ts: i64) {
        if !self.in_trade {
            return;
        }
        let exec_price = price * (1.0 - self.slippage);
        let gross = self.position * exec_price;
        let fee = gross * self.taker_fee;
        let net = gross - fee;
        let total_fee = (self.entry_price * self.position * self.taker_fee) + fee;
        let pnl_pct = (exec_price / self.entry_price - 1.0) * 100.0;

        self.trades.push(Trade {
            entry_ts: self.entry_ts,
            exit_ts: ts,
            entry_price: self.entry_price,
            exit_price: exec_price,
            pnl_pct,
            fee: total_fee,
            side: "long".to_string(),
        });

        self.cash = net;
        self.position = 0.0;
        self.in_trade = false;
    }

    pub fn equity(&self, price: f64) -> f64 {
        if self.in_trade {
            self.position * price
        } else {
            self.cash
        }
    }

    pub fn record_equity(&mut self, price: f64, ts: i64) {
        let value = self.equity(price);
        self.equity_curve.push(EquityPoint { time: ts, value });
    }
}
