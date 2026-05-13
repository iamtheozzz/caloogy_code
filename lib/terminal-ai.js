'use strict';

const fs       = require('fs');
const os       = require('os');
const path     = require('path');
const readline = require('readline');
const { exec } = require('child_process');
const monitor  = require('./monitor');

const K2     = '\x1b[38;2;55;100;220m';
const K3     = '\x1b[38;2;110;155;255m';
const DIM    = '\x1b[2m';
const BOLD   = '\x1b[1m';
const RESET  = '\x1b[0m';
const YELLOW = '\x1b[33m';

// Set by startChat — asks the user y/N before a sensitive action
let _askConfirm = async () => false; // safe default: deny

// Paths and patterns whose contents must not be silently forwarded to AI servers
const HOME = os.homedir();
const SENSITIVE_PATHS = [
    path.join(HOME, '.caloogy-config.json'),
    path.join(HOME, '.ssh'),
    path.join(HOME, '.aws'),
    path.join(HOME, '.gnupg'),
    path.join(HOME, '.config', 'gcloud'),
];
const SENSITIVE_NAMES = /\.(env|pem|key|p12|pfx)$|password|secret|credential|private.?key|id_rsa|id_ed25519/i;

function isSensitive(filePath) {
    return SENSITIVE_PATHS.some(s => filePath === s || filePath.startsWith(s + path.sep))
        || SENSITIVE_NAMES.test(path.basename(filePath));
}

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM = `You are Caloogy AI, an assistant running in the user's terminal on their local machine.
You can manage crypto alerts, export price data to CSV, and access the local file system.

ALERT TYPES and their parameters:
- price_change: pct (% threshold), lookback (1H candles, default 3). direction "above" for spike, "below" for drop.
- rsi_threshold: direction ("above" = overbought, "below" = oversold), threshold (default 70/30).
- price_vs_sma: direction ("cross_above" or "cross_below"), period (SMA period, default 20).
- macd_cross: direction ("cross_above" or "cross_below").
- bb_breakout: direction ("above_upper" or "below_lower").

All crypto symbols must end in USDT — e.g. "BTC" → "BTCUSDT".
Supported: BTCUSDT ETHUSDT SOLUSDT BNBUSDT XRPUSDT DOGEUSDT ADAUSDT AVAXUSDT LINKUSDT DOTUSDT UNIUSDT LTCUSDT ATOMUSDT NEARUSDT APTUSDT ARBUSDT OPUSDT SUIUSDT TRXUSDT MATICUSDT FILUSDT ICPUSDT INJUSDT TONUSDT PEPEUSDT SHIBUSDT WIFUSDT JUPUSDT BONKUSDT RENDERUSDT FETUSDT HBARUSDT VETUSDT

CSV intervals: 1H, 4H, 1D, 1W. Max candles: 300.
If the user asks to remove an alert without specifying an ID, call list_alerts first then remove it.

FILE SYSTEM: You can read files, write files, list directories, and run shell commands on the user's machine.
Relative paths resolve from the user's current working directory. Large files are truncated at 8000 characters.
Be concise. Confirm actions in one sentence.`;

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
    {
        name: 'add_alert',
        description: 'Add a crypto price or indicator alert that monitors in the background',
        properties: {
            symbol:          { type: 'string',  desc: 'Coin symbol with USDT suffix, e.g. BTCUSDT' },
            type:            { type: 'string',  desc: 'Alert type: price_change | rsi_threshold | price_vs_sma | macd_cross | bb_breakout' },
            pct:             { type: 'number',  desc: 'price_change: minimum % change to trigger' },
            lookback:        { type: 'integer', desc: 'price_change: number of 1H candles to look back (default 3)' },
            direction:       { type: 'string',  desc: 'above | below | cross_above | cross_below | above_upper | below_lower' },
            threshold:       { type: 'number',  desc: 'rsi_threshold: RSI level (default 70 for above, 30 for below)' },
            period:          { type: 'integer', desc: 'price_vs_sma: SMA period (default 20)' },
            cooldownMinutes: { type: 'integer', desc: 'Minutes before the alert can fire again (default 60)' },
        },
        required: ['symbol', 'type'],
    },
    {
        name: 'list_alerts',
        description: 'List all configured alert rules with their IDs and status',
        properties: {},
        required: [],
    },
    {
        name: 'remove_alert',
        description: 'Remove an alert rule by its ID',
        properties: {
            id: { type: 'string', desc: 'Alert ID — obtain from list_alerts' },
        },
        required: ['id'],
    },
    {
        name: 'export_csv',
        description: 'Fetch OHLCV candlestick data for a coin and save it as a CSV file on the local machine',
        properties: {
            symbol:   { type: 'string',  desc: 'Coin symbol with USDT suffix, e.g. BTCUSDT' },
            interval: { type: 'string',  desc: 'Candle interval: 1H | 4H | 1D | 1W (default 1H)' },
            limit:    { type: 'integer', desc: 'Number of candles to fetch (default 200, max 300)' },
            filename: { type: 'string',  desc: 'Output filename, e.g. btc.csv (optional)' },
        },
        required: ['symbol'],
    },
    {
        name: 'read_file',
        description: 'Read the contents of a file on the local machine',
        properties: {
            path: { type: 'string', desc: 'Absolute or relative file path' },
        },
        required: ['path'],
    },
    {
        name: 'write_file',
        description: 'Write or overwrite a file on the local machine',
        properties: {
            path:    { type: 'string', desc: 'Absolute or relative file path' },
            content: { type: 'string', desc: 'Text content to write' },
        },
        required: ['path', 'content'],
    },
    {
        name: 'list_directory',
        description: 'List the files and subdirectories at a given path',
        properties: {
            path: { type: 'string', desc: 'Absolute or relative directory path (default: current directory)' },
        },
        required: [],
    },
    {
        name: 'run_command',
        description: 'Run a shell command on the local machine and return its output',
        properties: {
            command: { type: 'string', desc: 'Shell command to execute' },
        },
        required: ['command'],
    },
];

