(function () {
'use strict';

/* ── State ──────────────────────────────────────────────────────────── */
var Q = {
    symbol:      'BTCUSDT',
    bar:         '1H',
    candles:     [],
    inited:      false,
    loading:     false,
    activeStrat: 'ma_cross',
    charts:      { candle: null, rsi: null, macd: null, equity: null },
    series:      { candle: null, volume: null, sma: null, ema: null,
                   fastEma: null, slowEma: null,
                   bbUpper: null, bbMiddle: null, bbLower: null,
                   rsi: null, ob: null, os: null,
                   macdLine: null, macdSig: null, macdHist: null,
                   equity: null },
    userSeries:  [],
    userMarkers: [],
    _pineEditor: null,
};

/* ── Color helpers ──────────────────────────────────────────────────── */
function getColors() {
    var th = (document.documentElement.getAttribute('data-theme') || '').toLowerCase();
    var light = th === 'light' || (th === 'system' && !window.matchMedia('(prefers-color-scheme: dark)').matches);
    return light
        ? { bg: '#f5f5f0', border: '#d8d8d0', text: '#555555' }
        : { bg: '#000000', border: '#2a2a2a', text: '#aaaaaa' };
}

/* ── Loading overlay ────────────────────────────────────────────────── */
function showLoading(on, msg) {
    var el = document.getElementById('quantLoading');
    if (!el) return;
    el.style.display = on ? 'flex' : 'none';
    if (on) el.textContent = msg || 'Loading…';
}

/* ── Chart factory ──────────────────────────────────────────────────── */
function makeChart(containerId, opts) {
    var c = getColors();
    var el = document.getElementById(containerId);
    if (!el) return null;
    var cfg = Object.assign({
        layout: {
            background: { type: 'solid', color: c.bg },
            textColor: c.text,
        },
        grid: {
            vertLines: { color: c.border, style: 0 },
            horzLines: { color: c.border, style: 0 },
        },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        rightPriceScale: { borderColor: c.border },
        timeScale: {
            borderColor: c.border,
            timeVisible: true,
            secondsVisible: false,
            fixLeftEdge: false,
            fixRightEdge: false,
        },
        handleScroll: true,
        handleScale:  true,
    }, opts || {});
    var chart = LightweightCharts.createChart(el, cfg);
    chart.timeScale().fitContent();

    var ro = new ResizeObserver(function () {
        chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    chart._ro = ro;
    return chart;
}

function destroyChart(key) {
    var ch = Q.charts[key];
    if (!ch) return;
    if (ch._ro) ch._ro.disconnect();
    ch.remove();
    Q.charts[key] = null;
    Q.series[key] = null;
}

/* ── Chart init ─────────────────────────────────────────────────────── */
function initCharts() {
    var c = getColors();

    // 1. Candle chart
    Q.charts.candle = makeChart('quantCandleDiv', {
        rightPriceScale: { borderColor: c.border, scaleMargins: { top: 0.05, bottom: 0.22 } },
    });
    var ch = Q.charts.candle;

    Q.series.candle = ch.addCandlestickSeries({
        upColor:          '#0d9488',
        downColor:        '#ef4444',
        borderUpColor:    '#0d9488',
        borderDownColor:  '#ef4444',
        wickUpColor:      '#0d9488',
        wickDownColor:    '#ef4444',
    });

    Q.series.volume = ch.addHistogramSeries({
        color:      '#26a69a',
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
        scaleMargins: { top: 0.82, bottom: 0 },
    });
    ch.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    Q.series.sma = ch.addLineSeries({
        color: '#f59e0b', lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
    });
    Q.series.ema = ch.addLineSeries({
        color: '#8b5cf6', lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
    });
    Q.series.fastEma = ch.addLineSeries({
        color: '#60a5fa', lineWidth: 1, lineStyle: 2,
        priceLineVisible: false, lastValueVisible: false,
    });
    Q.series.slowEma = ch.addLineSeries({
        color: '#fb923c', lineWidth: 1, lineStyle: 2,
        priceLineVisible: false, lastValueVisible: false,
    });
    Q.series.bbUpper = ch.addLineSeries({
        color: 'rgba(148,163,184,0.55)', lineWidth: 1, lineStyle: 2,
        priceLineVisible: false, lastValueVisible: false,
    });
    Q.series.bbMiddle = ch.addLineSeries({
        color: 'rgba(148,163,184,0.35)', lineWidth: 1, lineStyle: 0,
        priceLineVisible: false, lastValueVisible: false,
    });
    Q.series.bbLower = ch.addLineSeries({
        color: 'rgba(148,163,184,0.55)', lineWidth: 1, lineStyle: 2,
        priceLineVisible: false, lastValueVisible: false,
    });

    // 2. RSI chart
    Q.charts.rsi = makeChart('quantRsiDiv', {
        rightPriceScale: { borderColor: c.border, scaleMargins: { top: 0.1, bottom: 0.1 } },
        timeScale: { visible: false, borderColor: c.border },
    });
    Q.series.rsi = Q.charts.rsi.addLineSeries({
        color: '#c084fc', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true,
    });
    Q.series.ob = Q.charts.rsi.addLineSeries({
        color: '#ef4444', lineWidth: 1, lineStyle: 2,
        priceLineVisible: false, lastValueVisible: false,
    });
    Q.series.os = Q.charts.rsi.addLineSeries({
        color: '#0d9488', lineWidth: 1, lineStyle: 2,
        priceLineVisible: false, lastValueVisible: false,
    });

    // 3. Equity chart (hidden until backtest)
    Q.charts.equity = makeChart('quantEquityDiv', {
        rightPriceScale: { borderColor: c.border, scaleMargins: { top: 0.1, bottom: 0.1 } },
        timeScale: { visible: true, borderColor: c.border },
    });
    Q.series.equity = Q.charts.equity.addAreaSeries({
        lineColor: '#0d9488', topColor: 'rgba(13,148,136,0.18)',
        bottomColor: 'rgba(13,148,136,0)', lineWidth: 1.5,
        priceLineVisible: false, lastValueVisible: true,
    });
}

/* ── Lazy MACD chart init ───────────────────────────────────────────── */
function initMacdChart() {
    if (Q.charts.macd) return;
    var c = getColors();
    Q.charts.macd = makeChart('quantMacdDiv', {
        rightPriceScale: { borderColor: c.border, scaleMargins: { top: 0.1, bottom: 0.1 } },
        timeScale: { visible: false, borderColor: c.border },
    });
    Q.series.macdLine = Q.charts.macd.addLineSeries({
        color: '#60a5fa', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true,
    });
    Q.series.macdSig = Q.charts.macd.addLineSeries({
        color: '#fb923c', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false,
    });
    Q.series.macdHist = Q.charts.macd.addHistogramSeries({
        priceLineVisible: false, lastValueVisible: false,
    });
}

/* ── Fetch ──────────────────────────────────────────────────────────── */
/* ── Client-side cache (TTL in seconds) ─────────────────────────────── */
var _qCache = {};
var _qCacheTTL = {'1H': 120, '4H': 300, '1D': 600, '1W': 1800};

function _qCacheGet(key) {
    var e = _qCache[key];
    if (!e) return null;
    var ttl = _qCacheTTL[key.split('_')[1]] || 120;
    if (Date.now() / 1000 - e.ts > ttl) return null;
    return e.data;
}
function _qCacheSet(key, data) {
    _qCache[key] = {data: data, ts: Date.now() / 1000};
}

/* ── Symbol / bar → OKX params ──────────────────────────────────────── */
var _OKX_INST = {
    BTCUSDT:    'BTC-USDT',    ETHUSDT:    'ETH-USDT',
    BNBUSDT:    'BNB-USDT',    SOLUSDT:    'SOL-USDT',
    XRPUSDT:    'XRP-USDT',    DOGEUSDT:   'DOGE-USDT',
    ADAUSDT:    'ADA-USDT',    AVAXUSDT:   'AVAX-USDT',
    LINKUSDT:   'LINK-USDT',   DOTUSDT:    'DOT-USDT',
    UNIUSDT:    'UNI-USDT',    LTCUSDT:    'LTC-USDT',
    ATOMUSDT:   'ATOM-USDT',   NEARUSDT:   'NEAR-USDT',
    APTUSDT:    'APT-USDT',    ARBUSDT:    'ARB-USDT',
    OPUSDT:     'OP-USDT',     SUIUSDT:    'SUI-USDT',
    TRXUSDT:    'TRX-USDT',    MATICUSDT:  'MATIC-USDT',
    FILUSDT:    'FIL-USDT',    ICPUSDT:    'ICP-USDT',
    INJUSDT:    'INJ-USDT',    TONUSDT:    'TON-USDT',
    PEPEUSDT:   'PEPE-USDT',   SHIBUSDT:   'SHIB-USDT',
    WIFUSDT:    'WIF-USDT',    JUPUSDT:    'JUP-USDT',
    BONKUSDT:   'BONK-USDT',   RENDERUSDT: 'RENDER-USDT',
    FETUSDT:    'FET-USDT',    HBARUSDT:   'HBAR-USDT',
    VETUSDT:    'VET-USDT',
};
/* Binance interval fallback map */
var _BN_INTERVAL = {'1H': '1h', '4H': '4h', '1D': '1d', '1W': '1w'};

/* ── US Stocks (Yahoo Finance via server proxy) ──────────────────────── */
var _STOCK_SYMBOLS = {
    AAPL:1, TSLA:1, NVDA:1, MSFT:1, GOOGL:1, AMZN:1, META:1, NFLX:1,
    AMD:1, INTC:1, JPM:1, BAC:1, GS:1, DIS:1, UBER:1,
    SPY:1, QQQ:1, IWM:1, GLD:1, XOM:1, V:1, MA:1,
};
function isStockSymbol(sym) { return !!_STOCK_SYMBOLS[sym]; }

var _YF_RANGE = {
    '1H': { interval: '60m', range: '200d' },
    '4H': { interval: '60m', range: '730d' },
    '1D': { interval: '1d',  range: 'max'  },
    '1W': { interval: '1wk', range: 'max'  },
};

function aggregateTo4H(candles) {
    var out = [];
    for (var i = 0; i < candles.length; i += 4) {
        var g = candles.slice(i, i + 4);
        if (!g.length) continue;
        out.push({
            ts:     g[0].ts,
            open:   g[0].open,
            high:   Math.max.apply(null, g.map(function(c){ return c.high; })),
            low:    Math.min.apply(null, g.map(function(c){ return c.low;  })),
            close:  g[g.length - 1].close,
            volume: g.reduce(function(s, c){ return s + c.volume; }, 0),
        });
    }
    return out.slice(-300);
}

function _parseYahoo(result, bar) {
    var ts = result.timestamp;
    var q  = result.indicators.quote[0];
    var candles = [];
    for (var i = 0; i < ts.length; i++) {
        if (q.close[i] == null) continue;
        candles.push({
            ts:     ts[i] * 1000,
            open:   q.open[i]   || q.close[i],
            high:   q.high[i]   || q.close[i],
            low:    q.low[i]    || q.close[i],
            close:  q.close[i],
            volume: q.volume[i] || 0,
        });
    }
    if (bar === '4H') candles = aggregateTo4H(candles);
    return candles.slice(-300);
}

function fetchYahoo() {
    var yf  = _YF_RANGE[Q.bar] || _YF_RANGE['1D'];
    var url = '/api/market/yahoo?symbol=' + Q.symbol
            + '&interval=' + yf.interval + '&range=' + yf.range;
    fetch(url)
        .then(function(r) { if (!r.ok) throw new Error('yahoo ' + r.status); return r.json(); })
        .then(function(data) {
            var result = data.chart && data.chart.result && data.chart.result[0];
            if (!result) throw new Error('yahoo empty');
            var candles = _parseYahoo(result, Q.bar);
            if (candles.length < 2) throw new Error('yahoo insufficient data');
            var key = Q.symbol + '_' + Q.bar;
            _qCacheSet(key, candles);
            Q.candles = candles;
            quantRenderAll();
            if (Q._onFetchDone) { var cb = Q._onFetchDone; Q._onFetchDone = null; cb(); }
        })
        .catch(function(err) {
            console.error('[Quant] Yahoo failed:', err);
            showLoading(true, 'Failed to load data');
            Q._onFetchDone = null;
        })
        .finally(function() { Q.loading = false; });
}

function _parseOkx(data) {
    /* OKX: [ts_ms, open, high, low, close, vol, ...], newest-first */
    return data.slice().reverse().map(function (k) {
        return {ts: +k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5]};
    });
}
function _parseBinance(data) {
    /* Binance: [open_time, open, high, low, close, vol, ...], oldest-first */
    return data.map(function (k) {
        return {ts: +k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5]};
    });
}

function quantFetch() {
    if (Q.loading) return;
    var key = Q.symbol + '_' + Q.bar;
    var cached = _qCacheGet(key);
    if (cached) {
        Q.candles = cached;
        quantRenderAll();
        if (Q._onFetchDone) { var cb = Q._onFetchDone; Q._onFetchDone = null; cb(); }
        return;
    }

    Q.loading = true;
    showLoading(true);

    if (isStockSymbol(Q.symbol)) { fetchYahoo(); return; }

    var instId = _OKX_INST[Q.symbol] || 'BTC-USDT';
    var okxUrl = 'https://www.okx.com/api/v5/market/candles'
        + '?instId=' + instId + '&bar=' + Q.bar + '&limit=300';

    fetch(okxUrl)
        .then(function (r) {
            if (!r.ok) throw new Error('okx ' + r.status);
            return r.json();
        })
        .then(function (j) {
            if (j.code !== '0' || !Array.isArray(j.data) || j.data.length < 5)
                throw new Error('okx empty');
            var candles = _parseOkx(j.data);
            _qCacheSet(key, candles);
            Q.candles = candles;
            quantRenderAll();
            if (Q._onFetchDone) { var cb = Q._onFetchDone; Q._onFetchDone = null; cb(); }
        })
        .catch(function (err) {
            console.warn('[Quant] OKX failed, trying Binance:', err.message);
            /* Fallback: Binance public API (CORS-enabled) */
            var bnUrl = 'https://api.binance.com/api/v3/klines'
                + '?symbol=' + Q.symbol + '&interval=' + _BN_INTERVAL[Q.bar] + '&limit=300';
            return fetch(bnUrl)
                .then(function (r) {
                    if (!r.ok) throw new Error('binance ' + r.status);
                    return r.json();
                })
                .then(function (data) {
                    if (!Array.isArray(data) || data.length < 5) throw new Error('binance empty');
                    var candles = _parseBinance(data);
                    _qCacheSet(key, candles);
                    Q.candles = candles;
                    quantRenderAll();
                    if (Q._onFetchDone) { var cb = Q._onFetchDone; Q._onFetchDone = null; cb(); }
                });
        })
        .catch(function (err) {
            console.error('[Quant] all sources failed:', err);
            showLoading(true, 'Failed to load data');
            Q._onFetchDone = null;
        })
        .finally(function () { Q.loading = false; });
}

/* ── Indicator math ─────────────────────────────────────────────────── */
function sma(arr, n) {
    return arr.map(function (_, i) {
        if (i < n - 1) return null;
        var s = 0;
        for (var j = 0; j < n; j++) s += arr[i - j];
        return s / n;
    });
}

function ema(arr, n) {
    var k = 2 / (n + 1);
    var out = new Array(arr.length).fill(null);
    var prev = null;
    for (var i = 0; i < arr.length; i++) {
        if (i < n - 1) continue;
        if (prev === null) {
            var s = 0;
            for (var j = 0; j < n; j++) s += arr[i - j];
            prev = s / n;
        } else {
            prev = arr[i] * k + prev * (1 - k);
        }
        out[i] = prev;
    }
    return out;
}

function calcRsi(arr, n) {
    n = n || 14;
    var out = new Array(arr.length).fill(null);
    var ag = 0, al = 0;
    for (var i = 1; i <= n; i++) {
        var d = arr[i] - arr[i - 1];
        if (d > 0) ag += d; else al -= d;
    }
    ag /= n; al /= n;
    for (var i = n; i < arr.length; i++) {
        if (i > n) {
            var d = arr[i] - arr[i - 1];
            ag = (ag * (n - 1) + Math.max(d, 0)) / n;
            al = (al * (n - 1) + Math.max(-d, 0)) / n;
        }
        var rs = al === 0 ? 1e9 : ag / al;
        out[i] = 100 - 100 / (1 + rs);
    }
    return out;
}

function calcMacd(closes, fast, slow, sig) {
    var fEma = ema(closes, fast);
    var sEma = ema(closes, slow);
    var macdLine = closes.map(function (_, i) {
        return (fEma[i] !== null && sEma[i] !== null) ? fEma[i] - sEma[i] : null;
    });
    var sigLine = new Array(closes.length).fill(null);
    var k = 2 / (sig + 1), prev = null, cnt = 0;
    for (var i = 0; i < closes.length; i++) {
        if (macdLine[i] === null) continue;
        cnt++;
        prev = prev === null ? macdLine[i] : macdLine[i] * k + prev * (1 - k);
        if (cnt >= sig) sigLine[i] = prev;
    }
    return { macd: macdLine, signal: sigLine };
}

function donchian(closes, n) {
    var out = new Array(closes.length).fill(null);
    for (var i = n; i < closes.length; i++) {
        var hi = -Infinity, lo = Infinity;
        for (var j = i - n; j < i; j++) {
            if (closes[j] > hi) hi = closes[j];
            if (closes[j] < lo) lo = closes[j];
        }
        out[i] = { high: hi, low: lo };
    }
    return out;
}

function bollinger(arr, n, mult) {
    mult = mult || 2.0;
    var out = new Array(arr.length).fill(null);
    for (var i = n - 1; i < arr.length; i++) {
        var sum = 0;
        for (var j = 0; j < n; j++) sum += arr[i - j];
        var mean = sum / n;
        var vsum = 0;
        for (var j = 0; j < n; j++) vsum += (arr[i - j] - mean) * (arr[i - j] - mean);
        var std = Math.sqrt(vsum / n);
        out[i] = { upper: mean + mult * std, middle: mean, lower: mean - mult * std };
    }
    return out;
}

function calcIchimoku(candles, tenkan, kijun) {
    function midPt(arr, period, i) {
        var hi = -Infinity, lo = Infinity;
        for (var j = i - period + 1; j <= i; j++) {
            if (arr[j].high > hi) hi = arr[j].high;
            if (arr[j].low  < lo) lo = arr[j].low;
        }
        return (hi + lo) / 2;
    }
    var t = new Array(candles.length).fill(null);
    var k = new Array(candles.length).fill(null);
    for (var i = 0; i < candles.length; i++) {
        if (i >= tenkan - 1) t[i] = midPt(candles, tenkan, i);
        if (i >= kijun  - 1) k[i] = midPt(candles, kijun,  i);
    }
    return { tenkan: t, kijun: k };
}

function calcPSAR(candles, step, maxStep) {
    var dir = new Array(candles.length).fill(0);
    if (candles.length < 2) return { dir: dir };
    var bull = true, sar = candles[0].low, ep = candles[0].high, af = step;
    dir[0] = 1;
    for (var i = 1; i < candles.length; i++) {
        var prevSar = sar, prevEp = ep;
        if (bull) {
            sar = prevSar + af * (prevEp - prevSar);
            sar = Math.min(sar, candles[i-1].low, i >= 2 ? candles[i-2].low : candles[i-1].low);
            if (candles[i].low < sar) {
                bull = false; sar = prevEp; ep = candles[i].low; af = step; dir[i] = -1;
            } else {
                dir[i] = 1;
                if (candles[i].high > ep) { ep = candles[i].high; af = Math.min(af + step, maxStep); }
            }
        } else {
            sar = prevSar + af * (prevEp - prevSar);
            sar = Math.max(sar, candles[i-1].high, i >= 2 ? candles[i-2].high : candles[i-1].high);
            if (candles[i].high > sar) {
                bull = true; sar = prevEp; ep = candles[i].high; af = step; dir[i] = 1;
            } else {
                dir[i] = -1;
                if (candles[i].low < ep) { ep = candles[i].low; af = Math.min(af + step, maxStep); }
            }
        }
    }
    return { dir: dir };
}

function calcWilliamsR(candles, period) {
    var out = new Array(candles.length).fill(null);
    for (var i = period - 1; i < candles.length; i++) {
        var hi = -Infinity, lo = Infinity;
        for (var j = i - period + 1; j <= i; j++) {
            if (candles[j].high > hi) hi = candles[j].high;
            if (candles[j].low  < lo) lo = candles[j].low;
        }
        out[i] = hi === lo ? -50 : (hi - candles[i].close) / (hi - lo) * -100;
    }
    return out;
}

function calcADX(candles, period) {
    var n = candles.length;
    var tr = new Array(n).fill(0);
    var dmP = new Array(n).fill(0), dmM = new Array(n).fill(0);
    for (var i = 1; i < n; i++) {
        var hd = candles[i].high - candles[i-1].high;
        var ld = candles[i-1].low - candles[i].low;
        var pc = candles[i-1].close;
        tr[i] = Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - pc), Math.abs(candles[i].low - pc));
        dmP[i] = hd > ld && hd > 0 ? hd : 0;
        dmM[i] = ld > hd && ld > 0 ? ld : 0;
    }
    function wilderSmooth(arr) {
        var out = new Array(n).fill(null);
        var sum = 0;
        for (var i = 1; i <= period; i++) sum += arr[i];
        out[period] = sum;
        for (var i = period + 1; i < n; i++) out[i] = out[i-1] - out[i-1] / period + arr[i];
        return out;
    }
    var sTR = wilderSmooth(tr), sDMp = wilderSmooth(dmP), sDMm = wilderSmooth(dmM);
    var diP = new Array(n).fill(null), diM = new Array(n).fill(null), dx = new Array(n).fill(null);
    for (var i = period; i < n; i++) {
        if (!sTR[i]) continue;
        diP[i] = sDMp[i] / sTR[i] * 100;
        diM[i] = sDMm[i] / sTR[i] * 100;
        var s = diP[i] + diM[i];
        dx[i] = s === 0 ? 0 : Math.abs(diP[i] - diM[i]) / s * 100;
    }
    var adxOut = new Array(n).fill(null);
    var dxVals = [], dxIdx = [];
    for (var i = 0; i < n; i++) { if (dx[i] !== null) { dxVals.push(dx[i]); dxIdx.push(i); } }
    if (dxVals.length >= period) {
        var s2 = 0;
        for (var i = 0; i < period; i++) s2 += dxVals[i];
        adxOut[dxIdx[period-1]] = s2 / period;
        for (var i = period; i < dxVals.length; i++) {
            adxOut[dxIdx[i]] = (adxOut[dxIdx[i-1]] * (period-1) + dxVals[i]) / period;
        }
    }
    return { diP: diP, diM: diM, adx: adxOut };
}

