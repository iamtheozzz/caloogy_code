'use strict';

const express = require('express');
const path    = require('path');
const net     = require('net');

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
const db      = require('./lib/db');

// Copy caloogy_utils.py to ~/.caloogy/ so Python scripts can import it
function installPythonUtils() {
    const src  = path.join(__dirname, 'lib', 'caloogy_utils.py');
    const dest = path.join(db.DB_DIR, 'caloogy_utils.py');
    try {
        require('fs').mkdirSync(db.DB_DIR, { recursive: true });
        require('fs').copyFileSync(src, dest);
    } catch (e) {
        console.warn('[DB] Could not install caloogy_utils.py:', e.message);
    }
}

// ── CSV helpers ────────────────────────────────────────────────────────────────

function parseTimestamp(val) {
    if (val == null || val === '') return null;
    const s = String(val).trim();
    if (/^\d{13}$/.test(s)) return parseInt(s);               // Unix ms
    if (/^\d{10}$/.test(s)) return parseInt(s) * 1000;        // Unix seconds
    const d = new Date(s.replace(/(\d{4})\/(\d{2})\/(\d{2})/, '$1-$2-$3'));
    return isNaN(d) ? null : d.getTime();
}

function parseCSVText(text) {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
        .map(l => l.trim()).filter(l => l.length);
    if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row.');

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/["']/g, ''));
    const findCol = (...names) => names.reduce((f, n) => f >= 0 ? f : headers.indexOf(n), -1);

    const dateIdx   = findCol('date','datetime','timestamp','time','ts');
    const openIdx   = findCol('open','o');
    const highIdx   = findCol('high','h');
    const lowIdx    = findCol('low','l');
    const closeIdx  = findCol('close','c','price');
    const volumeIdx = findCol('volume','vol','v');

    if (dateIdx  < 0) throw new Error('Cannot detect date column. Rename a column to date/datetime/timestamp and retry.');
    if (closeIdx < 0) throw new Error('Cannot detect close column. Rename a column to close/price and retry.');

    const candles = [], errors = [], warnings = [];
    let skipped = 0, ohlcViolations = 0;

    for (let i = 1; i < lines.length; i++) {
        const cells = lines[i].split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
        const ts    = parseTimestamp(cells[dateIdx]);
        const close = parseFloat(cells[closeIdx]);
        if (!ts || isNaN(close)) { skipped++; continue; }

        const open   = openIdx  >= 0 ? (parseFloat(cells[openIdx])   || close) : close;
        const high   = highIdx  >= 0 ? (parseFloat(cells[highIdx])   || close) : close;
        const low    = lowIdx   >= 0 ? (parseFloat(cells[lowIdx])    || close) : close;
        const volume = volumeIdx >= 0 ? (parseFloat(cells[volumeIdx]) || 0)    : 0;

        if (high < low) { ohlcViolations++; errors.push(`Row ${i+1}: high(${high}) < low(${low})`); }
        candles.push({ ts, open, high, low, close, volume });
    }

    // Sort by ts, detect out-of-order
    let outOfOrder = 0;
    for (let i = 1; i < candles.length; i++) {
        if (candles[i].ts <= candles[i-1].ts) outOfOrder++;
    }
    if (outOfOrder > 0) {
        warnings.push(`${outOfOrder} out-of-order timestamp(s) detected (auto-sorted)`);
        candles.sort((a, b) => a.ts - b.ts);
    }

    return { candles, skipped, ohlcViolations, errors, warnings };
}

function startServer(cfg) {
    const app = express();
    app.use(express.json({ limit: '20mb' }));  // larger limit for CSV uploads

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

    // ── Python script runner ──────────────────────────────────────────────────
    app.post('/api/run-python', (req, res) => {
        const { code, candles } = req.body;
        if (!code) return res.status(400).json({ error: 'code required' });

        const { spawn }  = require('child_process');
        const os         = require('os');
        const fs         = require('fs');
        const pathMod    = require('path');
        const tmpFile    = pathMod.join(os.tmpdir(), `caloogy_${Date.now()}_${Math.random().toString(36).slice(2)}.py`);

        try { fs.writeFileSync(tmpFile, code); } catch (e) {
            return res.status(500).json({ error: 'Failed to write temp script: ' + e.message });
        }

        const input = JSON.stringify({ candles: candles || [] });
        let stdout = '', stderr = '';

        const proc = spawn('python3', [tmpFile], {
            env: { ...process.env, CALOOGY_DB_PATH: db.DB_PATH },
        });
        const timer = setTimeout(() => {
            proc.kill();
            fs.unlink(tmpFile, () => {});
            res.status(400).json({ error: 'Timeout: script took longer than 10 seconds.' });
        }, 10000);

        proc.stdin.write(input);
        proc.stdin.end();
        proc.stdout.on('data', d => { stdout += d; });
        proc.stderr.on('data', d => { stderr += d; });

        proc.on('close', code => {
            clearTimeout(timer);
            fs.unlink(tmpFile, () => {});
            if (res.headersSent) return;
            if (code !== 0) return res.status(400).json({ error: stderr.trim() || 'Python exited with error.' });
            try {
                res.json(JSON.parse(stdout));
            } catch {
                res.status(400).json({ error: 'Script must end with print(json.dumps({...})). Output was:\n' + stdout.slice(0, 300) });
            }
        });

        proc.on('error', err => {
            clearTimeout(timer);
            fs.unlink(tmpFile, () => {});
            if (res.headersSent) return;
            if (err.code === 'ENOENT') return res.status(500).json({ error: 'python3 not found. Install Python 3 from python.org.' });
            res.status(500).json({ error: err.message });
        });
    });

    // ── Yahoo Finance proxy (avoids CORS for stock data) ─────────────────────
    app.get('/api/market/yahoo', async (req, res) => {
        const { symbol, interval, range } = req.query;
        if (!symbol || !interval || !range) {
            return res.status(400).json({ error: 'symbol, interval, range required' });
        }
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
            + `?interval=${interval}&range=${range}&includePrePost=false&events=`;
        try {
            const r = await fetch(url, {
                headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
            });
            if (!r.ok) throw new Error('yahoo ' + r.status);
            res.json(await r.json());
        } catch (e) {
            res.status(502).json({ error: e.message });
        }
    });

    // ── Database API ──────────────────────────────────────────────────────────

    app.get('/api/db/status', async (req, res) => {
        try {
            const meta = await db.listSyncMeta();
            res.json({ meta, size: db.dbFileSize(), path: db.DB_PATH });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/db/preview', async (req, res) => {
        const { symbol, interval } = req.query;
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        if (!symbol || !interval) return res.status(400).json({ error: 'symbol and interval required' });
        try {
            const rows = await db.queryCandles(symbol, interval, limit);
            res.json(rows);
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/db/export', async (req, res) => {
        const { symbol, interval } = req.query;
        if (!symbol || !interval) return res.status(400).json({ error: 'symbol and interval required' });
        try {
            const csv = await db.exportCSV(symbol, interval);
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${symbol}_${interval}.csv"`);
            res.send(csv);
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.delete('/api/db/symbol', async (req, res) => {
        const { symbol, interval } = req.query;
        if (!symbol || !interval) return res.status(400).json({ error: 'symbol and interval required' });
        try {
            await db.deleteSymbol(symbol, interval);
            res.json({ ok: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/db/upload-csv', async (req, res) => {
        const { symbol, interval, csvContent } = req.body || {};
        if (!symbol || !interval || !csvContent) {
            return res.status(400).json({ error: 'symbol, interval, and csvContent required' });
        }
        try {
            const { candles, skipped, ohlcViolations, errors, warnings } = parseCSVText(csvContent);
            if (!candles.length) {
                return res.status(400).json({ error: 'No valid rows found in CSV.', errors });
            }
            const written = await db.upsertCandles(symbol.toUpperCase(), interval, candles, 'csv');
            res.json({ ok: true, written, skipped, ohlcViolations, errors, warnings });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    app.post('/api/db/sync', async (req, res) => {
        const { symbol, interval } = req.body || {};
        if (!symbol || !interval) return res.status(400).json({ error: 'symbol and interval required' });
        try {
            const candles = await monitor.fetchCandles(symbol, interval, 300);
            const written = await db.upsertCandles(symbol, interval, candles, 'api');
            res.json({ ok: true, written });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/db/query', async (req, res) => {
        const { sql } = req.body || {};
        if (!sql) return res.status(400).json({ error: 'sql required' });
        const safe = /^\s*(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN|PRAGMA|WITH)\b/i.test(sql.trim());
        if (!safe) return res.status(400).json({
            error: 'Read-only query interface. Use SELECT, SHOW, DESCRIBE, or EXPLAIN.'
        });
        try {
            const rows    = await db.runQuery(sql);
            const columns = rows.length ? Object.keys(rows[0]) : [];
            res.json({ columns, rows: rows.map(r => columns.map(c => r[c])), total: rows.length });
        } catch (e) { res.status(400).json({ error: e.message }); }
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

    // Initialize DB and install Python utils before starting
    try { db.getDB(); } catch (e) { console.warn('[DB] Init warning:', e.message); }
    installPythonUtils();

    let server;
    return new Promise((resolve, reject) => {
        findFreePort(3000).then(port => {
            server = app.listen(port, '127.0.0.1', () => {
                monitor.startMonitor(cfg);
                resolve(port);
            });
        }).catch(reject);
    });
}

module.exports = { startServer };