// ── Tool executor ─────────────────────────────────────────────────────────────

async function runTool(name, args) {
    const a = args || {};
    switch (name) {
        case 'add_alert': {
            const rule = monitor.addAlert(a);
            const extras = ['pct','lookback','direction','threshold','period','cooldownMinutes']
                .filter(k => rule[k] !== undefined).map(k => `${k}=${rule[k]}`).join(', ');
            return `Added — ID:${rule.id}  ${rule.symbol}  ${rule.type}${extras ? '  ('+extras+')' : ''}`;
        }
        case 'list_alerts': {
            const list = monitor.readAlerts();
            if (!list.length) return 'No alerts configured.';
            return list.map((a, i) => {
                const extras = ['pct','lookback','direction','threshold','period','cooldownMinutes']
                    .filter(k => a[k] !== undefined).map(k => `${k}=${a[k]}`).join(', ');
                const last = a.lastTriggered
                    ? `last: ${new Date(a.lastTriggered).toLocaleString()}`
                    : 'never triggered';
                return `${i + 1}. [${a.enabled ? 'ON' : 'OFF'}] ${a.symbol}  ${a.type}${extras ? '  ('+extras+')' : ''}\n   ID: ${a.id}  —  ${last}`;
            }).join('\n');
        }
        case 'remove_alert': {
            monitor.removeAlert(a.id);
            return `Removed alert ${a.id}.`;
        }
        case 'export_csv': {
            const interval = (a.interval || '1H').toUpperCase();
            const limit    = Math.min(+(a.limit) || 200, 300);
            const candles  = await monitor.fetchCandles(a.symbol, interval, limit);
            const header   = 'timestamp,open,high,low,close,volume';
            const rows     = candles.map(c =>
                `${new Date(c.ts).toISOString()},${c.open},${c.high},${c.low},${c.close},${c.volume}`
            );
            const fname   = a.filename || `${a.symbol}_${interval}_${Date.now()}.csv`;
            const outPath = path.resolve(fname);
            fs.writeFileSync(outPath, [header, ...rows].join('\n'));
            return `Saved ${candles.length} candles to ${outPath}`;
        }
        case 'read_file': {
            const filePath = path.resolve(a.path);
            if (!fs.existsSync(filePath)) return `File not found: ${filePath}`;
            if (isSensitive(filePath)) {
                const ok = await _askConfirm(
                    `${YELLOW}⚠  ${filePath}${RESET} may contain credentials.\n     Its contents will be sent to your AI provider. Read it?`
                );
                if (!ok) return 'Cancelled.';
            }
            const content = fs.readFileSync(filePath, 'utf8');
            const MAX = 8000;
            if (content.length > MAX) {
                return content.slice(0, MAX) + `\n\n[truncated — file is ${content.length} chars, showing first ${MAX}]`;
            }
            return content;
        }
        case 'write_file': {
            const filePath = path.resolve(a.path);
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, a.content, 'utf8');
            return `Written ${a.content.length} chars to ${filePath}`;
        }
        case 'list_directory': {
            const dirPath = path.resolve(a.path || '.');
            if (!fs.existsSync(dirPath)) return `Directory not found: ${dirPath}`;
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            const lines = entries.map(e => (e.isDirectory() ? `${e.name}/` : e.name));
            return `${dirPath}\n${lines.join('\n')}`;
        }
        case 'run_command': {
            const ok = await _askConfirm(
                `${YELLOW}⚠  Run command:${RESET} ${BOLD}${a.command}${RESET}`
            );
            if (!ok) return 'Command cancelled.';
            return new Promise(resolve => {
                exec(a.command, { timeout: 30000, maxBuffer: 1024 * 512 }, (err, stdout, stderr) => {
                    const out    = stdout.trim();
                    const errOut = (stderr || '').trim();
                    if (err && !out) {
                        resolve(errOut || err.message);
                    } else {
                        resolve(out + (errOut ? '\n[stderr] ' + errOut : ''));
                    }
                });
            });
        }
        default:
            return `Unknown tool: ${name}`;
    }
}