function calcKeltner(candles, period, mult) {
    var closes = candles.map(function (c) { return c.close; });
    var emaLine = ema(closes, period);
    var tr = candles.map(function (c, i) {
        if (i === 0) return c.high - c.low;
        var pc = candles[i-1].close;
        return Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
    });
    var atrLine = ema(tr, period);
    var upper = new Array(candles.length).fill(null);
    var lower = new Array(candles.length).fill(null);
    for (var i = 0; i < candles.length; i++) {
        if (emaLine[i] !== null && atrLine[i] !== null) {
            upper[i] = emaLine[i] + mult * atrLine[i];
            lower[i] = emaLine[i] - mult * atrLine[i];
        }
    }
    return { upper: upper, lower: lower };
}

function calcTRIX(closes, period) {
    var k = 2 / (period + 1);
    function smoothOnce(src) {
        var out = new Array(src.length).fill(null);
        var vals = [], idxs = [];
        for (var i = 0; i < src.length; i++) { if (src[i] !== null) { vals.push(src[i]); idxs.push(i); } }
        if (vals.length < period) return out;
        var sum = 0;
        for (var i = 0; i < period; i++) sum += vals[i];
        var prev = sum / period;
        out[idxs[period-1]] = prev;
        for (var i = period; i < vals.length; i++) { prev = vals[i] * k + prev * (1 - k); out[idxs[i]] = prev; }
        return out;
    }
    var e3 = smoothOnce(smoothOnce(smoothOnce(closes)));
    var trix = new Array(closes.length).fill(null);
    for (var i = 1; i < closes.length; i++) {
        if (e3[i] !== null && e3[i-1] !== null && e3[i-1] !== 0) trix[i] = (e3[i] - e3[i-1]) / e3[i-1] * 100;
    }
    return trix;
}

function calcCMO(closes, period) {
    var out = new Array(closes.length).fill(null);
    for (var i = period; i < closes.length; i++) {
        var up = 0, down = 0;
        for (var j = i - period + 1; j <= i; j++) {
            var d = closes[j] - closes[j-1];
            if (d > 0) up += d; else down -= d;
        }
        out[i] = (up + down) === 0 ? 0 : (up - down) / (up + down) * 100;
    }
    return out;
}

function calcHullMA(closes, period) {
    function wma(arr, n) {
        var denom = n * (n + 1) / 2;
        var out = new Array(arr.length).fill(null);
        for (var i = n - 1; i < arr.length; i++) {
            var sum = 0, valid = true;
            for (var j = 0; j < n; j++) {
                if (arr[i-j] === null) { valid = false; break; }
                sum += arr[i-j] * (n - j);
            }
            if (valid) out[i] = sum / denom;
        }
        return out;
    }
    var half  = Math.max(2, Math.round(period / 2));
    var sqrtn = Math.max(2, Math.round(Math.sqrt(period)));
    var wHalf = wma(closes, half);
    var wFull = wma(closes, period);
    var diff = closes.map(function (_, i) {
        return wHalf[i] !== null && wFull[i] !== null ? 2 * wHalf[i] - wFull[i] : null;
    });
    return wma(diff, sqrtn);
}

function calcVWAP(candles, period) {
    var out = new Array(candles.length).fill(null);
    for (var i = period - 1; i < candles.length; i++) {
        var sumPV = 0, sumV = 0;
        for (var j = i - period + 1; j <= i; j++) {
            var tp = (candles[j].high + candles[j].low + candles[j].close) / 3;
            sumPV += tp * candles[j].volume;
            sumV  += candles[j].volume;
        }
        out[i] = sumV === 0 ? null : sumPV / sumV;
    }
    return out;
}

function calcOBV(candles) {
    var out = new Array(candles.length).fill(0);
    out[0] = candles[0].volume;
    for (var i = 1; i < candles.length; i++) {
        if (candles[i].close > candles[i-1].close)      out[i] = out[i-1] + candles[i].volume;
        else if (candles[i].close < candles[i-1].close) out[i] = out[i-1] - candles[i].volume;
        else                                              out[i] = out[i-1];
    }
    return out;
}

function calcStochastic(candles, kPeriod, dPeriod) {
    var k = new Array(candles.length).fill(null);
    for (var i = kPeriod - 1; i < candles.length; i++) {
        var hi = -Infinity, lo = Infinity;
        for (var j = i - kPeriod + 1; j <= i; j++) {
            if (candles[j].high > hi) hi = candles[j].high;
            if (candles[j].low  < lo) lo = candles[j].low;
        }
        k[i] = hi === lo ? 50 : (candles[i].close - lo) / (hi - lo) * 100;
    }
    var d = new Array(candles.length).fill(null);
    for (var i = kPeriod + dPeriod - 2; i < candles.length; i++) {
        var sum = 0, valid = true;
        for (var j = i - dPeriod + 1; j <= i; j++) {
            if (k[j] === null) { valid = false; break; }
            sum += k[j];
        }
        if (valid) d[i] = sum / dPeriod;
    }
    return { k: k, d: d };
}

function calcSupertrend(candles, period, mult) {
    var tr = candles.map(function (c, i) {
        if (i === 0) return c.high - c.low;
        var pc = candles[i - 1].close;
        return Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
    });
    var atr = new Array(candles.length).fill(null);
    var sum = 0;
    for (var i = 0; i < period; i++) sum += tr[i];
    atr[period - 1] = sum / period;
    for (var i = period; i < candles.length; i++) {
        atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
    }
    var upper = new Array(candles.length).fill(null);
    var lower = new Array(candles.length).fill(null);
    var dir   = new Array(candles.length).fill(0);
    for (var i = period - 1; i < candles.length; i++) {
        var hl2 = (candles[i].high + candles[i].low) / 2;
        var bu = hl2 + mult * atr[i];
        var bl = hl2 - mult * atr[i];
        if (i === period - 1) {
            upper[i] = bu; lower[i] = bl; dir[i] = 1;
        } else {
            upper[i] = (bu < upper[i-1] || candles[i-1].close > upper[i-1]) ? bu : upper[i-1];
            lower[i] = (bl > lower[i-1] || candles[i-1].close < lower[i-1]) ? bl : lower[i-1];
            if (dir[i-1] === -1) dir[i] = candles[i].close > upper[i] ?  1 : -1;
            else                  dir[i] = candles[i].close < lower[i] ? -1 :  1;
        }
    }
    return { dir: dir };
}

function calcCCI(candles, period) {
    var out = new Array(candles.length).fill(null);
    for (var i = period - 1; i < candles.length; i++) {
        var tps = [];
        for (var j = i - period + 1; j <= i; j++) {
            tps.push((candles[j].high + candles[j].low + candles[j].close) / 3);
        }
        var mean = tps.reduce(function (a, b) { return a + b; }, 0) / period;
        var mad  = tps.reduce(function (a, b) { return a + Math.abs(b - mean); }, 0) / period;
        out[i] = mad === 0 ? 0 : (tps[tps.length - 1] - mean) / (0.015 * mad);
    }
    return out;
}

function calcROC(closes, period) {
    return closes.map(function (c, i) {
        if (i < period || closes[i - period] === 0) return null;
        return (c - closes[i - period]) / closes[i - period] * 100;
    });
}

