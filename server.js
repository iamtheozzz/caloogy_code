'use strict';

const express   = require('express');
const path      = require('path');
const net       = require('net');
const WebSocket = require('ws');

// ── Helpers ─────────────────────────────────────────────────────────────────

function sseChunk(res, text) {
    res.write(`data: ${JSON.stringify({ text })}\n\n`);
}

function sseDone(res) {
    res.write('data: [DONE]\n\n');
    res.end();
}

function sseError(res, msg) {
    res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
}

// Convert Gemini-format history to OpenAI/Claude format
function toOpenAIHistory(history, systemPrompt) {
    const msgs = [];
    if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt });
    for (const h of (history || [])) {
        const role    = h.role === 'model' ? 'assistant' : 'user';
        const content = Array.isArray(h.parts) ? h.parts.map(p => p.text || '').join('') : (h.content || '');
        msgs.push({ role, content });
    }
    return msgs;
}

// ── AI providers ─────────────────────────────────────────────────────────────

const GEMINI_MODELS = ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro'];

async function streamGemini(res, { key, model: modelOverride, message, cosplay, history }) {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genai      = new GoogleGenerativeAI(key);
    const modelName  = modelOverride || GEMINI_MODELS[0];
    const model      = genai.getGenerativeModel({ model: modelName, systemInstruction: cosplay || undefined });
    const chat       = model.startChat({ history: history || [] });
    const result     = await chat.sendMessageStream(message);
    for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) sseChunk(res, text);
    }
    sseDone(res);
}

async function streamOpenAI(res, { key, message, cosplay, history }) {
    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey: key });
    const msgs   = toOpenAIHistory(history, cosplay);
    msgs.push({ role: 'user', content: message });
    const stream = await client.chat.completions.create({
        model: 'gpt-4o',
        messages: msgs,
        stream: true,
    });
    for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content || '';
        if (text) sseChunk(res, text);
    }
    sseDone(res);
}

async function streamClaude(res, { key, message, cosplay, history }) {
    const Anthropic = require('@anthropic-ai/sdk');
    const client    = new Anthropic({ apiKey: key });
    const msgs      = toOpenAIHistory(history, null);  // no system in messages
    msgs.push({ role: 'user', content: message });
    const stream = client.messages.stream({
        model: 'claude-opus-4-7',
        max_tokens: 4096,
        system: cosplay || undefined,
        messages: msgs,
    });
    for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            sseChunk(res, event.delta.text);
        }
    }
    sseDone(res);
}

// ── Port helper ───────────────────────────────────────────────────────────────

function findFreePort(start) {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.listen(start, () => {
            const port = server.address().port;
            server.close(() => resolve(port));
        });
        server.on('error', () => findFreePort(start + 1).then(resolve).catch(reject));
    });
}

// ── Express app ───────────────────────────────────────────────────────────────

const monitor = require('./lib/monitor');