// ── Tool format helpers ───────────────────────────────────────────────────────

function geminiTools() {
    return [{
        functionDeclarations: TOOLS.map(t => {
            const hasProps = Object.keys(t.properties).length > 0;
            const decl = { name: t.name, description: t.description };
            if (hasProps) {
                decl.parameters = {
                    type: 'OBJECT',
                    properties: Object.fromEntries(
                        Object.entries(t.properties).map(([k, v]) => [k, {
                            type: v.type.toUpperCase(),
                            description: v.desc,
                        }])
                    ),
                    required: t.required,
                };
            }
            return decl;
        }),
    }];
}

function openAITools() {
    return TOOLS.map(t => ({
        type: 'function',
        function: {
            name: t.name,
            description: t.description,
            parameters: {
                type: 'object',
                properties: Object.fromEntries(
                    Object.entries(t.properties).map(([k, v]) => [k, { type: v.type, description: v.desc }])
                ),
                required: t.required,
            },
        },
    }));
}

function claudeTools() {
    return TOOLS.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: {
            type: 'object',
            properties: Object.fromEntries(
                Object.entries(t.properties).map(([k, v]) => [k, { type: v.type, description: v.desc }])
            ),
            required: t.required,
        },
    }));
}

// ── Provider: Gemini ──────────────────────────────────────────────────────────

function makeGeminiChat(cfg) {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genai = new GoogleGenerativeAI(cfg.key);
    const model = genai.getGenerativeModel({
        model: cfg.model || 'gemini-1.5-flash',
        systemInstruction: SYSTEM,
    });
    return model.startChat({ history: [], tools: geminiTools() });
}

async function sendGemini(chat, userText) {
    let resp = await chat.sendMessage(userText);
    while (true) {
        const parts = resp.response.candidates?.[0]?.content?.parts || [];
        const fnCall = parts.find(p => p.functionCall);
        if (!fnCall) {
            return parts.map(p => p.text || '').join('').trim();
        }
        const { name, args } = fnCall.functionCall;
        process.stdout.write(`\n  ${DIM}[${name}]${RESET} `);
        const result = await runTool(name, args);
        console.log(`${DIM}→ ${result}${RESET}`);
        resp = await chat.sendMessage([{ functionResponse: { name, response: { result } } }]);
    }
}