/* ── Backtester ─────────────────────────────────────────────────────── */
function runBacktest(candles, strat) {
    var closes = candles.map(function (c) { return c.close; });
    var times  = candles.map(function (c) { return Math.floor(c.ts / 1000); });
    var signals = new Array(candles.length).fill(null);

    if (strat === 'ma_cross') {
        var fast = parseInt(document.getElementById('quantFastMa').value);
        var slow = parseInt(document.getElementById('quantSlowMa').value);
        var fl = ema(closes, fast);
        var sl = ema(closes, slow);
        for (var i = 1; i < candles.length; i++) {
            if (fl[i] === null || fl[i - 1] === null || sl[i] === null) continue;
            if (fl[i] > sl[i] && fl[i - 1] <= sl[i - 1]) signals[i] = 'buy';
            else if (fl[i] < sl[i] && fl[i - 1] >= sl[i - 1]) signals[i] = 'sell';
        }
    } else if (strat === 'rsi_bands') {
        var ob = parseInt(document.getElementById('quantRsiOb').value);
        var os = parseInt(document.getElementById('quantRsiOs').value);
        var rv = calcRsi(closes, 14);
        for (var i = 1; i < candles.length; i++) {
            if (rv[i] === null || rv[i - 1] === null) continue;
            if (rv[i - 1] <= os && rv[i] > os) signals[i] = 'buy';
            else if (rv[i - 1] >= ob && rv[i] < ob) signals[i] = 'sell';
        }
    } else if (strat === 'bb_bounce') {
        var bbP = parseInt(document.getElementById('quantBbStratPeriod').value);
        var bbv = bollinger(closes, bbP, 2.0);
        for (var i = 1; i < candles.length; i++) {
            if (!bbv[i] || !bbv[i - 1]) continue;
            if (closes[i - 1] < bbv[i - 1].lower && closes[i] >= bbv[i].lower) signals[i] = 'buy';
            else if (closes[i - 1] < bbv[i - 1].upper && closes[i] >= bbv[i].upper) signals[i] = 'sell';
        }
    } else if (strat === 'macd') {
        var mf = parseInt(document.getElementById('quantMacdFast').value);
        var ms = parseInt(document.getElementById('quantMacdSlow').value);
        var mg = parseInt(document.getElementById('quantMacdSig').value);
        var md = calcMacd(closes, mf, ms, mg);
        for (var i = 1; i < candles.length; i++) {
            if (md.macd[i] === null || md.signal[i] === null ||
                md.macd[i-1] === null || md.signal[i-1] === null) continue;
            if (md.macd[i] > md.signal[i] && md.macd[i-1] <= md.signal[i-1]) signals[i] = 'buy';
            else if (md.macd[i] < md.signal[i] && md.macd[i-1] >= md.signal[i-1]) signals[i] = 'sell';
        }
    } else if (strat === 'donchian') {
        var dp = parseInt(document.getElementById('quantDonchianPeriod').value);
        var dc = donchian(closes, dp);
        for (var i = 1; i < candles.length; i++) {
            if (!dc[i]) continue;
            if (closes[i] > dc[i].high) signals[i] = 'buy';
            else if (closes[i] < dc[i].low) signals[i] = 'sell';
        }
    } else if (strat === 'mean_rev') {
        var mrP = parseInt(document.getElementById('quantMrPeriod').value);
        var mrD = parseInt(document.getElementById('quantMrDev').value) / 100;
        var mrS = sma(closes, mrP);
        for (var i = 1; i < candles.length; i++) {
            if (mrS[i] === null || mrS[i-1] === null) continue;
            var dev = (closes[i] - mrS[i]) / mrS[i];
            var pDev = (closes[i-1] - mrS[i-1]) / mrS[i-1];
            if (pDev < -mrD && dev >= -mrD) signals[i] = 'buy';
            else if (pDev < 0 && dev >= 0) signals[i] = 'sell';
        }
    } else if (strat === 'stoch') {
        var sk = parseInt(document.getElementById('quantStochK').value);
        var sd = parseInt(document.getElementById('quantStochD').value);
        var sob = parseInt(document.getElementById('quantStochOb').value);
        var sos = parseInt(document.getElementById('quantStochOs').value);
        var st = calcStochastic(candles, sk, sd);
        for (var i = 1; i < candles.length; i++) {
            if (st.k[i] === null || st.k[i-1] === null) continue;
            if (st.k[i-1] <= sos && st.k[i] > sos) signals[i] = 'buy';
            else if (st.k[i-1] >= sob && st.k[i] < sob) signals[i] = 'sell';
        }
    } else if (strat === 'supertrend') {
        var stp = parseInt(document.getElementById('quantStPeriod').value);
        var stm = parseInt(document.getElementById('quantStMult').value);
        var sv = calcSupertrend(candles, stp, stm);
        for (var i = 1; i < candles.length; i++) {
            if (sv.dir[i] === 0 || sv.dir[i-1] === 0) continue;
            if (sv.dir[i-1] !== 1  && sv.dir[i] === 1)  signals[i] = 'buy';
            else if (sv.dir[i-1] !== -1 && sv.dir[i] === -1) signals[i] = 'sell';
        }
    } else if (strat === 'cci') {
        var cp = parseInt(document.getElementById('quantCciPeriod').value);
        var ct = parseInt(document.getElementById('quantCciThresh').value);
        var cv = calcCCI(candles, cp);
        for (var i = 1; i < candles.length; i++) {
            if (cv[i] === null || cv[i-1] === null) continue;
            if (cv[i-1] <= -ct && cv[i] > -ct) signals[i] = 'buy';
            else if (cv[i-1] >= ct && cv[i] < ct) signals[i] = 'sell';
        }
    } else if (strat === 'roc') {
        var rp = parseInt(document.getElementById('quantRocPeriod').value);
        var rv = calcROC(closes, rp);
        for (var i = 1; i < candles.length; i++) {
            if (rv[i] === null || rv[i-1] === null) continue;
            if (rv[i-1] <= 0 && rv[i] > 0) signals[i] = 'buy';
            else if (rv[i-1] >= 0 && rv[i] < 0) signals[i] = 'sell';
        }
    } else if (strat === 'ichimoku') {
        var iT = parseInt(document.getElementById('quantIchiTenkan').value);
        var iK = parseInt(document.getElementById('quantIchiKijun').value);
        var ich = calcIchimoku(candles, iT, iK);
        for (var i = 1; i < candles.length; i++) {
            if (ich.tenkan[i] === null || ich.kijun[i] === null || ich.tenkan[i-1] === null || ich.kijun[i-1] === null) continue;
            if (ich.tenkan[i-1] <= ich.kijun[i-1] && ich.tenkan[i] > ich.kijun[i]) signals[i] = 'buy';
            else if (ich.tenkan[i-1] >= ich.kijun[i-1] && ich.tenkan[i] < ich.kijun[i]) signals[i] = 'sell';
        }
    } else if (strat === 'psar') {
        var psStep = parseInt(document.getElementById('quantSarStep').value) * 0.01;
        var psMax  = parseInt(document.getElementById('quantSarMax').value)  * 0.01;
        var ps = calcPSAR(candles, psStep, psMax);
        for (var i = 1; i < candles.length; i++) {
            if (ps.dir[i-1] !== 1  && ps.dir[i] === 1)  signals[i] = 'buy';
            else if (ps.dir[i-1] !== -1 && ps.dir[i] === -1) signals[i] = 'sell';
        }
    } else if (strat === 'williams_r') {
        var wrP  = parseInt(document.getElementById('quantWrPeriod').value);
        var wrOB = -parseInt(document.getElementById('quantWrOb').value);
        var wrOS = -parseInt(document.getElementById('quantWrOs').value);
        var wr = calcWilliamsR(candles, wrP);
        for (var i = 1; i < candles.length; i++) {
            if (wr[i] === null || wr[i-1] === null) continue;
            if (wr[i-1] <= wrOS && wr[i] > wrOS) signals[i] = 'buy';
            else if (wr[i-1] >= wrOB && wr[i] < wrOB) signals[i] = 'sell';
        }
    } else if (strat === 'adx') {
        var adxP = parseInt(document.getElementById('quantAdxPeriod').value);
        var adxT = parseInt(document.getElementById('quantAdxThresh').value);
        var adxv = calcADX(candles, adxP);
        for (var i = 1; i < candles.length; i++) {
            if (adxv.diP[i] === null || adxv.diM[i] === null || adxv.adx[i] === null) continue;
            if (adxv.diP[i-1] === null || adxv.diM[i-1] === null) continue;
            if (adxv.adx[i] < adxT) continue;
            if (adxv.diP[i-1] <= adxv.diM[i-1] && adxv.diP[i] > adxv.diM[i]) signals[i] = 'buy';
            else if (adxv.diP[i-1] >= adxv.diM[i-1] && adxv.diP[i] < adxv.diM[i]) signals[i] = 'sell';
        }
    } else if (strat === 'keltner') {
        var kcP = parseInt(document.getElementById('quantKcPeriod').value);
        var kcM = parseInt(document.getElementById('quantKcMult').value);
        var kc = calcKeltner(candles, kcP, kcM);
        for (var i = 1; i < candles.length; i++) {
            if (kc.upper[i] === null || kc.lower[i] === null || kc.upper[i-1] === null || kc.lower[i-1] === null) continue;
            if (closes[i-1] < kc.lower[i-1] && closes[i] >= kc.lower[i]) signals[i] = 'buy';
            else if (closes[i-1] < kc.upper[i-1] && closes[i] >= kc.upper[i]) signals[i] = 'sell';
        }
    } else if (strat === 'trix') {
        var txP = parseInt(document.getElementById('quantTrixPeriod').value);
        var tx = calcTRIX(closes, txP);
        for (var i = 1; i < candles.length; i++) {
            if (tx[i] === null || tx[i-1] === null) continue;
            if (tx[i-1] <= 0 && tx[i] > 0) signals[i] = 'buy';
            else if (tx[i-1] >= 0 && tx[i] < 0) signals[i] = 'sell';
        }
    } else if (strat === 'cmo') {
        var cmoP = parseInt(document.getElementById('quantCmoPeriod').value);
        var cmoT = parseInt(document.getElementById('quantCmoThresh').value);
        var cmoV = calcCMO(closes, cmoP);
        for (var i = 1; i < candles.length; i++) {
            if (cmoV[i] === null || cmoV[i-1] === null) continue;
            if (cmoV[i-1] <= -cmoT && cmoV[i] > -cmoT) signals[i] = 'buy';
            else if (cmoV[i-1] >= cmoT && cmoV[i] < cmoT) signals[i] = 'sell';
        }
    } else if (strat === 'hull') {
        var hF = parseInt(document.getElementById('quantHullFast').value);
        var hS = parseInt(document.getElementById('quantHullSlow').value);
        var hmaF = calcHullMA(closes, hF);
        var hmaS = calcHullMA(closes, hS);
        for (var i = 1; i < candles.length; i++) {
            if (hmaF[i] === null || hmaS[i] === null || hmaF[i-1] === null || hmaS[i-1] === null) continue;
            if (hmaF[i-1] <= hmaS[i-1] && hmaF[i] > hmaS[i]) signals[i] = 'buy';
            else if (hmaF[i-1] >= hmaS[i-1] && hmaF[i] < hmaS[i]) signals[i] = 'sell';
        }
    } else if (strat === 'vwap') {
        var vwP = parseInt(document.getElementById('quantVwapPeriod').value);
        var vwT = parseInt(document.getElementById('quantVwapThresh').value) / 100;
        var vw = calcVWAP(candles, vwP);
        for (var i = 1; i < candles.length; i++) {
            if (vw[i] === null || vw[i-1] === null) continue;
            var dev = (closes[i] - vw[i]) / vw[i];
            var pDev = (closes[i-1] - vw[i-1]) / vw[i-1];
            if (pDev < -vwT && dev >= -vwT) signals[i] = 'buy';
            else if (pDev < vwT && dev >= vwT) signals[i] = 'sell';
        }
    } else if (strat === 'obv') {
        var obvP = parseInt(document.getElementById('quantObvPeriod').value);
        var obvV = calcOBV(candles);
        var obvS = sma(obvV, obvP);
        for (var i = 1; i < candles.length; i++) {
            if (obvS[i] === null || obvS[i-1] === null) continue;
            if (obvV[i-1] <= obvS[i-1] && obvV[i] > obvS[i]) signals[i] = 'buy';
            else if (obvV[i-1] >= obvS[i-1] && obvV[i] < obvS[i]) signals[i] = 'sell';
        }
    }

    var equity = 1.0, inTrade = false, entry = 0;
    var equityCurve = [], trades = [];
    var buyX = [], buyY = [], sellX = [], sellY = [];

    for (var i = 0; i < candles.length; i++) {
        if (signals[i] === 'buy' && !inTrade) {
            inTrade = true; entry = closes[i];
            buyX.push(times[i]); buyY.push(closes[i]);
        } else if (signals[i] === 'sell' && inTrade) {
            var ret = closes[i] / entry;
            equity *= ret;
            trades.push(ret);
            inTrade = false;
            sellX.push(times[i]); sellY.push(closes[i]);
        }
        equityCurve.push({ time: times[i], value: equity });
    }

    var wins = trades.filter(function (r) { return r > 1; }).length;
    var winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;
    var peak = 1, maxDD = 0;
    equityCurve.forEach(function (p) {
        if (p.value > peak) peak = p.value;
        maxDD = Math.max(maxDD, (peak - p.value) / peak);
    });

    return {
        totalReturn: (equity - 1) * 100,
        tradeCount: trades.length,
        winRate: winRate,
        maxDD: maxDD * 100,
        equityCurve: equityCurve,
        buyX: buyX, buyY: buyY, sellX: sellX, sellY: sellY,
    };
}

/* ── Render ─────────────────────────────────────────────────────────── */
function toTime(ts_ms) { return Math.floor(ts_ms / 1000); }

function quantRenderAll(bt) {
    var c = Q.candles;
    if (!c || c.length === 0) return;
    showLoading(false);
    // Clear user series when data is refreshed (symbol/bar change)
    if (Q.userSeries.length > 0 && Q.charts.candle) {
        Q.userSeries.forEach(function (s) { try { Q.charts.candle.removeSeries(s); } catch (e) {} });
        Q.userSeries = [];
        Q.userMarkers = [];
        var st = document.getElementById('qtPineStatus');
        if (st) { st.textContent = ''; st.className = 'qt-pine-status'; }
    }

    var closes = c.map(function (x) { return x.close; });

    // Candles + volume
    Q.series.candle.setData(c.map(function (x) {
        return { time: toTime(x.ts), open: x.open, high: x.high, low: x.low, close: x.close };
    }));
    Q.series.volume.setData(c.map(function (x) {
        return {
            time: toTime(x.ts),
            value: x.volume,
            color: x.close >= x.open ? 'rgba(13,148,136,0.3)' : 'rgba(239,68,68,0.3)',
        };
    }));

    // SMA overlay
    var smaPeriod = parseInt(document.getElementById('quantSmaPeriod').value);
    var smaOn     = document.getElementById('quantSmaOn').checked;
    var smaVals   = sma(closes, smaPeriod);
    var smaData   = [];
    for (var i = 0; i < c.length; i++) {
        if (smaVals[i] !== null) smaData.push({ time: toTime(c[i].ts), value: smaVals[i] });
    }
    Q.series.sma.setData(smaOn ? smaData : []);

    // EMA overlay
    var emaPeriod = parseInt(document.getElementById('quantEmaPeriod').value);
    var emaOn     = document.getElementById('quantEmaOn').checked;
    var emaData   = [];
    var emaVals   = ema(closes, emaPeriod);
    for (var i = 0; i < c.length; i++) {
        if (emaVals[i] !== null) emaData.push({ time: toTime(c[i].ts), value: emaVals[i] });
    }
    Q.series.ema.setData(emaOn ? emaData : []);

    // BB overlay
    var bbPeriod = parseInt(document.getElementById('quantBbPeriod').value);
    var bbOn     = document.getElementById('quantBbOn').checked;
    var bbVals   = bollinger(closes, bbPeriod, 2.0);
    var bbU = [], bbM = [], bbL = [];
    for (var i = 0; i < c.length; i++) {
        if (bbVals[i]) {
            var t = toTime(c[i].ts);
            bbU.push({ time: t, value: bbVals[i].upper  });
            bbM.push({ time: t, value: bbVals[i].middle });
            bbL.push({ time: t, value: bbVals[i].lower  });
        }
    }
    Q.series.bbUpper.setData(bbOn ? bbU : []);
    Q.series.bbMiddle.setData(bbOn ? bbM : []);
    Q.series.bbLower.setData(bbOn ? bbL : []);

    // Strategy MA lines (fast / slow EMA)
    var fast = parseInt(document.getElementById('quantFastMa').value);
    var slow = parseInt(document.getElementById('quantSlowMa').value);
    var fl = ema(closes, fast), sl = ema(closes, slow);
    var fData = [], sData = [];
    for (var i = 0; i < c.length; i++) {
        if (fl[i] !== null) fData.push({ time: toTime(c[i].ts), value: fl[i] });
        if (sl[i] !== null) sData.push({ time: toTime(c[i].ts), value: sl[i] });
    }
    Q.series.fastEma.setData(fData);
    Q.series.slowEma.setData(sData);

    // Buy/sell markers
    var markers = [];
    if (bt) {
        for (var i = 0; i < bt.buyX.length; i++) {
            markers.push({ time: bt.buyX[i], position: 'belowBar', color: '#0d9488', shape: 'arrowUp', text: 'B' });
        }
        for (var i = 0; i < bt.sellX.length; i++) {
            markers.push({ time: bt.sellX[i], position: 'aboveBar', color: '#ef4444', shape: 'arrowDown', text: 'S' });
        }
        markers.sort(function (a, b) { return a.time - b.time; });
    }
    Q.series.candle.setMarkers(markers);

    // RSI
    var ob = parseInt(document.getElementById('quantRsiOb').value);
    var os = parseInt(document.getElementById('quantRsiOs').value);
    var rsiVals = calcRsi(closes, 14);
    var rsiData = [], obData = [], osData = [];
    for (var i = 0; i < c.length; i++) {
        var t = toTime(c[i].ts);
        if (rsiVals[i] !== null) rsiData.push({ time: t, value: rsiVals[i] });
        obData.push({ time: t, value: ob });
        osData.push({ time: t, value: os });
    }
    Q.series.rsi.setData(rsiData);
    Q.series.ob.setData(obData);
    Q.series.os.setData(osData);

    // MACD (lazy — only render when visible)
    if (Q.charts.macd && !document.getElementById('quantMacdDiv').classList.contains('quant-hidden')) {
        var md = calcMacd(closes, 12, 26, 9);
        var mlData = [], msData = [], mhData = [];
        for (var i = 0; i < c.length; i++) {
            var t = toTime(c[i].ts);
            if (md.macd[i] !== null) mlData.push({ time: t, value: md.macd[i] });
            if (md.signal[i] !== null) {
                msData.push({ time: t, value: md.signal[i] });
                var hist = md.macd[i] - md.signal[i];
                mhData.push({ time: t, value: hist,
                    color: hist >= 0 ? 'rgba(13,148,136,0.55)' : 'rgba(239,68,68,0.55)' });
            }
        }
        Q.series.macdLine.setData(mlData);
        Q.series.macdSig.setData(msData);
        Q.series.macdHist.setData(mhData);
        Q.charts.macd.timeScale().fitContent();
    }

    // Equity curve
    if (bt && bt.equityCurve.length > 0) {
        document.getElementById('quantEquityDiv').classList.remove('quant-hidden');
        Q.series.equity.setData(bt.equityCurve);
        Q.charts.equity.timeScale().fitContent();
    }

    Q.charts.candle.timeScale().fitContent();
    Q.charts.rsi.timeScale().fitContent();
}