function startServer(cfg) {
    const app = express();
    app.use(express.json({ limit: '2mb' }));

    // Reject requests not originating from localhost
    app.use('/api', (req, res, next) => {
        const origin = req.headers.origin || '';
        const host   = req.headers.host   || '';
        const isLocal = !origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
        const isLocalHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
        if (!isLocal || !isLocalHost) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }
        next();
    });

    app.use(express.static(path.join(__dirname, 'public')));

    app.post('/api/ai/chat', async (req, res) => {
        const { message, cosplay, history } = req.body || {};
        if (!message) { res.status(400).json({ error: 'message required' }); return; }

        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        try {
            const args = { key: cfg.key, model: cfg.model, message, cosplay, history };
            if (cfg.provider === 'gemini')   await streamGemini(res, args);
            else if (cfg.provider === 'openai') await streamOpenAI(res, args);
            else if (cfg.provider === 'claude') await streamClaude(res, args);
            else sseError(res, 'Unknown provider: ' + cfg.provider);
        } catch (err) {
            console.error('[AI error]', err.message);
            sseError(res, err.message || 'AI request failed');
        }
    });

    // ── Alerts API ────────────────────────────────────────────────────────────
    app.get('/api/alerts', (req, res) => {
        res.json(monitor.readAlerts());
    });

    app.post('/api/alerts', (req, res) => {
        const rule = req.body;
        if (!rule || !rule.symbol || !rule.type) {
            return res.status(400).json({ error: 'symbol and type required' });
        }
        res.json(monitor.addAlert(rule));
    });

    app.delete('/api/alerts/:id', (req, res) => {
        monitor.removeAlert(req.params.id);
        res.json({ ok: true });
    });

    app.put('/api/alerts/:id', (req, res) => {
        monitor.updateAlert(req.params.id, req.body);
        res.json({ ok: true });
    });

    app.post('/api/alerts/test-notify', async (req, res) => {
        const hasEmail    = !!(cfg.email && cfg.gmailPass);
        const hasDiscord  = !!cfg.discordWebhook;
        const hasTelegram = !!(cfg.telegramToken && cfg.telegramChatId);
        if (!hasEmail && !hasDiscord && !hasTelegram) {
            return res.status(400).json({ error: 'No notification channel configured. Run caloogy --reconfigure.' });
        }
        try {
            await monitor.sendTestNotify(cfg);
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // Legacy alias
    app.post('/api/alerts/test-email', async (req, res) => {
        res.redirect(307, '/api/alerts/test-notify');
    });

    app.get('/api/alerts/config', (req, res) => {
        res.json({
            emailConfigured:    !!(cfg.email && cfg.gmailPass),
            discordConfigured:  !!cfg.discordWebhook,
            telegramConfigured: !!(cfg.telegramToken && cfg.telegramChatId),
            email: cfg.email || null,
        });
    });

    // Allow re-running setup: POST /api/reset-config
    app.post('/api/reset-config', (req, res) => {
        const os      = require('os');
        const fs      = require('fs');
        const cfgPath = require('path').join(os.homedir(), '.caloogy-config.json');
        try { fs.unlinkSync(cfgPath); } catch {}
        res.json({ ok: true });
        setTimeout(() => {
            server.close(() => process.exit(0));
            setTimeout(() => process.exit(0), 1000); // force-exit fallback
        }, 200);
    });

    // ── Real-time 1s WebSocket relay (OKX primary, Binance fallback) ─────
    const OKX_WS_INST = {
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

    let liveWs       = null;
    let activeSymbol = null;
    let wss          = null;

    function broadcast(candle, symbol) {
        if (!wss) return;
        const payload = JSON.stringify({ type: 'kline_1s', symbol, candle });
        wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(payload); });
    }

    function subscribeOKX(symbol) {
        const instId = OKX_WS_INST[symbol];
        if (!instId) return subscribeBindance(symbol);

        const ws = new WebSocket('wss://ws.okx.com:8443/ws/v5/public');
        liveWs = ws;

        ws.on('open', () => {
            ws.send(JSON.stringify({ op: 'subscribe', args: [{ channel: 'candle1s', instId }] }));
            // OKX requires a ping every 25s to keep connection alive
            ws._pingTimer = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) ws.send('ping');
            }, 25000);
        });

        ws.on('message', raw => {
            const txt = raw.toString();
            if (txt === 'pong') return;
            try {
                const msg = JSON.parse(txt);
                if (!msg.data || !Array.isArray(msg.data)) return;
                const d = msg.data[0];
                // OKX candle1s: [ts_ms, open, high, low, close, vol, volCcy, volCcyQuote, confirm]
                broadcast({
                    time:   Math.floor(+d[0] / 1000),
                    open:   +d[1], high: +d[2], low: +d[3], close: +d[4],
                    volume: +d[5],
                    closed: d[8] === '1',
                }, symbol);
            } catch {}
        });

        ws.on('error', () => {
            console.log('[WS] OKX failed, trying Binance…');
            clearInterval(ws._pingTimer);
            subscribeBindance(symbol);
        });

        ws.on('close', () => {
            clearInterval(ws._pingTimer);
            if (activeSymbol === symbol && liveWs === ws) {
                setTimeout(() => subscribeOKX(symbol), 3000);
            }
        });
    }

    function subscribeBindance(symbol) {
        const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_1s`);
        liveWs = ws;

        ws.on('message', raw => {
            try {
                const msg = JSON.parse(raw);
                if (msg.e !== 'kline') return;
                const k = msg.k;
                broadcast({
                    time:   Math.floor(k.t / 1000),
                    open:   +k.o, high: +k.h, low: +k.l, close: +k.c,
                    volume: +k.v,
                    closed: k.x,
                }, symbol);
            } catch {}
        });

        ws.on('error', e => console.error('[WS] Binance:', e.message));
        ws.on('close', () => {
            if (activeSymbol === symbol && liveWs === ws) {
                setTimeout(() => subscribeOKX(symbol), 3000);
            }
        });
    }

    function subscribe(symbol) {
        if (liveWs) { liveWs.terminate(); liveWs = null; }
        activeSymbol = symbol;
        subscribeOKX(symbol);
    }

    let server;
    return new Promise((resolve, reject) => {
        findFreePort(3000).then(port => {
            server = app.listen(port, '127.0.0.1', () => {
                // Attach WebSocket server to the same HTTP server
                wss = new WebSocket.Server({ server });
                wss.on('connection', ws => {
                    // Tell new client which symbol is currently streaming
                    if (activeSymbol) {
                        ws.send(JSON.stringify({ type: 'subscribed', symbol: activeSymbol }));
                    }
                    ws.on('message', raw => {
                        try {
                            const msg = JSON.parse(raw);
                            if (msg.type === 'subscribe' && msg.symbol) {
                                subscribe(msg.symbol);
                            }
                        } catch {}
                    });
                });

                subscribe('BTCUSDT');
                monitor.startMonitor(cfg);
                resolve(port);
            });
        }).catch(reject);
    });
}

module.exports = { startServer };
