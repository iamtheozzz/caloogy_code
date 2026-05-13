'use strict';

const fs      = require('fs');
const os      = require('os');
const path    = require('path');
const { sma, ema, calcRsi, calcMacd, bollinger } = require('./indicators');

const ALERTS_PATH = path.join(os.homedir(), '.caloogy-alerts.json');
const POLL_MS     = 5 * 60 * 1000; // 5 minutes

const OKX_INST = {
    BTCUSDT:'BTC-USDT', ETHUSDT:'ETH-USDT', BNBUSDT:'BNB-USDT', SOLUSDT:'SOL-USDT',
    XRPUSDT:'XRP-USDT', DOGEUSDT:'DOGE-USDT', ADAUSDT:'ADA-USDT', AVAXUSDT:'AVAX-USDT',
    LINKUSDT:'LINK-USDT', DOTUSDT:'DOT-USDT', UNIUSDT:'UNI-USDT', LTCUSDT:'LTC-USDT',
    ATOMUSDT:'ATOM-USDT', NEARUSDT:'NEAR-USDT', APTUSDT:'APT-USDT', ARBUSDT:'ARB-USDT',
    OPUSDT:'OP-USDT', SUIUSDT:'SUI-USDT', TRXUSDT:'TRX-USDT', MATICUSDT:'MATIC-USDT',
    FILUSDT:'FIL-USDT', ICPUSDT:'ICP-USDT', INJUSDT:'INJ-USDT', TONUSDT:'TON-USDT',
    PEPEUSDT:'PEPE-USDT', SHIBUSDT:'SHIB-USDT', WIFUSDT:'WIF-USDT', JUPUSDT:'JUP-USDT',
    BONKUSDT:'BONK-USDT', RENDERUSDT:'RENDER-USDT', FETUSDT:'FET-USDT',
    HBARUSDT:'HBAR-USDT', VETUSDT:'VET-USDT',
};

// ── Alert file helpers ────────────────────────────────────────────────────────

function readAlerts() {
    try { return JSON.parse(fs.readFileSync(ALERTS_PATH, 'utf8')); }
    catch { return []; }
}

function saveAlerts(alerts) {
    fs.writeFileSync(ALERTS_PATH, JSON.stringify(alerts, null, 2), { encoding: 'utf8', mode: 0o600 });
}

function getAlert(id) { return readAlerts().find(a => a.id === id) || null; }

function addAlert(rule) {
    const alerts = readAlerts();
    rule.id = Math.random().toString(36).slice(2, 9);
    rule.enabled = true;
    rule.lastTriggered = null;
    alerts.push(rule);
    saveAlerts(alerts);
    return rule;
}

function removeAlert(id) {
    const alerts = readAlerts().filter(a => a.id !== id);
    saveAlerts(alerts);
}