/* ── UI binding ─────────────────────────────────────────────────────── */
function quantBindUI() {
    // Symbol pills (toolbar + extended panel + stocks)
    var _symSel = '#quantSymbolPills .quant-pill, #quantExtraSymbolPills .quant-pill, #quantStockPills .quant-pill, #quantExtraStockPills .quant-pill';
    document.querySelectorAll(_symSel).forEach(function (btn) {
        btn.addEventListener('click', function () {
            document.querySelectorAll(_symSel).forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            Q.symbol = btn.dataset.val;
            quantFetch();
        });
    });

    // Interval pills
    document.querySelectorAll('#quantIntervalPills .quant-pill').forEach(function (btn) {
        btn.addEventListener('click', function () {
            document.querySelectorAll('#quantIntervalPills .quant-pill').forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            Q.bar = btn.dataset.val;
            quantFetch();
        });
    });

    // Sliders
    function bindSlider(sliderId, valId) {
        var sl = document.getElementById(sliderId);
        var vl = document.getElementById(valId);
        if (!sl || !vl) return;
        sl.addEventListener('input', function () {
            vl.textContent = sl.value;
            if (Q.candles.length > 0) quantRenderAll();
        });
    }
    bindSlider('quantSmaPeriod',       'quantSmaVal');
    bindSlider('quantEmaPeriod',       'quantEmaVal');
    bindSlider('quantBbPeriod',        'quantBbVal');
    // Fast/Slow MA with mutual constraint
    (function () {
        var fastEl = document.getElementById('quantFastMa');
        var slowEl = document.getElementById('quantSlowMa');
        var fastVal = document.getElementById('quantFastMaVal');
        var slowVal = document.getElementById('quantSlowMaVal');
        if (!fastEl || !slowEl) return;
        fastEl.addEventListener('input', function () {
            var f = parseInt(fastEl.value);
            if (parseInt(slowEl.value) <= f) { slowEl.value = f + 1; slowVal.textContent = f + 1; }
            fastVal.textContent = f;
            if (Q.candles.length > 0) quantRenderAll();
        });
        slowEl.addEventListener('input', function () {
            var s = parseInt(slowEl.value);
            if (parseInt(fastEl.value) >= s) { fastEl.value = s - 1; fastVal.textContent = s - 1; }
            slowVal.textContent = s;
            if (Q.candles.length > 0) quantRenderAll();
        });
    })();
    // RSI OB/OS with mutual constraint
    (function () {
        var obEl = document.getElementById('quantRsiOb');
        var osEl = document.getElementById('quantRsiOs');
        var obVal = document.getElementById('quantRsiObVal');
        var osVal = document.getElementById('quantRsiOsVal');
        if (!obEl || !osEl) return;
        obEl.addEventListener('input', function () {
            var ob = parseInt(obEl.value);
            if (parseInt(osEl.value) >= ob) { osEl.value = ob - 1; osVal.textContent = ob - 1; }
            obVal.textContent = ob;
            if (Q.candles.length > 0) quantRenderAll();
        });
        osEl.addEventListener('input', function () {
            var os = parseInt(osEl.value);
            if (parseInt(obEl.value) <= os) { obEl.value = os + 1; obVal.textContent = os + 1; }
            osVal.textContent = os;
            if (Q.candles.length > 0) quantRenderAll();
        });
    })();
    bindSlider('quantBbStratPeriod',   'quantBbStratPeriodVal');
    // MACD Fast/Slow with mutual constraint
    (function () {
        var fastEl = document.getElementById('quantMacdFast');
        var slowEl = document.getElementById('quantMacdSlow');
        var fastVal = document.getElementById('quantMacdFastVal');
        var slowVal = document.getElementById('quantMacdSlowVal');
        if (!fastEl || !slowEl) return;
        fastEl.addEventListener('input', function () {
            var f = parseInt(fastEl.value);
            if (parseInt(slowEl.value) <= f) { slowEl.value = f + 1; slowVal.textContent = f + 1; }
            fastVal.textContent = f;
            if (Q.candles.length > 0) quantRenderAll();
        });
        slowEl.addEventListener('input', function () {
            var s = parseInt(slowEl.value);
            if (parseInt(fastEl.value) >= s) { fastEl.value = s - 1; fastVal.textContent = s - 1; }
            slowVal.textContent = s;
            if (Q.candles.length > 0) quantRenderAll();
        });
    })();
    bindSlider('quantMacdSig',         'quantMacdSigVal');
    bindSlider('quantDonchianPeriod',  'quantDonchianPeriodVal');
    bindSlider('quantMrPeriod',        'quantMrPeriodVal');
    bindSlider('quantMrDev',           'quantMrDevVal');
    bindSlider('quantStochK',          'quantStochKVal');
    bindSlider('quantStochD',          'quantStochDVal');
    // Stochastic OB/OS constraint
    (function () {
        var obEl = document.getElementById('quantStochOb');
        var osEl = document.getElementById('quantStochOs');
        var obVal = document.getElementById('quantStochObVal');
        var osVal = document.getElementById('quantStochOsVal');
        if (!obEl || !osEl) return;
        obEl.addEventListener('input', function () {
            var ob = parseInt(obEl.value);
            if (parseInt(osEl.value) >= ob) { osEl.value = ob - 1; osVal.textContent = ob - 1; }
            obVal.textContent = ob;
            if (Q.candles.length > 0) quantRenderAll();
        });
        osEl.addEventListener('input', function () {
            var os = parseInt(osEl.value);
            if (parseInt(obEl.value) <= os) { obEl.value = os + 1; obVal.textContent = os + 1; }
            osVal.textContent = os;
            if (Q.candles.length > 0) quantRenderAll();
        });
    })();
    bindSlider('quantStPeriod',        'quantStPeriodVal');
    bindSlider('quantStMult',          'quantStMultVal');
    bindSlider('quantCciPeriod',       'quantCciPeriodVal');
    bindSlider('quantCciThresh',       'quantCciThreshVal');
    bindSlider('quantRocPeriod',       'quantRocPeriodVal');
    bindSlider('quantIchiTenkan',      'quantIchiTenkanVal');
    bindSlider('quantIchiKijun',       'quantIchiKijunVal');
    // PSAR: display as ×0.01
    (function () {
        var stepEl = document.getElementById('quantSarStep');
        var maxEl  = document.getElementById('quantSarMax');
        var stepVl = document.getElementById('quantSarStepVal');
        var maxVl  = document.getElementById('quantSarMaxVal');
        if (stepEl) stepEl.addEventListener('input', function () {
            stepVl.textContent = (parseInt(stepEl.value) * 0.01).toFixed(2);
            if (Q.candles.length > 0) quantRenderAll();
        });
        if (maxEl) maxEl.addEventListener('input', function () {
            maxVl.textContent = (parseInt(maxEl.value) * 0.01).toFixed(2);
            if (Q.candles.length > 0) quantRenderAll();
        });
    })();
    bindSlider('quantWrPeriod',        'quantWrPeriodVal');
    bindSlider('quantWrOb',            'quantWrObVal');
    bindSlider('quantWrOs',            'quantWrOsVal');
    bindSlider('quantAdxPeriod',       'quantAdxPeriodVal');
    bindSlider('quantAdxThresh',       'quantAdxThreshVal');
    bindSlider('quantKcPeriod',        'quantKcPeriodVal');
    bindSlider('quantKcMult',          'quantKcMultVal');
    bindSlider('quantTrixPeriod',      'quantTrixPeriodVal');
    bindSlider('quantCmoPeriod',       'quantCmoPeriodVal');
    bindSlider('quantCmoThresh',       'quantCmoThreshVal');
    // Hull MA Fast/Slow constraint
    (function () {
        var fastEl = document.getElementById('quantHullFast');
        var slowEl = document.getElementById('quantHullSlow');
        var fastVl = document.getElementById('quantHullFastVal');
        var slowVl = document.getElementById('quantHullSlowVal');
        if (!fastEl || !slowEl) return;
        fastEl.addEventListener('input', function () {
            var f = parseInt(fastEl.value);
            if (parseInt(slowEl.value) <= f) { slowEl.value = f + 1; slowVl.textContent = f + 1; }
            fastVl.textContent = f;
            if (Q.candles.length > 0) quantRenderAll();
        });
        slowEl.addEventListener('input', function () {
            var s = parseInt(slowEl.value);
            if (parseInt(fastEl.value) >= s) { fastEl.value = s - 1; fastVl.textContent = s - 1; }
            slowVl.textContent = s;
            if (Q.candles.length > 0) quantRenderAll();
        });
    })();
    bindSlider('quantVwapPeriod',      'quantVwapPeriodVal');
    bindSlider('quantVwapThresh',      'quantVwapThreshVal');
    bindSlider('quantObvPeriod',       'quantObvPeriodVal');

    // Overlay checkboxes
    ['quantSmaOn', 'quantEmaOn', 'quantBbOn'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('change', function () {
            if (Q.candles.length > 0) quantRenderAll();
        });
    });

    // Strategy tabs (toolbar + extended)
    var _stratPanelMap = {
        'ma_cross':   'stratPanelMaCross',
        'rsi_bands':  'stratPanelRsi',
        'bb_bounce':  'stratPanelBb',
        'macd':       'stratPanelMacd',
        'donchian':   'stratPanelDonchian',
        'mean_rev':   'stratPanelMeanRev',
        'stoch':      'stratPanelStoch',
        'supertrend': 'stratPanelSupertrend',
        'cci':        'stratPanelCci',
        'roc':        'stratPanelRoc',
        'ichimoku':   'stratPanelIchimoku',
        'psar':       'stratPanelPsar',
        'williams_r': 'stratPanelWr',
        'adx':        'stratPanelAdx',
        'keltner':    'stratPanelKeltner',
        'trix':       'stratPanelTrix',
        'cmo':        'stratPanelCmo',
        'hull':       'stratPanelHull',
        'vwap':       'stratPanelVwap',
        'obv':        'stratPanelObv',
    };
    document.querySelectorAll('.quant-strat-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.quant-strat-btn').forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            Q.activeStrat = btn.dataset.strat;
            Object.keys(_stratPanelMap).forEach(function (k) {
                var el = document.getElementById(_stratPanelMap[k]);
                if (el) el.classList.toggle('quant-hidden', k !== Q.activeStrat);
            });
        });
    });

    // Expand / collapse dropdowns
    function bindExpand(btnId, panelId) {
        var btn = document.getElementById(btnId);
        var panel = document.getElementById(panelId);
        if (!btn || !panel) return;
        btn.addEventListener('click', function () {
            var open = !panel.classList.contains('quant-hidden');
            panel.classList.toggle('quant-hidden', open);
            btn.classList.toggle('active', !open);
        });
    }
    bindExpand('quantMoreAssetsBtn',  'quantMoreAssetsPanel');
    bindExpand('quantMoreStocksBtn',  'quantMoreStocksPanel');
    bindExpand('quantMoreIndBtn',     'quantMoreIndPanel');
    bindExpand('quantMoreStratsBtn',  'quantMoreStratsPanel');

    // Run backtest
    var runBtn = document.getElementById('quantRunBacktest');
    if (runBtn) runBtn.addEventListener('click', function () {
        if (Q.candles.length < 30) return;
        runBtn.disabled = true;
        runBtn.textContent = 'Running…';
        var bt = runBacktest(Q.candles, Q.activeStrat);
        quantRenderAll(bt);
        var sign = bt.totalReturn >= 0 ? '+' : '';
        document.getElementById('btReturn').textContent  = sign + bt.totalReturn.toFixed(1) + '%';
        document.getElementById('btTrades').textContent  = bt.tradeCount;
        document.getElementById('btWinRate').textContent = bt.winRate.toFixed(1) + '%';
        document.getElementById('btMaxDD').textContent   = bt.maxDD.toFixed(1) + '%';
        document.getElementById('btReturn').style.color  = bt.totalReturn >= 0 ? '#0d9488' : '#ef4444';
        document.getElementById('quantResults').classList.remove('quant-hidden');
        runBtn.disabled = false;
        runBtn.textContent = 'Run Backtest';
    });

    // Sub-chart toggle (RSI / MACD)
    function bindSubToggle(btnId, divId) {
        var btn = document.getElementById(btnId);
        var div = document.getElementById(divId);
        if (!btn || !div) return;
        btn.addEventListener('click', function () {
            var hide = !div.classList.contains('quant-hidden');
            div.classList.toggle('quant-hidden', hide);
            btn.classList.toggle('active', !hide);
            if (!hide && divId === 'quantMacdDiv') {
                initMacdChart();
                if (Q.candles.length > 0) quantRenderAll();
            }
            var rsiDiv  = document.getElementById('quantRsiDiv');
            var macdDiv = document.getElementById('quantMacdDiv');
            var dual    = !rsiDiv.classList.contains('quant-hidden') &&
                          !macdDiv.classList.contains('quant-hidden');
            var quantMain = document.getElementById('quantMain');
            var wasDual   = quantMain.classList.contains('quant-dual');
            quantMain.classList.toggle('quant-dual', dual);
            // Reset inline sizes when switching modes so CSS rules take effect cleanly
            if (dual !== wasDual) {
                rsiDiv.style.cssText  = '';
                macdDiv.style.cssText = '';
            }
        });
    }
    bindSubToggle('quantRsiToggle',  'quantRsiDiv');
    bindSubToggle('quantMacdToggle', 'quantMacdDiv');

    var aiToggleBtn = document.getElementById('quantAiToggle');
    if (aiToggleBtn) {
        aiToggleBtn.addEventListener('click', function () {
            var chat = document.getElementById('qtAiChat');
            if (!chat) return;
            var isOpen = chat.style.display !== 'none' && chat.style.display !== '';
            if (isOpen) {
                exitAIMode();
                aiToggleBtn.classList.remove('active');
            } else {
                enterAIMode('');
                aiToggleBtn.classList.add('active');
            }
        });
    }

    // Strategy button tooltips
    var _tip = document.getElementById('qtStratTip');
    if (_tip) {
        document.querySelectorAll('.quant-strat-btn[data-tip]').forEach(function (btn) {
            btn.addEventListener('mouseenter', function (e) {
                _tip.textContent = btn.dataset.tip;
                _tip.classList.add('visible');
                _positionTip(e);
            });
            btn.addEventListener('mousemove', _positionTip);
            btn.addEventListener('mouseleave', function () {
                _tip.classList.remove('visible');
            });
        });
        function _positionTip(e) {
            var margin = 10;
            var tw = _tip.offsetWidth || 240;
            var th = _tip.offsetHeight || 60;
            var x = e.clientX + margin;
            var y = e.clientY - th - margin;
            if (x + tw > window.innerWidth - margin) x = e.clientX - tw - margin;
            if (y < margin) y = e.clientY + margin;
            _tip.style.left = x + 'px';
            _tip.style.top  = y + 'px';
        }
    }
}

/* ── Strategy Builder ───────────────────────────────────────────────── */
var _SB = {
    step: 0,
    answers: [],
    questions: [
        {
            text: 'Which assets are you most interested in?',
            opts: [
                { label: 'Bitcoin (BTC)',                    val: 'Bitcoin (BTC)' },
                { label: 'Ethereum (ETH)',                   val: 'Ethereum (ETH)' },
                { label: 'Solana (SOL)',                     val: 'Solana (SOL)' },
                { label: 'Large-caps (BTC + ETH + BNB)',    val: 'large-cap assets: BTC, ETH, and BNB' },
                { label: 'Altcoins (SOL, XRP, ADA, AVAX)',  val: 'altcoins: SOL, XRP, ADA, and AVAX' },
                { label: 'Meme coins (DOGE, SHIB, PEPE)',   val: 'meme coins: DOGE, SHIB, and PEPE' },
            ],
        },
        {
            text: 'What is your investment horizon?',
            opts: [
                { label: 'Long-term hold  (1 year+)',        val: 'long-term holding (1 year or more)' },
                { label: 'Short-term trading (days–weeks)',  val: 'short-term trading (days to weeks)' },
                { label: 'Balanced (mix of both)',           val: 'a balanced mix of long-term holding and short-term trading' },
            ],
        },
        {
            text: 'What is your risk appetite?',
            opts: [
                { label: 'Aggressive — high risk, high reward', val: 'aggressive (comfortable with high volatility for potentially higher returns)' },
                { label: 'Conservative — capital first',         val: 'conservative (capital preservation is the top priority)' },
                { label: 'Balanced — moderate risk',             val: 'balanced (moderate risk tolerance)' },
            ],
        },
    ],
};

function sbRender(idx) {
    var stage = document.getElementById('quantSbStage');
    if (!stage) return;
    var q = _SB.questions[idx];

    var card = document.createElement('div');
    card.className = 'qt-sb-card qt-sb-enter';

    var optsHtml = q.opts.map(function (o, i) {
        return '<button class="qt-sb-opt" data-i="' + i + '">' + o.label + '</button>';
    }).join('');
    card.innerHTML = '<p class="qt-sb-q">' + q.text + '</p>'
                   + '<div class="qt-sb-opts">' + optsHtml + '</div>';

    card.querySelectorAll('.qt-sb-opt').forEach(function (btn) {
        btn.addEventListener('click', function () {
            if (btn.classList.contains('qt-sb-chosen')) return;
            btn.classList.add('qt-sb-chosen');
            _SB.answers[idx] = q.opts[parseInt(btn.dataset.i)].val;

            // Animate exit
            card.classList.add('qt-sb-exit');
            setTimeout(function () {
                if (card.parentNode) card.parentNode.removeChild(card);
                if (idx < _SB.questions.length - 1) {
                    sbRender(idx + 1);
                } else {
                    sbShowResult();
                }
            }, 320);
        });
    });

    stage.appendChild(card);
    requestAnimationFrame(function () {
        requestAnimationFrame(function () { card.classList.remove('qt-sb-enter'); });
    });
}