// ── Provider: OpenAI ──────────────────────────────────────────────────────────

async function sendOpenAI(cfg, msgs) {
    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey: cfg.key });
    while (true) {
        const resp = await client.chat.completions.create({
            model: 'gpt-4o',
            messages: msgs,
            tools: openAITools(),
            tool_choice: 'auto',
        });
        const choice = resp.choices[0];
        msgs.push(choice.message);
        if (choice.finish_reason !== 'tool_calls') {
            return (choice.message.content || '').trim();
        }
        for (const tc of choice.message.tool_calls) {
            const args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
            process.stdout.write(`\n  ${DIM}[${tc.function.name}]${RESET} `);
            const result = await runTool(tc.function.name, args);
            console.log(`${DIM}→ ${result}${RESET}`);
            msgs.push({ role: 'tool', tool_call_id: tc.id, content: result });
        }
    }
}

// ── Provider: Claude ──────────────────────────────────────────────────────────

async function sendClaude(cfg, msgs) {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: cfg.key });
    while (true) {
        const resp = await client.messages.create({
            model: 'claude-opus-4-7',
            max_tokens: 4096,
            system: SYSTEM,
            tools: claudeTools(),
            messages: msgs,
        });
        msgs.push({ role: 'assistant', content: resp.content });
        const toolUses = resp.content.filter(b => b.type === 'tool_use');
        if (!toolUses.length) {
            return resp.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
        }
        const toolResults = [];
        for (const tu of toolUses) {
            process.stdout.write(`\n  ${DIM}[${tu.name}]${RESET} `);
            const result = await runTool(tu.name, tu.input);
            console.log(`${DIM}→ ${result}${RESET}`);
            toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: result });
        }
        msgs.push({ role: 'user', content: toolResults });
    }
}

// ── REPL ──────────────────────────────────────────────────────────────────────

async function startChat(cfg) {
    const modelLabel = cfg.model ? ` · ${cfg.model}` : '';
    console.log(`\n  ${BOLD}${K2}Caloogy AI${RESET}  ${DIM}(${cfg.provider}${modelLabel} — type exit to quit)${RESET}`);
    console.log(`  ${DIM}${'─'.repeat(50)}${RESET}\n`);

    const iface = readline.createInterface({ input: process.stdin, output: process.stdout });

    // Wire up the confirmation helper so sensitive tool calls ask the user
    _askConfirm = (question) => new Promise(resolve => {
        iface.question(`\n  ${question}\n  Proceed? [y/N] `, ans => {
            console.log('');
            resolve(ans.trim().toLowerCase() === 'y');
        });
    });

    // Per-provider session state
    let geminiChat = null;
    const openAIMsgs = [{ role: 'system', content: SYSTEM }];
    const claudeMsgs = [];

    const prompt = () => iface.question(`  ${K3}You${RESET}: `, onInput);

    async function onInput(line) {
        const input = line.trim();
        if (!input) { prompt(); return; }
        if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
            console.log(`\n  ${DIM}Goodbye.${RESET}\n`);
            iface.close();
            return;
        }

        process.stdout.write(`  ${K2}AI${RESET}:  `);

        try {
            let reply;

            if (cfg.provider === 'gemini') {
                if (!geminiChat) geminiChat = makeGeminiChat(cfg);
                reply = await sendGemini(geminiChat, input);
            } else if (cfg.provider === 'openai') {
                openAIMsgs.push({ role: 'user', content: input });
                reply = await sendOpenAI(cfg, openAIMsgs);
            } else if (cfg.provider === 'claude') {
                claudeMsgs.push({ role: 'user', content: input });
                reply = await sendClaude(cfg, claudeMsgs);
            } else {
                reply = `Unknown provider: ${cfg.provider}`;
            }

            // Indent continuation lines
            const lines = reply.split('\n');
            lines.forEach((l, i) => {
                if (i === 0) console.log(l);
                else console.log(`       ${l}`);
            });
        } catch (err) {
            console.log(`${DIM}Error: ${err.message}${RESET}`);
        }

        console.log('');
        prompt();
    }

    prompt();
    await new Promise(resolve => iface.on('close', resolve));
}

module.exports = { startChat };