function updateAlert(id, patch) {
    const alerts = readAlerts().map(a => a.id === id ? Object.assign({}, a, patch) : a);
    saveAlerts(alerts);
}

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchCandles(symbol) {
    const okxId = OKX_INST[symbol];
    if (okxId) {
        try {
            const url = `https://www.okx.com/api/v5/market/candles?instId=${okxId}&bar=1H&limit=100`;
            const r   = await fetch(url);
            const j   = await r.json();
            if (j.data && j.data.length > 0) {
                return j.data.slice().reverse().map(k => ({
                    ts: +k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5]
                }));
            }
        } catch {}
    }
    // Binance fallback
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=100`;
    const r   = await fetch(url);
    const j   = await r.json();
    return j.map(k => ({
        ts: +k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5]
    }));
}

// ── Alert evaluation ──────────────────────────────────────────────────────────

function evaluate(rule, candles) {
    const closes = candles.map(c => c.close);
    const last   = closes[closes.length - 1];
    const prev   = closes[closes.length - 2];

    switch (rule.type) {
        case 'price_change': {
            const lookback = rule.lookback || 3;
            const pct      = rule.pct || 5;
            const ref      = closes[closes.length - 1 - lookback];
            if (!ref) return null;
            const change = (last - ref) / ref * 100;
            if (Math.abs(change) >= pct) {
                const sign = change > 0 ? '+' : '';
                return {
                    subject: `[Caloogy Alert] ${rule.symbol} Price Spike ${sign}${change.toFixed(2)}%`,
                    body: `Asset:    ${rule.symbol}\nTrigger:  Price changed ${sign}${change.toFixed(2)}% in the last ${lookback} candles (1H)\nCurrent:  $${last.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}\nTime:     ${new Date().toUTCString()}\n\nSent by Caloogy Code running on your local machine.`,
                };
            }
            return null;
        }

        case 'rsi_threshold': {
            const rsi = calcRsi(closes, 14);
            const val = rsi[rsi.length - 1];
            const prv = rsi[rsi.length - 2];
            if (val === null || prv === null) return null;
            const thr = rule.threshold || (rule.direction === 'above' ? 70 : 30);
            const triggered = rule.direction === 'above' ? (prv < thr && val >= thr) : (prv > thr && val <= thr);
            if (triggered) {
                return {
                    subject: `[Caloogy Alert] ${rule.symbol} RSI ${rule.direction === 'above' ? 'Overbought' : 'Oversold'} (${val.toFixed(1)})`,
                    body: `Asset:    ${rule.symbol}\nTrigger:  RSI crossed ${rule.direction} ${thr} → current RSI = ${val.toFixed(1)}\nPrice:    $${last.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}\nTime:     ${new Date().toUTCString()}\n\nSent by Caloogy Code running on your local machine.`,
                };
            }
            return null;
        }

        case 'price_vs_sma': {
            const period = rule.period || 20;
            const smaArr = sma(closes, period);
            const smaLast = smaArr[smaArr.length - 1];
            const smaPrev = smaArr[smaArr.length - 2];
            if (!smaLast || !smaPrev) return null;
            const crossAbove = rule.direction === 'cross_above' && prev < smaPrev && last >= smaLast;
            const crossBelow = rule.direction === 'cross_below' && prev > smaPrev && last <= smaLast;
            if (crossAbove || crossBelow) {
                const dir = crossAbove ? 'above' : 'below';
                return {
                    subject: `[Caloogy Alert] ${rule.symbol} Price Crossed ${dir.charAt(0).toUpperCase()+dir.slice(1)} SMA${period}`,
                    body: `Asset:    ${rule.symbol}\nTrigger:  Price crossed ${dir} SMA(${period})\nPrice:    $${last.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}\nSMA${period}: $${smaLast.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}\nTime:     ${new Date().toUTCString()}\n\nSent by Caloogy Code running on your local machine.`,
                };
            }
            return null;
        }

        case 'macd_cross': {
            const { macd, signal } = calcMacd(closes, 12, 26, 9);
            const ml = macd[macd.length - 1], sl = signal[signal.length - 1];
            const mp = macd[macd.length - 2], sp = signal[signal.length - 2];
            if (ml === null || sl === null || mp === null || sp === null) return null;
            const crossAbove = rule.direction === 'cross_above' && mp < sp && ml >= sl;
            const crossBelow = rule.direction === 'cross_below' && mp > sp && ml <= sl;
            if (crossAbove || crossBelow) {
                const dir = crossAbove ? 'above' : 'below';
                return {
                    subject: `[Caloogy Alert] ${rule.symbol} MACD Crossed ${dir.charAt(0).toUpperCase()+dir.slice(1)} Signal`,
                    body: `Asset:    ${rule.symbol}\nTrigger:  MACD line crossed ${dir} Signal line\nMACD:     ${ml.toFixed(4)}\nSignal:   ${sl.toFixed(4)}\nPrice:    $${last.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}\nTime:     ${new Date().toUTCString()}\n\nSent by Caloogy Code running on your local machine.`,
                };
            }
            return null;
        }

        case 'bb_breakout': {
            const bbArr   = bollinger(closes, 20, 2);
            const bbLast  = bbArr[bbArr.length - 1];
            const bbPrev  = bbArr[bbArr.length - 2];
            if (!bbLast || !bbPrev) return null;
            const breakUp   = rule.direction === 'above_upper' && prev <= bbPrev.upper && last > bbLast.upper;
            const breakDown = rule.direction === 'below_lower' && prev >= bbPrev.lower && last < bbLast.lower;
            if (breakUp || breakDown) {
                const dir = breakUp ? 'above upper' : 'below lower';
                return {
                    subject: `[Caloogy Alert] ${rule.symbol} Price Broke ${breakUp ? 'Above Upper' : 'Below Lower'} Bollinger Band`,
                    body: `Asset:    ${rule.symbol}\nTrigger:  Price broke ${dir} Bollinger Band (20, 2)\nPrice:    $${last.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}\nBand:     $${(breakUp ? bbLast.upper : bbLast.lower).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}\nTime:     ${new Date().toUTCString()}\n\nSent by Caloogy Code running on your local machine.`,
                };
            }
            return null;
        }
    }
    return null;
}

// ── Email ─────────────────────────────────────────────────────────────────────

function makeTransporter(cfg) {
    const nodemailer = require('nodemailer');
    return nodemailer.createTransport({
        host:   'smtp.gmail.com',
        port:   587,
        secure: false,
        auth:   { user: cfg.email, pass: cfg.gmailPass },
    });
}

async function sendAlert(cfg, { subject, body }) {
    const t = makeTransporter(cfg);
    await t.sendMail({
        from:    `"Caloogy Code" <${cfg.email}>`,
        to:      cfg.email,
        subject,
        text:    body,
    });
}

async function sendTestEmail(cfg) {
    const t = makeTransporter(cfg);
    await t.sendMail({
        from:    `"Caloogy Code" <${cfg.email}>`,
        to:      cfg.email,
        subject: '[Caloogy] Test email — alerts are working',
        text:    `This is a test email from Caloogy Code.\n\nYour alert emails will be sent to this address.\nTime: ${new Date().toUTCString()}`,
    });
}

// ── Background scan loop ──────────────────────────────────────────────────────

async function scan(cfg) {
    const alerts = readAlerts().filter(a => a.enabled);
    if (alerts.length === 0) return;

    // Deduplicate symbols to minimize API calls
    const symbols = [...new Set(alerts.map(a => a.symbol))];
    const candleMap = {};
    for (const sym of symbols) {
        try { candleMap[sym] = await fetchCandles(sym); }
        catch (e) { console.error(`[Monitor] fetch failed for ${sym}:`, e.message); }
    }

    const now = Date.now();
    for (const rule of alerts) {
        const candles = candleMap[rule.symbol];
        if (!candles || candles.length < 30) continue;

        // Cooldown check
        const cooldown = (rule.cooldownMinutes || 60) * 60 * 1000;
        if (rule.lastTriggered && now - new Date(rule.lastTriggered).getTime() < cooldown) continue;

        try {
            const result = evaluate(rule, candles);
            if (result) {
                console.log(`[Monitor] Alert triggered: ${result.subject}`);
                if (cfg.email && cfg.gmailPass) {
                    await sendAlert(cfg, result);
                    console.log(`[Monitor] Email sent to ${cfg.email}`);
                }
                updateAlert(rule.id, { lastTriggered: new Date().toISOString() });
            }
        } catch (e) {
            console.error(`[Monitor] Error evaluating rule ${rule.id}:`, e.message);
        }
    }
}

function startMonitor(cfg) {
    // Initial scan after 30s, then every 5 minutes
    setTimeout(() => {
        scan(cfg).catch(e => console.error('[Monitor] scan error:', e.message));
        setInterval(() => {
            console.log('[Monitor] Scanning alerts…');
            scan(cfg).catch(e => console.error('[Monitor] scan error:', e.message));
        }, POLL_MS);
    }, 30000);
}

module.exports = { startMonitor, sendTestEmail, readAlerts, addAlert, removeAlert, updateAlert, getAlert, ALERTS_PATH };