function sbShowResult() {
    var stage = document.getElementById('quantSbStage');
    if (!stage) return;

    var card = document.createElement('div');
    card.className = 'qt-sb-card qt-sb-enter';
    card.innerHTML = '<p class="qt-sb-result-text">Ready to generate your personalized investment analysis.</p>'
                   + '<button class="qt-sb-launch" id="quantSbLaunch">Generate Analysis →</button>';
    stage.appendChild(card);
    requestAnimationFrame(function () {
        requestAnimationFrame(function () { card.classList.remove('qt-sb-enter'); });
    });

    var reset = document.getElementById('quantSbReset');
    if (reset) reset.classList.remove('quant-hidden');

    document.getElementById('quantSbLaunch').addEventListener('click', sbLaunch);
}

function sbBuildContext() {
    var asset = _SB.answers[0] || 'BTC';
    var ctx = 'Asset of interest: ' + asset + '. ';
    if (Q.candles && Q.candles.length > 0) {
        var last  = Q.candles[Q.candles.length - 1];
        var first = Q.candles[0];
        var highs = Q.candles.map(function (c) { return c.high; });
        var lows  = Q.candles.map(function (c) { return c.low; });
        var hi = Math.max.apply(null, highs).toFixed(2);
        var lo = Math.min.apply(null, lows).toFixed(2);
        var chg = ((last.close - first.close) / first.close * 100).toFixed(2);
        var trend = +chg > 0 ? 'uptrend' : +chg < 0 ? 'downtrend' : 'sideways';
        ctx += 'Current price (OKX live): $' + last.close.toFixed(2) + '. ';
        ctx += 'Recent range (' + Q.candles.length + ' ' + Q.bar + ' bars): $' + lo + ' – $' + hi + '. ';
        ctx += 'Overall trend: ' + trend + ' (' + (chg > 0 ? '+' : '') + chg + '%). ';
        ctx += 'Data source: OKX real-time market data.';
    }
    return ctx;
}

function sbLaunch() {
    var asset   = _SB.answers[0] || 'Bitcoin (BTC)';
    var horizon = _SB.answers[1] || 'long-term holding';
    var risk    = _SB.answers[2] || 'balanced';
    var context = sbBuildContext();

    // Open the AI chat panel
    var chatEl = document.getElementById('qtAiChat');
    var aiBtn  = document.getElementById('quantAiToggle');
    _aiHistory = [];
    if (chatEl) chatEl.style.display = 'flex';
    if (aiBtn)  aiBtn.classList.add('active');

    var msgsEl = document.getElementById('qtAiMsgs');
    if (!msgsEl) return;
    msgsEl.innerHTML = '';

    // Show user profile as a user bubble
    var userBubble = document.createElement('div');
    userBubble.className = 'qt-ai-msg qt-ai-msg-user';
    userBubble.textContent = asset + '  ·  ' + horizon + '  ·  ' + risk + ' risk';
    msgsEl.appendChild(userBubble);

    // Build the analysis prompt
    var prompt = [
        'Investor profile:',
        '- Asset of interest: ' + asset,
        '- Investment horizon: ' + horizon,
        '- Risk appetite: ' + risk,
        '',
        'Live market context:',
        context,
        '',
        'Please provide a concise investment analysis covering:',
        '1. Current trend and momentum',
        '2. Key support/resistance levels and risk factors',
        '3. A concrete recommendation with entry strategy',
    ].join('\n');

    _sbSendAnalysis(prompt, msgsEl);
}

function _sbSendAnalysis(prompt, msgsEl) {
    if (!msgsEl) msgsEl = document.getElementById('qtAiMsgs');

    var thinkDiv = document.createElement('div');
    thinkDiv.className = 'qt-ai-msg qt-ai-msg-ai qt-ai-thinking-bubble';
    thinkDiv.textContent = 'Caloogy is thinking…';
    msgsEl.appendChild(thinkDiv);
    msgsEl.scrollTop = msgsEl.scrollHeight;

    var ANALYSIS_SYSTEM = [
        'You are Caloogy, a professional crypto investment analyst.',
        'Provide clear, data-driven investment analysis in plain English.',
        'Write in concise paragraphs. Use numbered lists for recommendations.',
        'Do NOT generate JavaScript code. Do NOT use markdown fences.',
        'Be specific and actionable.',
    ].join(' ');

    var aiDiv = null;  // created on first chunk so thinkDiv stays visible
    var full  = '';
    var ctrl  = new AbortController();
    var tid   = setTimeout(function () { ctrl.abort(); }, 40000);

    fetch('/api/ai/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message: prompt, cosplay: ANALYSIS_SYSTEM,
                                  session_id: null, history: [], force_rag: false, cot: false }),
        signal:  ctrl.signal,
    }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var reader = res.body.getReader();
        var dec = new TextDecoder();
        var buf = '';

        function pump() {
            reader.read().then(function (r) {
                clearTimeout(tid);
                if (r.done) { thinkDiv.remove(); return; }
                buf += dec.decode(r.value, { stream: true });
                var parts = buf.split('\n\n'); buf = parts.pop();
                parts.forEach(function (p) {
                    if (!p.startsWith('data: ')) return;
                    var chunk = p.slice(6).trim();
                    if (chunk === '[DONE]') return;
                    try {
                        var d = JSON.parse(chunk);
                        if (d.text) {
                            full += d.text;
                            thinkDiv.remove();
                            if (!aiDiv) {
                                aiDiv = document.createElement('div');
                                aiDiv.className = 'qt-ai-msg qt-ai-msg-ai';
                                aiDiv.style.whiteSpace = 'pre-wrap';
                                msgsEl.appendChild(aiDiv);
                            }
                            aiDiv.textContent = full;
                            msgsEl.scrollTop = msgsEl.scrollHeight;
                        }
                    } catch (e) {}
                });
                pump();
            }).catch(function (e) {
                thinkDiv.remove();
                var errDiv = document.createElement('div');
                errDiv.className = 'qt-ai-msg qt-ai-msg-ai';
                errDiv.textContent = '✗ ' + e.message;
                msgsEl.appendChild(errDiv);
            });
        }
        pump();
    }).catch(function (e) {
        thinkDiv.remove();
        var errDiv = document.createElement('div');
        errDiv.className = 'qt-ai-msg qt-ai-msg-ai';
        errDiv.textContent = '✗ ' + (e.name === 'AbortError' ? 'Request timed out' : e.message);
        msgsEl.appendChild(errDiv);
    });
}

function sbInit() {
    var toggle = document.getElementById('quantSbToggle');
    var stage  = document.getElementById('quantSbStage');
    var reset  = document.getElementById('quantSbReset');

    // Toggle expand/collapse on header click (but not on reset button)
    if (toggle && stage) {
        toggle.addEventListener('click', function (e) {
            if (reset && reset.contains(e.target)) return;
            var collapsed = stage.classList.contains('quant-hidden');
            stage.classList.toggle('quant-hidden', !collapsed);
            toggle.classList.toggle('open', collapsed);
            if (collapsed && stage.children.length === 0) sbRender(0);
        });
    }

    if (reset) reset.addEventListener('click', function (e) {
        e.stopPropagation();
        _SB.step = 0;
        _SB.answers = [];
        if (stage) stage.innerHTML = '';
        reset.classList.add('quant-hidden');
        sbRender(0);
    });
    // Don't auto-render on init — stage is hidden by default
}

/* ── Refresh chart colors on theme change ───────────────────────────── */
function refreshChartColors() {
    var c = getColors();
    var opts = {
        layout: { background: { type: 'solid', color: c.bg }, textColor: c.text },
        grid:   { vertLines: { color: c.border }, horzLines: { color: c.border } },
        rightPriceScale: { borderColor: c.border },
        timeScale:       { borderColor: c.border },
    };
    ['candle', 'rsi', 'equity', 'macd'].forEach(function (k) {
        if (Q.charts[k]) Q.charts[k].applyOptions(opts);
    });
}

/* ── Pine Editor ────────────────────────────────────────────────────── */
var _PINE_AUTO_COLORS = ['#f59e0b','#6366f1','#10b981','#f43f5e','#3b82f6','#a855f7','#ec4899'];

var _PINE_DEFAULT = [
'// 💡 Type  caloogy  and press Enter to open Caloogy AI chat',
'',
'// Available: candles, closes, highs, lows, opens, volumes',
'// plot(name, array, color?)   — overlay line on main chart',
'// mark(index, "buy"|"sell", text?)  — add arrow marker',
'',
'var fast = ema(closes, 9);',
'var slow = ema(closes, 21);',
'plot("EMA 9",  fast, "#f59e0b");',
'plot("EMA 21", slow, "#6366f1");',
'',
'for (var i = 1; i < closes.length; i++) {',
'  if (fast[i-1] <= slow[i-1] && fast[i] > slow[i]) mark(i, "buy");',
'  if (fast[i-1] >= slow[i-1] && fast[i] < slow[i]) mark(i, "sell");',
'}',
].join('\n');

var _PINE_TEMPLATES = {
    ema_cross: _PINE_DEFAULT,
    rsi_signal: [
'var rsiVals = calcRsi(closes, 14);',
'plot("RSI", rsiVals, "#818cf8");',
'',
'for (var i = 1; i < closes.length; i++) {',
'  if (rsiVals[i-1] !== null && rsiVals[i] !== null) {',
'    if (rsiVals[i-1] <= 30 && rsiVals[i] > 30) mark(i, "buy",  "OS");',
'    if (rsiVals[i-1] >= 70 && rsiVals[i] < 70) mark(i, "sell", "OB");',
'  }',
'}',
    ].join('\n'),
    bb_bands: [
'var bb = bollinger(closes, 20, 2.0);',
'var upper = bb.map(function(v) { return v ? v.upper  : null; });',
'var mid   = bb.map(function(v) { return v ? v.middle : null; });',
'var lower = bb.map(function(v) { return v ? v.lower  : null; });',
'plot("BB Upper",  upper, "#6366f1");',
'plot("BB Mid",    mid,   "#94a3b8");',
'plot("BB Lower",  lower, "#6366f1");',
'',
'for (var i = 1; i < closes.length; i++) {',
'  if (!bb[i] || !bb[i-1]) continue;',
'  if (closes[i-1] < bb[i-1].lower && closes[i] >= bb[i].lower) mark(i, "buy");',
'  if (closes[i-1] < bb[i-1].upper && closes[i] >= bb[i].upper) mark(i, "sell");',
'}',
    ].join('\n'),
    vwap_dev: [
'var vw = calcVWAP(candles, 50);',
'plot("VWAP", vw, "#10b981");',
'',
'var dev = 0.02; // 2% deviation threshold',
'for (var i = 1; i < closes.length; i++) {',
'  if (!vw[i] || !vw[i-1]) continue;',
'  var d  = (closes[i]   - vw[i])   / vw[i];',
'  var pd = (closes[i-1] - vw[i-1]) / vw[i-1];',
'  if (pd < -dev && d >= -dev) mark(i, "buy");',
'  if (pd <  dev && d >=  dev) mark(i, "sell");',
'}',
    ].join('\n'),

    // ── Advanced templates ───────────────────────────────────────────────

    triple_ema: [
'// Triple EMA Trend System',
'// All three EMAs must align before a signal is taken.',
'// Entry: fast crosses mid while mid > slow (trend confirmed).',
'var e9   = ema(closes, 9);',
'var e21  = ema(closes, 21);',
'var e55  = ema(closes, 55);',
'plot("EMA 9",  e9,  "#f59e0b");',
'plot("EMA 21", e21, "#6366f1");',
'plot("EMA 55", e55, "#ef4444");',
'',
'for (var i = 1; i < closes.length; i++) {',
'  if (!e9[i] || !e21[i] || !e55[i]) continue;',
'  var bullTrend = e21[i] > e55[i]; // mid above slow = uptrend',
'  var bearTrend = e21[i] < e55[i];',
'  if (bullTrend && e9[i-1] <= e21[i-1] && e9[i] > e21[i]) mark(i, "buy");',
'  if (bearTrend && e9[i-1] >= e21[i-1] && e9[i] < e21[i]) mark(i, "sell");',
'}',
    ].join('\n'),

    macd_rsi: [
'// MACD × RSI Confluence',
'// Signal only when MACD histogram turns AND RSI confirms momentum direction.',
'var m    = calcMacd(closes, 12, 26, 9);',
'var rsi  = calcRsi(closes, 14);',
'var fast = ema(closes, 12);',
'var slow = ema(closes, 26);',
'plot("EMA 12", fast, "#10b981");',
'plot("EMA 26", slow, "#f43f5e");',
'',
'for (var i = 1; i < closes.length; i++) {',
'  var mc = m.macd[i],  mp = m.macd[i-1];',
'  var sc = m.signal[i], sp = m.signal[i-1];',
'  if (!mc || !mp || !sc || !sp || rsi[i] === null) continue;',
'  // MACD crosses above signal AND RSI > 50 (bullish momentum)',
'  if (mp <= sp && mc > sc && rsi[i] > 50) mark(i, "buy",  "M+R");',
'  if (mp >= sp && mc < sc && rsi[i] < 50) mark(i, "sell", "M+R");',
'}',
    ].join('\n'),

    bb_squeeze: [
'// Bollinger Band Squeeze (Keltner Method)',
'// When BB bands sit inside Keltner channel = volatility compressed.',
'// Breakout signal fires when BB expands beyond Keltner on either side.',
'var bb  = bollinger(closes, 20, 2.0);',
'var kc  = calcKeltner(candles, 20, 1.5);',
'var mid = bb.map(function(v) { return v ? v.middle : null; });',
'var bbU = bb.map(function(v) { return v ? v.upper  : null; });',
'var bbL = bb.map(function(v) { return v ? v.lower  : null; });',
'plot("BB Upper", bbU,      "#6366f1");',
'plot("BB Mid",   mid,      "#94a3b8");',
'plot("BB Lower", bbL,      "#6366f1");',
'plot("KC Upper", kc.upper, "#f59e0b");',
'plot("KC Lower", kc.lower, "#f59e0b");',
'',
'for (var i = 1; i < closes.length; i++) {',
'  if (!bb[i] || !bb[i-1] || !kc.upper[i] || !kc.upper[i-1]) continue;',
'  var wasSqueezed = bb[i-1].upper < kc.upper[i-1] && bb[i-1].lower > kc.lower[i-1];',
'  var nowFree     = bb[i].upper >= kc.upper[i] || bb[i].lower <= kc.lower[i];',
'  if (wasSqueezed && nowFree) {',
'    if (closes[i] > mid[i]) mark(i, "buy",  "SQZ");',
'    else                     mark(i, "sell", "SQZ");',
'  }',
'}',
    ].join('\n'),

    adx_filter: [
'// ADX Trend Filter + EMA Cross',
'// Classic EMA crossover, but only enter when ADX > 25 (strong trend).',
'// Avoids whipsaws in low-volatility ranging markets.',
'var fast = ema(closes, 9);',
'var slow = ema(closes, 21);',
'var adx  = calcADX(candles, 14);',
'plot("EMA 9",  fast,    "#f59e0b");',
'plot("EMA 21", slow,    "#6366f1");',
'plot("DI+",    adx.diP, "#10b981");',
'plot("DI-",    adx.diM, "#ef4444");',
'',
'for (var i = 1; i < closes.length; i++) {',
'  if (!fast[i] || !slow[i] || !adx.adx[i]) continue;',
'  if (adx.adx[i] < 25) continue; // skip weak-trend bars',
'  if (fast[i-1] <= slow[i-1] && fast[i] > slow[i] && adx.diP[i] > adx.diM[i])',
'    mark(i, "buy");',
'  if (fast[i-1] >= slow[i-1] && fast[i] < slow[i] && adx.diM[i] > adx.diP[i])',
'    mark(i, "sell");',
'}',
    ].join('\n'),

    zscore: [
'// Z-Score Mean Reversion',
'// Computes rolling z-score of price vs its 30-bar SMA.',
'// Extreme deviations (|z| > 2) are expected to revert to the mean.',
'var N = 30;',
'var maLine = sma(closes, N);',
'var zScore = new Array(closes.length).fill(null);',
'for (var i = N - 1; i < closes.length; i++) {',
'  var sum = 0;',
'  for (var j = i - N + 1; j <= i; j++) sum += closes[j];',
'  var mean = sum / N;',
'  var vsum = 0;',
'  for (var j = i - N + 1; j <= i; j++) vsum += (closes[j]-mean)*(closes[j]-mean);',
'  var std = Math.sqrt(vsum / N);',
'  zScore[i] = std > 0 ? (closes[i] - mean) / std : 0;',
'}',
'plot("SMA 30", maLine, "#94a3b8");',
'',
'// Upper/lower bands at ±1.5 σ for visual reference',
'var upper15 = maLine.map(function(m, i) {',
'  if (m === null) return null;',
'  var vsum = 0;',
'  for (var j = i - N + 1; j <= i; j++) vsum += (closes[j]-m)*(closes[j]-m);',
'  return m + 1.5 * Math.sqrt(vsum / N);',
'});',
'var lower15 = maLine.map(function(m, i) {',
'  if (m === null) return null;',
'  var vsum = 0;',
'  for (var j = i - N + 1; j <= i; j++) vsum += (closes[j]-m)*(closes[j]-m);',
'  return m - 1.5 * Math.sqrt(vsum / N);',
'});',
'plot("+1.5σ", upper15, "#6366f1");',
'plot("-1.5σ", lower15, "#6366f1");',
'',
'// Reversion entry: z-score crosses back through ±2.0',
'for (var i = 1; i < closes.length; i++) {',
'  if (zScore[i] === null || zScore[i-1] === null) continue;',
'  if (zScore[i-1] <= -2.0 && zScore[i] > -2.0) mark(i, "buy",  "Z↑");',
'  if (zScore[i-1] >= +2.0 && zScore[i] < +2.0) mark(i, "sell", "Z↓");',
'}',
    ].join('\n'),

    ichimoku: [
'// Ichimoku Cloud — Full System',
'// Buy: price above cloud AND Tenkan crosses above Kijun.',
'// Sell: price below cloud AND Tenkan crosses below Kijun.',
'var ichi = calcIchimoku(candles, 9, 26);',
'plot("Tenkan (9)",  ichi.tenkan, "#f59e0b");',
'plot("Kijun (26)", ichi.kijun,  "#ef4444");',
'',
'// Senkou Span A = (Tenkan + Kijun) / 2, shifted 26 bars forward (shown in-place)',
'var senkouA = ichi.tenkan.map(function(t, i) {',
'  return (t !== null && ichi.kijun[i] !== null) ? (t + ichi.kijun[i]) / 2 : null;',
'});',
'// Senkou Span B = 52-bar midpoint',
'var senkouB = new Array(candles.length).fill(null);',
'for (var i = 51; i < candles.length; i++) {',
'  var hi = -Infinity, lo = Infinity;',
'  for (var j = i - 51; j <= i; j++) {',
'    if (candles[j].high > hi) hi = candles[j].high;',
'    if (candles[j].low  < lo) lo = candles[j].low;',
'  }',
'  senkouB[i] = (hi + lo) / 2;',
'}',
'plot("Senkou A", senkouA, "#10b981");',
'plot("Senkou B", senkouB, "#a855f7");',
'',
'for (var i = 1; i < closes.length; i++) {',
'  var t = ichi.tenkan, k = ichi.kijun;',
'  if (!t[i] || !k[i] || !senkouA[i] || !senkouB[i]) continue;',
'  var cloudTop    = Math.max(senkouA[i], senkouB[i]);',
'  var cloudBottom = Math.min(senkouA[i], senkouB[i]);',
'  var aboveCloud  = closes[i] > cloudTop;',
'  var belowCloud  = closes[i] < cloudBottom;',
'  var tkBull = t[i-1] <= k[i-1] && t[i] > k[i];',
'  var tkBear = t[i-1] >= k[i-1] && t[i] < k[i];',
'  if (aboveCloud && tkBull) mark(i, "buy",  "TK↑");',
'  if (belowCloud && tkBear) mark(i, "sell", "TK↓");',
'}',
    ].join('\n'),

    donchian_turtle: [
'// Donchian Breakout — Turtle Trading Style',
'// Enter long on 20-bar high breakout; exit on 10-bar low breakdown.',
'// Enter short on 20-bar low breakdown; exit on 10-bar high breakout.',
'var dc20 = donchian(closes, 20);',
'var dc10 = donchian(closes, 10);',
'var dc20H = dc20.map(function(v) { return v ? v.high : null; });',
'var dc20L = dc20.map(function(v) { return v ? v.low  : null; });',
'var dc10H = dc10.map(function(v) { return v ? v.high : null; });',
'var dc10L = dc10.map(function(v) { return v ? v.low  : null; });',
'plot("DC20 High", dc20H, "#10b981");',
'plot("DC20 Low",  dc20L, "#ef4444");',
'plot("DC10 High", dc10H, "#6366f1");',
'plot("DC10 Low",  dc10L, "#a855f7");',
'',
'var pos = 0; // 1 = long, -1 = short, 0 = flat',
'for (var i = 1; i < closes.length; i++) {',
'  if (!dc20[i] || !dc20[i-1] || !dc10[i]) continue;',
'  if (pos === 0) {',
'    if (closes[i] > dc20[i-1].high) { mark(i, "buy",  "BK↑"); pos =  1; }',
'    if (closes[i] < dc20[i-1].low)  { mark(i, "sell", "BK↓"); pos = -1; }',
'  } else if (pos === 1) {',
'    if (dc10[i] && closes[i] < dc10[i].low)  { mark(i, "sell", "Ex"); pos = 0; }',
'  } else if (pos === -1) {',
'    if (dc10[i] && closes[i] > dc10[i].high) { mark(i, "buy",  "Ex"); pos = 0; }',
'  }',
'}',
    ].join('\n'),

    obv_confirm: [
'// OBV Trend Confirmation',
'// Combines price EMA crossover with on-balance-volume EMA crossover.',
'// Both must agree: price momentum + volume momentum in the same direction.',
'var pFast = ema(closes, 12);',
'var pSlow = ema(closes, 26);',
'plot("EMA 12", pFast, "#f59e0b");',
'plot("EMA 26", pSlow, "#6366f1");',
'',
'var obv     = calcOBV(candles);',
'var obvFast = ema(obv, 12);',
'var obvSlow = ema(obv, 26);',
'// Normalise OBV cross direction to ±1 so we can compare without scale',
'var obvBull = new Array(candles.length).fill(null);',
'var obvBear = new Array(candles.length).fill(null);',
'for (var i = 1; i < candles.length; i++) {',
'  if (!obvFast[i] || !obvSlow[i]) continue;',
'  var crossUp   = obvFast[i-1] <= obvSlow[i-1] && obvFast[i] > obvSlow[i];',
'  var crossDown = obvFast[i-1] >= obvSlow[i-1] && obvFast[i] < obvSlow[i];',
'  if (!pFast[i] || !pSlow[i]) continue;',
'  var priceBull = pFast[i-1] <= pSlow[i-1] && pFast[i] > pSlow[i];',
'  var priceBear = pFast[i-1] >= pSlow[i-1] && pFast[i] < pSlow[i];',
'  // Confluent: price cross AND volume cross in same direction',
'  if (priceBull && obvFast[i] > obvSlow[i]) mark(i, "buy",  "V↑");',
'  if (priceBear && obvFast[i] < obvSlow[i]) mark(i, "sell", "V↓");',
'  // OBV cross leads price (volume precedes price)',
'  if (crossUp   && pFast[i] > pSlow[i])     mark(i, "buy",  "OBV");',
'  if (crossDown && pFast[i] < pSlow[i])     mark(i, "sell", "OBV");',
'}',
    ].join('\n'),

    hull_momentum: [
'// Hull MA Momentum System',
'// Hull MA responds faster than EMA while staying smooth.',
'// Signal on fast/slow HMA crossover; direction filter via longer HMA slope.',
'var hma9  = calcHullMA(closes, 9);',
'var hma25 = calcHullMA(closes, 25);',
'var hma50 = calcHullMA(closes, 50);',
'plot("HMA 9",  hma9,  "#f59e0b");',
'plot("HMA 25", hma25, "#6366f1");',
'plot("HMA 50", hma50, "#94a3b8");',
'',
'for (var i = 2; i < closes.length; i++) {',
'  if (!hma9[i] || !hma25[i] || !hma50[i]) continue;',
'  var upTrend   = hma50[i] > hma50[i-1]; // HMA50 sloping up',
'  var downTrend = hma50[i] < hma50[i-1];',
'  var cross9up   = hma9[i-1] <= hma25[i-1] && hma9[i] > hma25[i];',
'  var cross9down = hma9[i-1] >= hma25[i-1] && hma9[i] < hma25[i];',
'  if (upTrend   && cross9up)   mark(i, "buy");',
'  if (downTrend && cross9down) mark(i, "sell");',
'}',
    ].join('\n'),

    supertrend_rsi: [
'// Supertrend + RSI Double Filter',
'// Supertrend gives the primary direction; RSI prevents chasing extremes.',
'// Only buy when Supertrend flips bullish AND RSI is not yet overbought.',
'var st  = calcSupertrend(candles, 10, 3.0);',
'var rsi = calcRsi(closes, 14);',
'var ma  = ema(closes, 20);',
'plot("EMA 20", ma, "#94a3b8");',
'',
'for (var i = 1; i < closes.length; i++) {',
'  if (!st.dir[i] || rsi[i] === null) continue;',
'  var stFlipBull = st.dir[i-1] === -1 && st.dir[i] === 1;',
'  var stFlipBear = st.dir[i-1] ===  1 && st.dir[i] === -1;',
'  if (stFlipBull && rsi[i] < 65) mark(i, "buy",  "ST↑");',
'  if (stFlipBear && rsi[i] > 35) mark(i, "sell", "ST↓");',
'}',
    ].join('\n'),

    // ── Professional / Research-grade templates ──────────────────────────

    linear_reg: [
'// Linear Regression Channel',
'// Least-squares fit through N bars; ±2σ envelope as dynamic support/resistance.',
'// Price returning to the channel after extreme deviation = mean-reversion entry.',
'var N = 50;',
'var regLine = new Array(closes.length).fill(null);',
'var upper2  = new Array(closes.length).fill(null);',
'var lower2  = new Array(closes.length).fill(null);',
'',
'for (var i = N - 1; i < closes.length; i++) {',
'  var sx = 0, sy = 0, sxy = 0, sx2 = 0;',
'  for (var j = 0; j < N; j++) {',
'    sx  += j; sy  += closes[i - N + 1 + j];',
'    sxy += j * closes[i - N + 1 + j]; sx2 += j * j;',
'  }',
'  var det = N * sx2 - sx * sx;',
'  if (!det) continue;',
'  var slope = (N * sxy - sx * sy) / det;',
'  var intcp = (sy - slope * sx) / N;',
'  regLine[i] = intcp + slope * (N - 1);',
'  var se = 0;',
'  for (var j = 0; j < N; j++) {',
'    var diff = closes[i - N + 1 + j] - (intcp + slope * j);',
'    se += diff * diff;',
'  }',
'  se = Math.sqrt(se / N);',
'  upper2[i] = regLine[i] + 2 * se;',
'  lower2[i] = regLine[i] - 2 * se;',
'}',
'plot("LinReg",  regLine, "#94a3b8");',
'plot("LR +2σ", upper2,  "#6366f1");',
'plot("LR -2σ", lower2,  "#6366f1");',
'',
'for (var i = 1; i < closes.length; i++) {',
'  if (!lower2[i] || !upper2[i]) continue;',
'  if (closes[i-1] <= lower2[i-1] && closes[i] > lower2[i]) mark(i, "buy",  "LR");',
'  if (closes[i-1] >= upper2[i-1] && closes[i] < upper2[i]) mark(i, "sell", "LR");',
'}',
    ].join('\n'),

    rsi_divergence: [
'// RSI Divergence Detector',
'// Bullish: price makes local lower low but RSI makes higher low → hidden strength.',
'// Bearish: price makes local higher high but RSI makes lower high → hidden weakness.',
'// Uses a 5-bar local-extremum window.',
'var rsi = calcRsi(closes, 14);',
'var e20 = ema(closes, 20);',
'plot("RSI",    rsi, "#818cf8");',
'plot("EMA 20", e20, "#94a3b8");',
'',
'var LB = 5;',
'for (var i = LB + 1; i < closes.length - 1; i++) {',
'  if (!rsi[i] || !rsi[i - LB]) continue;',
'  var pLow = true, rLow = true, pHigh = true, rHigh = true;',
'  for (var k = 1; k <= LB; k++) {',
'    if (closes[i] >= closes[i - k]) pLow  = false;',
'    if (rsi[i]    >= rsi[i - k])    rLow  = false;',
'    if (closes[i] <= closes[i - k]) pHigh = false;',
'    if (rsi[i]    <= rsi[i - k])    rHigh = false;',
'  }',
'  // Bullish div: price lower low + RSI NOT lower low (holding up) + RSI < 50',
'  if (pLow  && !rLow  && rsi[i] < 50) mark(i, "buy",  "Div+");',
'  // Bearish div: price higher high + RSI NOT higher high + RSI > 50',
'  if (pHigh && !rHigh && rsi[i] > 50) mark(i, "sell", "Div−");',
'}',
    ].join('\n'),

    chandelier_exit: [
'// Chandelier Exit — ATR Trailing Stop',
'// Long stop  = highest-high(N) − mult × ATR(N)',
'// Short stop = lowest-low(N)  + mult × ATR(N)',
'// Direction flips when price violates the active stop.',
'// A classic professional risk-management / trend-following tool.',
'var N = 22, mult = 3.0;',
'var tr = candles.map(function(c, i) {',
'  if (i === 0) return c.high - c.low;',
'  var pc = candles[i-1].close;',
'  return Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));',
'});',
'var atr = new Array(candles.length).fill(null);',
'var s = 0;',
'for (var i = 0; i < N; i++) s += tr[i];',
'atr[N-1] = s / N;',
'for (var i = N; i < candles.length; i++)',
'  atr[i] = (atr[i-1] * (N-1) + tr[i]) / N;',
'',
'var longStop  = new Array(candles.length).fill(null);',
'var shortStop = new Array(candles.length).fill(null);',
'var dir = 1;',
'for (var i = N; i < candles.length; i++) {',
'  if (!atr[i]) continue;',
'  var hh = -Infinity, ll = Infinity;',
'  for (var j = i - N + 1; j <= i; j++) {',
'    if (highs[j] > hh) hh = highs[j];',
'    if (lows[j]  < ll) ll = lows[j];',
'  }',
'  longStop[i]  = hh - mult * atr[i];',
'  shortStop[i] = ll + mult * atr[i];',
'  if      (dir ===  1 && closes[i] < longStop[i])  { mark(i, "sell", "CE↓"); dir = -1; }',
'  else if (dir === -1 && closes[i] > shortStop[i]) { mark(i, "buy",  "CE↑"); dir =  1; }',
'}',
'plot("CE Long",  longStop,  "#10b981");',
'plot("CE Short", shortStop, "#ef4444");',
    ].join('\n'),

    heikin_ashi: [
'// Heikin-Ashi Trend Filter',
'// HA candles reduce noise by averaging OHLC across bars.',
'// Signal: 3 consecutive HA bull candles after bearish streak (and vice versa).',
'// HA open = (prev HA open + prev HA close) / 2',
'// HA close = (O+H+L+C) / 4',
'var haC = new Array(candles.length).fill(0);',
'var haO = new Array(candles.length).fill(0);',
'haO[0] = (candles[0].open + candles[0].close) / 2;',
'haC[0] = (candles[0].open + candles[0].high + candles[0].low + candles[0].close) / 4;',
'for (var i = 1; i < candles.length; i++) {',
'  haC[i] = (candles[i].open + candles[i].high + candles[i].low + candles[i].close) / 4;',
'  haO[i] = (haO[i-1] + haC[i-1]) / 2;',
'}',
'plot("HA Close", haC, "#94a3b8");',
'plot("HA EMA 9", ema(haC, 9), "#f59e0b");',
'',
'// Streak counter: positive = consecutive HA bulls, negative = bears',
'var streak = 0;',
'for (var i = 1; i < candles.length; i++) {',
'  streak = haC[i] >= haO[i] ? Math.max(0, streak) + 1 : Math.min(0, streak) - 1;',
'  if (streak ===  3) mark(i, "buy",  "HA↑");',
'  if (streak === -3) mark(i, "sell", "HA↓");',
'}',
    ].join('\n'),

    volume_rsi: [
'// Volume-Weighted RSI (VRSI)',
'// Classic factor adjustment: weight each up/down move by its bar volume.',
'// High-volume rallies count more than low-volume ones.',
'// VRSI > plain RSI → volume confirms momentum; divergence = warning.',
'var N = 14;',
'var vrsi = new Array(closes.length).fill(null);',
'var vAg = 0, vAl = 0;',
'for (var i = 1; i <= N; i++) {',
'  var d = closes[i] - closes[i-1];',
'  if (d > 0) vAg += d * volumes[i]; else vAl -= d * volumes[i];',
'}',
'vAg /= N; vAl /= N;',
'for (var i = N; i < closes.length; i++) {',
'  if (i > N) {',
'    var d = closes[i] - closes[i-1];',
'    vAg = (vAg * (N-1) + Math.max(d, 0) * volumes[i]) / N;',
'    vAl = (vAl * (N-1) + Math.max(-d, 0) * volumes[i]) / N;',
'  }',
'  vrsi[i] = 100 - 100 / (1 + (vAl === 0 ? 1e9 : vAg / vAl));',
'}',
'var rsi = calcRsi(closes, N);',
'plot("VRSI",   vrsi, "#f59e0b");',
'plot("RSI",    rsi,  "#818cf8");',
'plot("EMA 20", ema(closes, 20), "#94a3b8");',
'',
'// VRSI bullishly diverges from RSI in oversold zone = volume-supported reversal',
'for (var i = 1; i < closes.length; i++) {',
'  if (!vrsi[i] || !rsi[i]) continue;',
'  if (vrsi[i] > rsi[i] && vrsi[i] < 45 && vrsi[i-1] <= rsi[i-1]) mark(i, "buy",  "VR↑");',
'  if (vrsi[i] < rsi[i] && vrsi[i] > 55 && vrsi[i-1] >= rsi[i-1]) mark(i, "sell", "VR↓");',
'}',
    ].join('\n'),

    multi_factor: [
'// Multi-Factor Composite Signal',
'// Combines 4 normalized factors into a weighted score in [−1, +1]:',
'//   F1 Trend:     EMA-50 slope direction',
'//   F2 Momentum:  20-bar Rate-of-Change (capped at ±5%)',
'//   F3 MeanRev:   negative z-score vs SMA-30 (fade extremes)',
'//   F4 Volume:    OBV vs its EMA-20 (smart-money confirmation)',
'// Signal when composite crosses ±0.55.',
'',
'function zs(arr, per, idx) {',
'  if (idx < per - 1) return 0;',
'  var sum = 0;',
'  for (var j = idx - per + 1; j <= idx; j++) sum += arr[j];',
'  var mean = sum / per;',
'  var v = 0;',
'  for (var j = idx - per + 1; j <= idx; j++) v += (arr[j]-mean)*(arr[j]-mean);',
'  var std = Math.sqrt(v / per);',
'  return std > 0 ? (arr[idx] - mean) / std : 0;',
'}',
'function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }',
'',
'var e50   = ema(closes, 50);',
'var roc20 = calcROC(closes, 20);',
'var obv   = calcOBV(candles);',
'var obvE  = ema(obv, 20);',
'plot("EMA 50", e50, "#94a3b8");',
'',
'var comp = new Array(closes.length).fill(null);',
'for (var i = 50; i < closes.length; i++) {',
'  if (!e50[i] || !e50[i-1] || roc20[i] === null || !obvE[i]) continue;',
'  var f1 = clamp((e50[i] - e50[i-1]) / e50[i] * 300, -1, 1);  // trend',
'  var f2 = clamp(roc20[i] / 5, -1, 1);                         // momentum',
'  var f3 = clamp(-zs(closes, 30, i) / 2, -1, 1);               // mean-rev',
'  var f4 = obv[i] > obvE[i] ? 1 : -1;                          // volume',
'  comp[i] = f1*0.35 + f2*0.30 + f3*0.15 + f4*0.20;',
'}',
'',
'// Visualise composite score as a band around EMA-50',
'var compViz = comp.map(function(c, i) {',
'  return (c !== null && e50[i]) ? e50[i] * (1 + c * 0.015) : null;',
'});',
'plot("Factor", compViz, "#a855f7");',
'',
'var THR = 0.55;',
'for (var i = 1; i < closes.length; i++) {',
'  if (comp[i] === null || comp[i-1] === null) continue;',
'  if (comp[i-1] <= THR  && comp[i] >  THR)  mark(i, "buy",  "F+");',
'  if (comp[i-1] >= -THR && comp[i] < -THR) mark(i, "sell", "F−");',
'}',
    ].join('\n'),

    williams_fractal: [
'// Williams Fractal + Alligator (Bill Williams)',
'// Fractal high: bar[i].high is the highest of any 5-bar window centred on i.',
'// Fractal low: bar[i].low is the lowest of the window.',
'// Alligator: 3 SMMA lines (jaw/teeth/lips) − price "waking up" triggers entry.',
'',
'function smma(arr, n) {',
'  var out = new Array(arr.length).fill(null);',
'  var s = 0;',
'  for (var i = 0; i < n; i++) s += arr[i];',
'  out[n-1] = s / n;',
'  for (var i = n; i < arr.length; i++)',
'    out[i] = (out[i-1] * (n-1) + arr[i]) / n;',
'  return out;',
'}',
'',
'var med = candles.map(function(c) { return (c.high + c.low) / 2; });',
'var jaw   = smma(med, 13);',
'var teeth = smma(med, 8);',
'var lips  = smma(med, 5);',
'plot("Jaw (13)",   jaw,   "#3b82f6");',
'plot("Teeth (8)",  teeth, "#ef4444");',
'plot("Lips (5)",   lips,  "#10b981");',
'',
'// 5-bar fractal detection (need 2 confirmed bars on each side)',
'for (var i = 2; i < closes.length - 2; i++) {',
'  if (!teeth[i]) continue;',
'  var fracHigh = highs[i] > highs[i-1] && highs[i] > highs[i-2] &&',
'                 highs[i] > highs[i+1] && highs[i] > highs[i+2];',
'  var fracLow  = lows[i]  < lows[i-1]  && lows[i]  < lows[i-2]  &&',
'                 lows[i]  < lows[i+1]  && lows[i]  < lows[i+2];',
'  // Only trade fractals in the direction the Alligator is "awake"',
'  var awakeUp = lips[i] > teeth[i] && teeth[i] > jaw[i];',
'  var awakeDn = lips[i] < teeth[i] && teeth[i] < jaw[i];',
'  if (fracLow  && awakeUp) mark(i, "buy",  "▲F");',
'  if (fracHigh && awakeDn) mark(i, "sell", "▼F");',
'}',
    ].join('\n'),

    elder_impulse: [
'// Elder Impulse System (Alexander Elder)',
'// Green bar: EMA-13 rising AND MACD histogram rising → both indicators agree bullish.',
'// Red bar:   EMA-13 falling AND MACD histogram falling → both agree bearish.',
'// Entry: first bar where both agree after a period of disagreement.',
'var e13  = ema(closes, 13);',
'var m    = calcMacd(closes, 12, 26, 9);',
'var hist = m.macd.map(function(mc, i) {',
'  return (mc !== null && m.signal[i] !== null) ? mc - m.signal[i] : null;',
'});',
'plot("EMA 13", e13, "#94a3b8");',
'',
'for (var i = 2; i < closes.length; i++) {',
'  if (!e13[i] || !e13[i-1] || hist[i] === null || hist[i-1] === null) continue;',
'  var emaUp   = e13[i]  > e13[i-1];',
'  var emaDn   = e13[i]  < e13[i-1];',
'  var histUp  = hist[i] > hist[i-1];',
'  var histDn  = hist[i] < hist[i-1];',
'  var nowGreen = emaUp && histUp;',
'  var nowRed   = emaDn && histDn;',
'  // Was not green/red the previous bar?',
'  var prevGreen = e13[i-1] > e13[i-2] && hist[i-1] > hist[i-2];',
'  var prevRed   = e13[i-1] < e13[i-2] && hist[i-1] < hist[i-2];',
'  if (!prevGreen && nowGreen) mark(i, "buy",  "⚡");',
'  if (!prevRed   && nowRed)   mark(i, "sell", "⚡");',
'}',
    ].join('\n'),

    inside_bar: [
'// Inside Bar Breakout — Price Action',
'// Inside bar: today\'s high ≤ yesterday\'s high AND low ≥ yesterday\'s low.',
'// Signals a consolidation pause; breakout direction = next move.',
'// Only trade breakouts that align with the 50-bar EMA trend.',
'var e50  = ema(closes, 50);',
'var ibH  = new Array(candles.length).fill(null);',
'var ibL  = new Array(candles.length).fill(null);',
'var ibs  = [];',
'',
'for (var i = 1; i < candles.length; i++) {',
'  if (highs[i] <= highs[i-1] && lows[i] >= lows[i-1]) {',
'    ibs.push(i);',
'    ibH[i] = highs[i-1]; // mother bar high',
'    ibL[i] = lows[i-1];  // mother bar low',
'  }',
'}',
'plot("IB High", ibH, "#f59e0b");',
'plot("IB Low",  ibL, "#6366f1");',
'plot("EMA 50",  e50, "#94a3b8");',
'',
'for (var j = 0; j < ibs.length; j++) {',
'  var idx  = ibs[j];',
'  var next = idx + 1;',
'  if (next >= candles.length || !e50[next]) continue;',
'  var mH = highs[idx-1], mL = lows[idx-1];',
'  // Breakout above mother bar high in uptrend',
'  if (closes[next] > mH && closes[next] > e50[next]) mark(next, "buy",  "IB↑");',
'  // Breakdown below mother bar low in downtrend',
'  if (closes[next] < mL && closes[next] < e50[next]) mark(next, "sell", "IB↓");',
'}',
    ].join('\n'),

    mean_rev_backtest: [
'// Mean Reversion Backtest with Equity Curve',
'// Enters when z-score < −1.8 (oversold), exits when z-score > −0.5.',
'// Visualises running P&L as a line on the chart (scaled to price).',
'var PER = 30, zEntry = -1.8, zExit = -0.5;',
'var ma = sma(closes, PER);',
'plot("SMA 30", ma, "#94a3b8");',
'',
'function rollingZ(i) {',
'  if (i < PER - 1 || !ma[i]) return 0;',
'  var v = 0;',
'  for (var j = i - PER + 1; j <= i; j++) v += (closes[j]-ma[i])*(closes[j]-ma[i]);',
'  var s = Math.sqrt(v / PER);',
'  return s > 0 ? (closes[i] - ma[i]) / s : 0;',
'}',
'',
'var equity  = new Array(candles.length).fill(null);',
'var pnl     = 0;',
'var entryPx = null;',
'for (var i = PER; i < candles.length; i++) {',
'  var z = rollingZ(i);',
'  if (entryPx === null && z < zEntry) {',
'    entryPx = closes[i]; mark(i, "buy", "z↓");',
'  } else if (entryPx !== null && z > zExit) {',
'    pnl += (closes[i] - entryPx) / entryPx;',
'    entryPx = null; mark(i, "sell", "z↑");',
'  }',
'  equity[i] = ma[i] * (1 + pnl * 0.3); // scale P&L band around SMA',
'}',
'plot("Equity", equity, "#10b981");',
'',
'// Upper/lower z-score bands',
'var zHi = ma.map(function(m, i) {',
'  if (!m || i < PER-1) return null;',
'  var v = 0;',
'  for (var j = i-PER+1; j <= i; j++) v += (closes[j]-m)*(closes[j]-m);',
'  return m + Math.abs(zEntry) * Math.sqrt(v/PER);',
'});',
'var zLo = ma.map(function(m, i) {',
'  if (!m || i < PER-1) return null;',
'  var v = 0;',
'  for (var j = i-PER+1; j <= i; j++) v += (closes[j]-m)*(closes[j]-m);',
'  return m + zEntry * Math.sqrt(v/PER);',
'});',
'plot("z +1.8σ", zHi, "#a855f7");',
'plot("z −1.8σ", zLo, "#a855f7");',
    ].join('\n'),
};

function initPineEditor() {
    var el = document.getElementById('qtPineEditor');
    if (!el || Q._pineEditor || typeof CodeMirror === 'undefined') return;
    var c = getColors();
    Q._pineEditor = CodeMirror(el, {
        mode: 'javascript',
        lineNumbers: true,
        tabSize: 2,
        indentWithTabs: false,
        lineWrapping: false,
        value: _PINE_DEFAULT,
    });
    // Sync editor theme with site theme
    _syncPineTheme(c);

    // Enter on a line containing only "caloogy" opens AI chat without inserting a newline
    Q._pineEditor.addKeyMap({
        'Enter': function (cm) {
            if (/^caloogy\s*$/i.test(cm.getLine(cm.getCursor().line).trim())) {
                enterAIMode('');
                return;
            }
            return CodeMirror.Pass;
        }
    });

    var pineToggle = document.getElementById('quantPineToggle');
    var pineBody   = document.getElementById('quantPineBody');

    // Collapse editor by default on mobile to give chart more room
    if (window.innerWidth <= 640) {
        pineToggle.classList.remove('open');
        pineBody.classList.add('quant-hidden');
    }

    pineToggle.addEventListener('click', function () {
        var open = pineToggle.classList.toggle('open');
        pineBody.classList.toggle('quant-hidden', !open);
        if (open) Q._pineEditor.refresh();
    });

    document.getElementById('qtPineRun').addEventListener('click', runPineScript);
    document.getElementById('qtPineTemplate').addEventListener('change', function (e) {
        var key = e.target.value;
        if (key && _PINE_TEMPLATES[key]) {
            Q._pineEditor.setValue(_PINE_TEMPLATES[key]);
            Q._pineEditor.refresh();
        }
        e.target.value = '';
    });
}

function _syncPineTheme(c) {
    if (!Q._pineEditor) return;
    var wrap = Q._pineEditor.getWrapperElement();
    wrap.style.background   = c.bg;
    wrap.style.color        = c.text;
    wrap.style.borderColor  = c.border;
    // CodeMirror gutter
    var gutter = wrap.querySelector('.CodeMirror-gutters');
    if (gutter) { gutter.style.background = c.bg; gutter.style.borderColor = c.border; }
}

function runPineScript() {
    if (!Q._pineEditor || !Q.charts.candle) return;

    // "caloogy" AI mode — any line containing only "caloogy" opens the AI chat panel
    var rawLines = Q._pineEditor.getValue().split('\n');
    for (var li = 0; li < rawLines.length; li++) {
        var lt = rawLines[li].trim();
        if (/^caloogy\s*$/i.test(lt)) {
            enterAIMode('');
            return;
        }
    }

    Q.userSeries.forEach(function (s) { try { Q.charts.candle.removeSeries(s); } catch (e) {} });
    Q.userSeries = [];
    Q.userMarkers = [];

    var status = document.getElementById('qtPineStatus');
    if (!Q.candles || Q.candles.length === 0) {
        status.textContent = 'No data loaded — select a symbol first.';
        status.className = 'qt-pine-status err';
        return;
    }

    status.textContent = 'Running…';
    status.className = 'qt-pine-status';

    var code    = Q._pineEditor.getValue();
    var candles = Q.candles;
    var closes  = candles.map(function (c) { return c.close; });
    var highs   = candles.map(function (c) { return c.high; });
    var lows    = candles.map(function (c) { return c.low; });
    var opens   = candles.map(function (c) { return c.open; });
    var volumes = candles.map(function (c) { return c.volume; });
    var times   = candles.map(function (c) { return Math.floor(c.ts / 1000); });
    var _ci = 0, plots = [], markers = [];

    function plot(name, arr, color) {
        var clr = color || _PINE_AUTO_COLORS[_ci++ % _PINE_AUTO_COLORS.length];
        var data = [];
        for (var i = 0; i < candles.length; i++) {
            if (arr[i] !== null && arr[i] !== undefined && isFinite(arr[i]))
                data.push({ time: times[i], value: +arr[i] });
        }
        plots.push({ name: name, color: clr, data: data });
    }

    function mark(idx, dir, text) {
        if (idx < 0 || idx >= candles.length) return;
        markers.push({
            time:     times[idx],
            position: dir === 'buy' ? 'belowBar' : 'aboveBar',
            color:    dir === 'buy' ? '#0d9488'  : '#ef4444',
            shape:    dir === 'buy' ? 'arrowUp'  : 'arrowDown',
            text:     text || (dir === 'buy' ? 'B' : 'S'),
        });
    }

    try {
        new Function(
            'candles','closes','highs','lows','opens','volumes',
            'sma','ema','calcRsi','bollinger','calcMacd',
            'calcStochastic','calcSupertrend','calcCCI','calcROC',
            'calcTRIX','calcCMO','calcHullMA','calcVWAP','calcOBV',
            'calcWilliamsR','calcADX','calcKeltner','calcIchimoku','calcPSAR',
            'donchian','plot','mark',
            code
        )(
            candles, closes, highs, lows, opens, volumes,
            sma, ema, calcRsi, bollinger, calcMacd,
            calcStochastic, calcSupertrend, calcCCI, calcROC,
            calcTRIX, calcCMO, calcHullMA, calcVWAP, calcOBV,
            calcWilliamsR, calcADX, calcKeltner, calcIchimoku, calcPSAR,
            donchian, plot, mark
        );
        plots.forEach(function (p) {
            var s = Q.charts.candle.addLineSeries({ color: p.color, lineWidth: 1, title: p.name, lastValueVisible: true, priceLineVisible: false });
            s.setData(p.data);
            Q.userSeries.push(s);
        });
        Q.userMarkers = markers.sort(function (a, b) { return a.time - b.time; });
        Q.series.candle.setMarkers(Q.userMarkers);
        status.textContent = '✓ ' + Q.userSeries.length + ' series · ' + Q.userMarkers.length + ' markers';
        status.className = 'qt-pine-status ok';
    } catch (err) {
        status.textContent = '✗ ' + err.message;
        status.className = 'qt-pine-status err';
    }
}

/* ── Caloogy AI Chat Mode ─────────────────────────────────────────────── */
var _aiHistory = [];

var _AI_SYSTEM = [
    'You are Caloogy Code, a quant AI assistant embedded in a crypto charting tool.',
    'STRICT RULES: Always respond in English only, regardless of the language used by the user.',
    'You ONLY discuss quantitative trading strategies, technical indicators, and code generation.',
    'If the user asks about anything unrelated to quant/trading, politely redirect them to trading topics.',
    'Available data: candles({open,high,low,close,volume,ts}[]), closes, highs, lows, opens, volumes.',
    'Indicator functions available: sma(arr,n) ema(arr,n) calcRsi(arr,n) bollinger(arr,n,mult) calcMacd(closes,fast,slow,sig)',
    'donchian(closes,n) calcIchimoku(candles,t,k) calcPSAR(candles,step,max) calcWilliamsR(candles,p)',
    'calcADX(candles,p) calcKeltner(candles,p,m) calcTRIX(closes,p) calcCMO(closes,p) calcHullMA(closes,p)',
    'calcVWAP(candles,p) calcOBV(candles) calcStochastic(candles,k,d) calcSupertrend(candles,p,m)',
    'calcCCI(candles,p) calcROC(closes,p)',
    'Output API: plot(name, numberArray, color?) overlays a line on the PRICE chart; mark(index, "buy"|"sell", text?) adds an arrow on the price chart.',
    'CRITICAL SCALE WARNING: plot() draws on the price chart (values in USD, e.g. $40,000–$100,000). NEVER plot bounded oscillators (RSI 0-100, Stochastic 0-100, Williams %R -100-0, CCI, CMO, etc.) directly — their tiny values (30, 70) will be invisible against price. Instead: use mark() for buy/sell signals from oscillators, and add a text comment explaining the threshold used.',
    'For moving averages, Bollinger bands, VWAP, Supertrend, Donchian — these ARE price-scale and can be plotted.',
    'For code requests: reply with 1-2 sentences of explanation, then output the complete runnable JS in a ```javascript block.',
    'For general questions about trading/indicators: answer conversationally in English without a code block.',
    'IMPORTANT: Use only var (not const or let). Always null-check indicator values before use (e.g. if (arr[i] === null) continue).',
    'Never use fetch/DOM/window/localStorage/console in generated code.',
].join('\n');

function enterAIMode(initialMsg) {
    if (!window.caloogyUser) {
        if (window.showAuthModal) window.showAuthModal('Please sign in to use Caloogy AI.');
        return;
    }
    var editorEl = document.getElementById('qtPineEditor');
    var chatEl   = document.getElementById('qtAiChat');
    if (!chatEl) return;

    chatEl.style.display   = 'flex';
    _aiHistory = [];
    var msgsEl = document.getElementById('qtAiMsgs');
    msgsEl.innerHTML = '';

    // Default greeting bubble
    var greet = document.createElement('div');
    greet.className = 'qt-ai-msg qt-ai-msg-ai qt-ai-greeting';
    greet.textContent = 'Ask Caloogy anything — describe a strategy, indicator, or analysis and I\'ll generate the code.';
    msgsEl.appendChild(greet);

    var status  = document.getElementById('qtPineStatus');
    var input   = document.getElementById('qtAiInput');
    var sendBtn = document.getElementById('qtAiSend');
    var exitBtn = document.getElementById('qtAiExit');

    status.textContent = '';
    status.className   = 'qt-pine-status';

    sendBtn.onclick = function () {
        var msg = input.value.trim();
        if (!msg || sendBtn.disabled) return;
        input.value = '';
        sendAIMessage(msg);
    };
    input.onkeydown = function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBtn.click(); }
    };
    exitBtn.onclick = exitAIMode;

    if (initialMsg) { sendAIMessage(initialMsg); } else { input.focus(); }
}

function exitAIMode() {
    var chatEl = document.getElementById('qtAiChat');
    if (chatEl) chatEl.style.display = 'none';
    var status = document.getElementById('qtPineStatus');
    status.textContent = ''; status.className = 'qt-pine-status';
    var btn = document.getElementById('quantAiToggle');
    if (btn) btn.classList.remove('active');
}

function _appendAiMsg(role, text, code) {
    var msgs = document.getElementById('qtAiMsgs');
    var div  = document.createElement('div');
    div.className = 'qt-ai-msg ' + (role === 'user' ? 'qt-ai-msg-user' : 'qt-ai-msg-ai');

    var explanation = code ? text.split('```')[0].trim() : text;
    if (explanation) {
        var p = document.createElement('div');
        p.textContent = explanation;
        div.appendChild(p);
    }

    if (code) {
        var pre = document.createElement('pre');
        pre.className = 'qt-ai-msg-code';
        pre.textContent = code.length > 600 ? code.slice(0, 600) + '\n…' : code;
        div.appendChild(pre);

        // Applied automatically — show a re-apply button as fallback
        var btn = document.createElement('button');
        btn.className = 'qt-ai-apply-btn';
        btn.textContent = '↺ Re-apply & Run';
        var capturedCode = code;
        btn.onclick = function () {
            Q._pineEditor.setValue(capturedCode);
            Q._pineEditor.refresh();
            runPineScript();
        };
        div.appendChild(btn);
    }

    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
}

function _detectCoinSymbol(text) {
    var t = text.toUpperCase();
    if (/\bETH\b|ETHEREUM/.test(t))        return 'ETHUSDT';
    if (/\bSOL\b|SOLANA/.test(t))          return 'SOLUSDT';
    if (/\bBNB\b|BINANCE[\s-]?COIN/.test(t)) return 'BNBUSDT';
    if (/\bBTC\b|BITCOIN/.test(t))         return 'BTCUSDT';
    return null;
}

function _switchSymbol(sym) {
    Q.symbol = sym;
    var sel = '#quantSymbolPills .quant-pill, #quantExtraSymbolPills .quant-pill';
    document.querySelectorAll(sel).forEach(function (b) {
        b.classList.toggle('active', b.dataset.val === sym);
    });
}

function sendAIMessage(text) {
    _appendAiMsg('user', text, null);
    _aiHistory.push({ role: 'user', content: text });

    var status  = document.getElementById('qtPineStatus');
    var sendBtn = document.getElementById('qtAiSend');
    status.textContent = '';
    status.className   = 'qt-pine-status';
    sendBtn.disabled   = true;

    // Auto-switch coin if the user mentions a different one
    var detectedSym = _detectCoinSymbol(text);
    if (detectedSym && detectedSym !== Q.symbol) {
        _switchSymbol(detectedSym);
        var ticker = detectedSym.replace('USDT', '');
        // Show thinking bubble, then wait for data to load before calling the AI
        var msgs0 = document.getElementById('qtAiMsgs');
        var thinkDiv0 = document.createElement('div');
        thinkDiv0.className = 'qt-ai-msg qt-ai-msg-ai qt-ai-thinking-bubble';
        thinkDiv0.textContent = 'Switching to ' + ticker + '…';
        msgs0.appendChild(thinkDiv0);
        msgs0.scrollTop = msgs0.scrollHeight;
        Q._onFetchDone = function () {
            thinkDiv0.remove();
            _doSendAIRequest(text, status, sendBtn);
        };
        quantFetch();
        return;
    }

    _doSendAIRequest(text, status, sendBtn);
}

function _doSendAIRequest(text, status, sendBtn) {
    var _PRIMER = [
        { role: 'user',  parts: [{ text: 'What are you?' }] },
        { role: 'model', parts: [{ text: 'I am Caloogy Code, a quant trading AI. I generate JavaScript code for crypto chart analysis. I always respond in English and only discuss quantitative trading.' }] },
        { role: 'user',  parts: [{ text: 'Draw a simple EMA crossover.' }] },
        { role: 'model', parts: [{ text: 'EMA 9/21 crossover: buy when fast crosses above slow, sell when it crosses below.\n\n```javascript\nvar fast = ema(closes, 9);\nvar slow = ema(closes, 21);\nplot("EMA 9", fast, "#10b981");\nplot("EMA 21", slow, "#f59e0b");\nfor (var i = 1; i < closes.length; i++) {\n  if (fast[i] === null || slow[i] === null || fast[i-1] === null || slow[i-1] === null) continue;\n  if (fast[i-1] < slow[i-1] && fast[i] >= slow[i]) mark(i, "buy", "X↑");\n  if (fast[i-1] > slow[i-1] && fast[i] <= slow[i]) mark(i, "sell", "X↓");\n}\n```' }] },
    ];

    var userHistory = _aiHistory.slice(0, -1).map(function (h) {
        return { role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.content }] };
    });
    var histPayload = _PRIMER.concat(userHistory);

    var wrappedMsg = [
        'MANDATORY RESPONSE FORMAT (follow exactly):',
        '1. Write ONE sentence (≤20 words) in English describing what the strategy does.',
        '2. Output the complete runnable JavaScript in a ```javascript code block.',
        'Available functions: sma ema calcRsi bollinger calcMacd donchian calcIchimoku calcPSAR calcWilliamsR calcADX calcKeltner calcTRIX calcCMO calcHullMA calcVWAP calcOBV calcStochastic calcSupertrend calcCCI calcROC plot(name,arr,color?) mark(idx,"buy"|"sell",text?)',
        'Data arrays: candles closes highs lows opens volumes.',
        'NEVER output code as prose. ALWAYS use the ```javascript fence.',
        'Use only var (never const or let). Always null-check before using indicator values.',
        '⚠️ SCALE RULE (HARD): plot() draws on the PRICE chart (axis: ~$20,000–$100,000 USD).',
        '  - NEVER call plot() with a bounded oscillator array (RSI 0-100, Stochastic, Williams %R, CCI, CMO, etc.).',
        '  - Bounded oscillators MUST only use mark() to annotate signals on the candles, never plot().',
        '  - Only call plot() for price-scale values: moving averages, Bollinger Bands, VWAP, Supertrend, Ichimoku, PSAR.',
        '  - Violating this rule makes the chart completely wrong and useless — do NOT do it.',
        '',
        'User request: ' + text,
    ].join('\n');

    var msgs = document.getElementById('qtAiMsgs');
    var thinkDiv = document.createElement('div');
    thinkDiv.className = 'qt-ai-msg qt-ai-msg-ai qt-ai-thinking-bubble';
    thinkDiv.textContent = 'Caloogy is thinking…';
    msgs.appendChild(thinkDiv);
    msgs.scrollTop = msgs.scrollHeight;

    var ctrl = new AbortController();
    var tid  = setTimeout(function () { ctrl.abort(); }, 40000);

    fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message: wrappedMsg, cosplay: _AI_SYSTEM,
            session_id: null, history: histPayload,
            force_rag: false, cot: false,
        }),
        signal: ctrl.signal,
    }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var reader = res.body.getReader();
        var dec = new TextDecoder();
        var buf = '', full = '';

        function pump() {
            reader.read().then(function (r) {
                clearTimeout(tid);
                if (r.done) {
                    var cm = full.match(/```(?:javascript|js)?\s*([\s\S]*?)```/);
                    var code = cm ? cm[1].trim() : null;
                    thinkDiv.remove();
                    _appendAiMsg('assistant', full, code);
                    _aiHistory.push({ role: 'assistant', content: full });
                    sendBtn.disabled = false;
                    var inp = document.getElementById('qtAiInput');
                    if (inp) inp.focus();
                    if (code && Q._pineEditor) {
                        Q._pineEditor.setValue(code);
                        Q._pineEditor.refresh();
                        status.textContent = '✨ Code applied — running…';
                        status.className   = 'qt-pine-status ai-ok';
                        runPineScript();
                    } else {
                        status.textContent = '✨ Caloogy AI';
                        status.className   = 'qt-pine-status ai-ok';
                    }
                    return;
                }
                buf += dec.decode(r.value, { stream: true });
                var parts = buf.split('\n\n'); buf = parts.pop();
                parts.forEach(function (p) {
                    if (!p.startsWith('data: ')) return;
                    var chunk = p.slice(6).trim();
                    if (chunk === '[DONE]') return;
                    try {
                        var d = JSON.parse(chunk);
                        if (d.text) {
                            full += d.text;
                            msgs.scrollTop = msgs.scrollHeight;
                        }
                        if (d.error) {
                            status.textContent = '✗ ' + d.error;
                            status.className = 'qt-pine-status err';
                        }
                    } catch (e) {}
                });
                pump();
            }).catch(function (e) {
                sendBtn.disabled = false;
                thinkDiv.remove();
                _appendAiMsg('assistant', '✗ ' + e.message, null);
            });
        }
        pump();
    }).catch(function (e) {
        sendBtn.disabled = false;
        var errMsg = e.name === 'AbortError' ? 'Request timed out — please try again' : e.message;
        _appendAiMsg('assistant', '✗ ' + errMsg, null);
    });
}

/* ── Public entry ───────────────────────────────────────────────────── */
/* ── Drag-resize for chart panels ───────────────────────────────────── */
function initDragResize() {
    var quantMain = document.getElementById('quantMain');
    var rsiDiv    = document.getElementById('quantRsiDiv');
    var macdDiv   = document.getElementById('quantMacdDiv');
    var vDrag     = document.getElementById('qtVDrag');
    var hDrag     = document.getElementById('qtHDrag');
    var subColW   = 280; // tracks current right-panel width in dual mode
    var drag      = { active: false };

    // Single-mode: drag the top edge of a sub-chart to resize it
    [rsiDiv, macdDiv].forEach(function (chartDiv) {
        var handle = chartDiv.querySelector('.qt-hdrag-top');
        if (!handle) return;
        handle.addEventListener('mousedown', function (e) {
            e.preventDefault();
            drag = { active: true, type: 'sub-h', el: chartDiv,
                     startY: e.clientY, startH: chartDiv.offsetHeight };
        });
    });

    // Dual-mode: vertical handle — resize left/right split
    vDrag.addEventListener('mousedown', function (e) {
        e.preventDefault();
        vDrag.classList.add('dragging');
        drag = { active: true, type: 'dual-v', startX: e.clientX, startW: subColW };
    });

    // Dual-mode: horizontal handle — resize RSI vs MACD height
    hDrag.addEventListener('mousedown', function (e) {
        e.preventDefault();
        hDrag.classList.add('dragging');
        drag = { active: true, type: 'dual-h', el: rsiDiv,
                 startY: e.clientY, startH: rsiDiv.offsetHeight };
    });

    document.addEventListener('mousemove', function (e) {
        if (!drag.active) return;
        if (drag.type === 'sub-h') {
            // Drag top edge up → chart grows
            var h = Math.max(60, Math.min(420, drag.startH + (drag.startY - e.clientY)));
            drag.el.style.height    = h + 'px';
            drag.el.style.maxHeight = h + 'px';
        } else if (drag.type === 'dual-v') {
            // Drag left → sub-col grows; drag right → sub-col shrinks
            subColW = Math.max(160, Math.min(560, drag.startW - (e.clientX - drag.startX)));
            quantMain.style.setProperty('--qt-sub-w', subColW + 'px');
        } else if (drag.type === 'dual-h') {
            // Drag down → RSI grows, MACD shrinks
            var h = Math.max(60, drag.startH + (e.clientY - drag.startY));
            drag.el.style.flex      = 'none';
            drag.el.style.height    = h + 'px';
            drag.el.style.maxHeight = h + 'px';
        }
    });

    document.addEventListener('mouseup', function () {
        if (!drag.active) return;
        drag.active = false;
        vDrag.classList.remove('dragging');
        hDrag.classList.remove('dragging');
    });
}

window._initQuantTab = function () {
    if (Q.inited) return;
    Q.inited = true;
    initCharts();
    quantBindUI();
    quantFetch();
    sbInit();
    initPineEditor();
    initDragResize();
    new MutationObserver(function (ms) {
        ms.forEach(function (m) {
            if (m.attributeName === 'data-theme') {
                refreshChartColors();
                _syncPineTheme(getColors());
            }
        });
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
};

})();
