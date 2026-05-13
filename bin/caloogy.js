#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const rl   = require('readline');

const CONFIG_PATH = path.join(os.homedir(), '.caloogy-config.json');

// ── Klein Blue palette (true-color) ──────────────────────────────────────────
const K0 = '\x1b[38;2;0;20;90m';       // darkest
const K1 = '\x1b[38;2;0;47;167m';      // Klein Blue
const K2 = '\x1b[38;2;55;100;220m';    // mid
const K3 = '\x1b[38;2;110;155;255m';   // bright
const K4 = '\x1b[38;2;170;200;255m';   // lightest / highlight
const BOLD  = '\x1b[1m';
const DIM   = '\x1b[2m';
const RESET = '\x1b[0m';

// ── Pixel font (5 × 5) ───────────────────────────────────────────────────────
const FONT = {
    C: ['01110','10000','10000','10000','01110'],
    A: ['01110','10001','11111','10001','10001'],
    L: ['10000','10000','10000','10000','11111'],
    O: ['01110','10001','10001','10001','01110'],
    G: ['01110','10000','10111','10001','01111'],
    Y: ['10001','10001','01110','00100','00100'],
    D: ['11110','10001','10001','10001','11110'],
    E: ['11111','10000','11100','10000','11111'],
    ' ':['00000','00000','00000','00000','00000'],
};

function wordRows(word) {
    const letters = word.split('').map(c => FONT[c] || FONT[' ']);
    return Array.from({ length: 5 }, (_, r) =>
        letters.map(l => l[r].split('').map(p => p === '1' ? '██' : '  ').join('')).join(' ')
    );
}

// ── Particle system ───────────────────────────────────────────────────────────
const SPARKS  = ['✦','✧','✶','·','◆','◇','✸','✺','⋆'];
const SIDE    = ['│','║','╎','╏','┊','┆'];

// Returns a random subset of sparkle positions as [symbol, color] pairs
// arranged alongside art lines. The art is 16 cols of indent + content.
function mkParticles(frame) {
    const rng = (n) => Math.floor(Math.random() * n);
    return Array.from({ length: 9 }, (_, i) => ({
        sym  : SPARKS[rng(SPARKS.length)],
        color: [K1,K2,K3,K4][rng(4)],
        show : Math.random() > 0.38,
    }));
}

// ── Build one complete animation frame ───────────────────────────────────────
function frame(n, particles) {
    const rows1   = wordRows('CALOOGY');
    const rows2   = wordRows('CODE');
    const badge   = '  ✦  Welcome to Caloogy Code  ';
    const w       = badge.length;

    // Pulse: border color cycles K1→K2→K3→K2→K1
    const pulseSeq = [K1,K2,K3,K4,K3,K2];
    const pulse    = pulseSeq[n % pulseSeq.length];

    // Scanline: one row of each word glows brighter (cascades)
    const scan1 = n % 7;        // 0-4 = active row, 5-6 = pause
    const scan2 = (n + 3) % 7;  // offset for CODE

    const P = (i) => particles[i] || { show: false, sym: '·', color: K1 };
    const sp = (i) => P(i).show ? `${P(i).color}${P(i).sym}${RESET}` : ' ';

    // Top scatter row
    let topRow = '  ';
    for (let c = 0; c < w + 2; c++) {
        const prob = Math.random();
        topRow += prob > 0.96 ? `${K3}·${RESET}` : prob > 0.93 ? `${K2}·${RESET}` : ' ';
    }

    const lines = [];
    lines.push('');
    lines.push(topRow);

    // Badge with pulsing border
    lines.push(`  ${pulse}┌${'─'.repeat(w)}┐${RESET}`);
    lines.push(`  ${pulse}│${RESET}${BOLD}${badge}${RESET}${pulse}│${RESET}`);
    lines.push(`  ${pulse}└${'─'.repeat(w)}┘${RESET}`);
    lines.push('');

    // CALOOGY — scanline glow + side sparkles
    for (let r = 0; r < 5; r++) {
        const active = scan1 === r;
        const color  = active ? K4 : (r < 2 ? K1 : r < 4 ? K2 : K1);
        const left   = sp(r);
        const right  = sp(r + 5);
        lines.push(` ${left} ${color}${rows1[r]}${RESET} ${right}`);
    }
    lines.push('');

    // Horizontal divider that pulses
    const divChar = n % 2 === 0 ? '─' : '━';
    lines.push(`  ${K0}${divChar.repeat(Math.min(process.stdout.columns - 4 || 74, 74))}${RESET}`);
    lines.push('');

    // CODE — offset scanline + side sparkles
    for (let r = 0; r < 5; r++) {
        const active = scan2 === r;
        const color  = active ? K4 : (r % 2 === 0 ? K2 : K1);
        const left   = sp(r + 1);
        const right  = sp(r + 6);
        lines.push(` ${left} ${color}${rows2[r]}${RESET} ${right}`);
    }
    lines.push('');

    // Blinking "Press Enter"
    const enterColor = (n % 6 < 4) ? K3 : K1;
    const enterBold  = (n % 6 < 4) ? BOLD : '';
    lines.push(`  ${enterColor}${enterBold}Press Enter to continue${RESET}`);
    lines.push('');

    return lines;
}

// ── Animated banner ───────────────────────────────────────────────────────────
async function showBanner() {
    // Enter alternate screen, hide cursor
    process.stdout.write('\x1b[?1049h\x1b[?25l');

    let n = 0;
    let particles = mkParticles(0);
    let done = false;

    const draw = () => {
        if (done) return;
        n++;
        if (n % 3 === 0) particles = mkParticles(n);
        const lines = frame(n, particles);
        process.stdout.write('\x1b[2J\x1b[H' + lines.join('\n'));
    };

    // Initial draw
    process.stdout.write('\x1b[2J');
    draw();
    const animId = setInterval(draw, 110);

    // Wait for Enter in raw mode
    await new Promise(resolve => {
        try {
            const onKey = (buf) => {
                const b = buf[0];
                if (b === 13 || b === 10) resolve();   // Enter
                if (b === 3)  process.exit(0);          // Ctrl+C
            };
            process.stdin.setRawMode(true);
            process.stdin.resume();
            process.stdin.on('data', onKey);
        } catch {
            // Raw mode unavailable (piped stdin), just resolve immediately
            resolve();
        }
    });

    done = true;
    clearInterval(animId);
    process.stdout.write('\x1b[?1049l\x1b[?25h'); // exit alt screen, show cursor
}

// ── Terminal spinner ──────────────────────────────────────────────────────────
const FRAMES = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];

function spinner(label) {
    let i = 0;
    process.stdout.write('\x1b[?25l');
    const id = setInterval(() => {
        process.stdout.write(`\r  ${K2}${FRAMES[i++ % FRAMES.length]}${RESET} ${label}   `);
    }, 80);
    return {
        stop(line) {
            clearInterval(id);
            process.stdout.write('\r\x1b[K\x1b[?25h');
            if (line) console.log(line);
        },
    };
}

// ── Config helpers ────────────────────────────────────────────────────────────
function readConfig() {
    try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
    catch { return null; }
}
function saveConfig(cfg) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { encoding: 'utf8', mode: 0o600 });
}
function ask(iface, q) { return new Promise(r => iface.question(q, r)); }

// ── Alerts path ───────────────────────────────────────────────────────────────
const ALERTS_PATH = path.join(os.homedir(), '.caloogy-alerts.json');

// ── Interactive setup ─────────────────────────────────────────────────────────
const GEMINI_MODELS = [
    { label: 'gemini-1.5-flash  (free tier, recommended)', val: 'gemini-1.5-flash' },
    { label: 'gemini-1.5-pro',   val: 'gemini-1.5-pro'   },
    { label: 'gemini-2.5-flash', val: 'gemini-2.5-flash'  },
    { label: 'Custom…',          val: '__custom__'         },
];

async function setup() {
    console.log(`\n  ${BOLD}${K2}Caloogy Code${RESET}  ${DIM}— setup${RESET}\n`);
    const iface = rl.createInterface({ input: process.stdin, output: process.stdout });

    // If existing config, offer skip option
    const existing = readConfig();
    let provider, key, model;

    console.log('  Select AI provider:');
    console.log(`    ${K2}1${RESET}  Google Gemini`);
    console.log(`    ${K2}2${RESET}  OpenAI  (GPT-4o)`);
    console.log(`    ${K2}3${RESET}  Anthropic Claude`);
    if (existing) console.log(`    ${K2}4${RESET}  ${DIM}Skip — keep existing AI config${RESET}`);
    console.log('');

    const validChoices = existing ? ['1','2','3','4'] : ['1','2','3'];
    let choice = '';
    while (!validChoices.includes(choice))
        choice = (await ask(iface, `  Enter 1–${existing ? '4' : '3'}: `)).trim();

    if (choice === '4') {
        // Keep existing AI config, jump straight to email setup
        provider = existing.provider;
        key      = existing.key;
        model    = existing.model;
    } else {
        const providers = { '1': 'gemini', '2': 'openai', '3': 'claude' };
        const names     = { '1': 'Gemini', '2': 'OpenAI',  '3': 'Claude'  };
        provider = providers[choice];
        key = (await ask(iface, `\n  ${names[choice]} API key: `)).trim();
        if (!key) { iface.close(); console.error('\n  Error: key empty.\n'); process.exit(1); }

        if (provider === 'gemini') {
            console.log('\n  Gemini model:');
            GEMINI_MODELS.forEach((m, i) => console.log(`    ${K2}${i+1}${RESET}  ${m.label}`));
            let mc = '';
            while (!mc || isNaN(mc) || +mc < 1 || +mc > GEMINI_MODELS.length)
                mc = (await ask(iface, `\n  Enter 1–${GEMINI_MODELS.length}: `)).trim();
            const chosen = GEMINI_MODELS[+mc - 1];
            model = chosen.val === '__custom__' ? (await ask(iface, '  Model name: ')).trim() : chosen.val;
        }
    }

    // ── Gmail ──
    console.log(`\n  ${DIM}─────────────────────────────────────────${RESET}`);
    console.log(`  ${K2}Email Alerts${RESET}  ${DIM}(optional — press Enter to skip)${RESET}`);
    if (existing && existing.email) console.log(`  ${DIM}current: ${existing.email}${RESET}`);
    const emailInput = (await ask(iface, `\n  Gmail address: `)).trim();
    let gmailPass = '';
    if (emailInput) gmailPass = (await ask(iface, `  Gmail App Password (16 chars): `)).trim();

    // ── Discord ──
    console.log(`\n  ${DIM}─────────────────────────────────────────${RESET}`);
    console.log(`  ${K2}Discord Alerts${RESET}  ${DIM}(optional — press Enter to skip)${RESET}`);
    if (existing && existing.discordWebhook) console.log(`  ${DIM}current: configured${RESET}`);
    const discordWebhook = (await ask(iface, `\n  Discord Webhook URL: `)).trim();

    // ── Telegram ──
    console.log(`\n  ${DIM}─────────────────────────────────────────${RESET}`);
    console.log(`  ${K2}Telegram Alerts${RESET}  ${DIM}(optional — press Enter to skip)${RESET}`);
    if (existing && existing.telegramToken) console.log(`  ${DIM}current: configured${RESET}`);
    console.log(`  ${DIM}Create a bot via @BotFather, send it a message, then get your Chat ID from:${RESET}`);
    console.log(`  ${DIM}https://api.telegram.org/bot<TOKEN>/getUpdates${RESET}\n`);
    const telegramToken  = (await ask(iface, `  Telegram Bot Token: `)).trim();
    let telegramChatId = '';
    if (telegramToken) telegramChatId = (await ask(iface, `  Telegram Chat ID: `)).trim();

    iface.close();

    // Merge: new values override existing, blanks fall back to existing
    const pick = (newVal, existKey) => newVal || (existing && existing[existKey]) || undefined;
    const cfg = {
        provider, key,
        ...(model                          ? { model }                                      : {}),
        ...(pick(emailInput,  'email')     ? { email:          pick(emailInput,  'email') } : {}),
        ...(pick(gmailPass,   'gmailPass') ? { gmailPass:      pick(gmailPass,   'gmailPass') } : {}),
        ...(pick(discordWebhook, 'discordWebhook') ? { discordWebhook: pick(discordWebhook, 'discordWebhook') } : {}),
        ...(pick(telegramToken, 'telegramToken')   ? { telegramToken:  pick(telegramToken,  'telegramToken')  } : {}),
        ...(pick(telegramChatId,'telegramChatId')  ? { telegramChatId: pick(telegramChatId, 'telegramChatId') } : {}),
    };
    saveConfig(cfg);
    console.log(`\n  ${K2}✓${RESET} Saved to ${DIM}${CONFIG_PATH}${RESET}\n`);

    // Send test notification to any newly configured channel
    const hasNew = (emailInput && gmailPass) || discordWebhook || (telegramToken && telegramChatId);
    if (hasNew) {
        const spin = spinner('Sending test notification…');
        try {
            const { sendTestNotify } = require('../lib/notify');
            await sendTestNotify(cfg);
            spin.stop(`  ${K2}✓${RESET} Test notification sent`);
        } catch (e) {
            spin.stop(`  ${DIM}⚠ Test notification failed: ${e.message}${RESET}`);
        }
    }

    return cfg;
}

// ── Alert Manager CLI ─────────────────────────────────────────────────────────
const COIN_LIST = [
    'BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','DOGEUSDT',
    'ADAUSDT','AVAXUSDT','LINKUSDT','DOTUSDT','UNIUSDT','LTCUSDT',
    'ATOMUSDT','NEARUSDT','APTUSDT','ARBUSDT','OPUSDT','SUIUSDT',
    'TRXUSDT','MATICUSDT','FILUSDT','ICPUSDT','INJUSDT','TONUSDT',
    'PEPEUSDT','SHIBUSDT','WIFUSDT','JUPUSDT','BONKUSDT','RENDERUSDT',
    'FETUSDT','HBARUSDT','VETUSDT',
];

async function alertsCLI() {
    const { readAlerts, addAlert, removeAlert, updateAlert } = require('../lib/monitor');
    const iface = rl.createInterface({ input: process.stdin, output: process.stdout });
    const cfg   = readConfig();

    console.log(`\n  ${BOLD}${K2}Caloogy Alert Manager${RESET}\n`);

    let running = true;
    while (running) {
        const alerts = readAlerts();
        console.log(`  ${K2}1${RESET}  List alerts  ${DIM}(${alerts.length} active)${RESET}`);
        console.log(`  ${K2}2${RESET}  Add alert`);
        console.log(`  ${K2}3${RESET}  Remove alert`);
        console.log(`  ${K2}4${RESET}  Toggle alert on/off`);
        console.log(`  ${K2}5${RESET}  Send test email`);
        console.log(`  ${K2}6${RESET}  Exit\n`);

        const choice = (await ask(iface, '  Enter 1–6: ')).trim();

        if (choice === '1') {
            if (alerts.length === 0) {
                console.log(`\n  ${DIM}No alerts configured.${RESET}\n`);
            } else {
                console.log('');
                alerts.forEach((a, i) => {
                    const status = a.enabled ? `${K2}ON${RESET}` : `${DIM}OFF${RESET}`;
                    const last   = a.lastTriggered ? `last: ${new Date(a.lastTriggered).toLocaleString()}` : 'never triggered';
                    console.log(`  ${DIM}${i+1}.${RESET} [${status}] ${BOLD}${a.symbol}${RESET}  ${a.type}  ${DIM}(${last})  id:${a.id}${RESET}`);
                });
                console.log('');
            }

        } else if (choice === '2') {
            console.log('\n  Coins: ' + COIN_LIST.slice(0,8).join(', ') + ', …');
            let symbol = (await ask(iface, '  Symbol (e.g. BTCUSDT): ')).trim().toUpperCase();
            if (!symbol.endsWith('USDT')) symbol += 'USDT';

            console.log(`\n  Alert types:\n  ${K2}1${RESET} Price spike  ${K2}2${RESET} RSI extreme  ${K2}3${RESET} Price vs SMA  ${K2}4${RESET} MACD cross  ${K2}5${RESET} Bollinger breakout\n`);
            const t = (await ask(iface, '  Type 1–5: ')).trim();
            const types = { '1':'price_change','2':'rsi_threshold','3':'price_vs_sma','4':'macd_cross','5':'bb_breakout' };
            const type  = types[t];
            if (!type) { console.log(`\n  ${DIM}Invalid choice.${RESET}\n`); continue; }

            const rule = { symbol, type, cooldownMinutes: 60 };

            if (type === 'price_change') {
                rule.pct      = +((await ask(iface, '  Min % change (default 5): ')).trim() || '5');
                rule.lookback = +((await ask(iface, '  Lookback candles (default 3): ')).trim() || '3');
            } else if (type === 'rsi_threshold') {
                const d = (await ask(iface, '  Direction — above / below (default above): ')).trim() || 'above';
                rule.direction = d === 'below' ? 'below' : 'above';
                rule.threshold = +((await ask(iface, `  Threshold (default ${rule.direction==='above'?70:30}): `)).trim() || (rule.direction==='above'?'70':'30'));
            } else if (type === 'price_vs_sma') {
                const d = (await ask(iface, '  Direction — cross_above / cross_below (default cross_above): ')).trim() || 'cross_above';
                rule.direction = d === 'cross_below' ? 'cross_below' : 'cross_above';
                rule.period    = +((await ask(iface, '  SMA period (default 20): ')).trim() || '20');
            } else if (type === 'macd_cross') {
                const d = (await ask(iface, '  Direction — cross_above / cross_below (default cross_above): ')).trim() || 'cross_above';
                rule.direction = d === 'cross_below' ? 'cross_below' : 'cross_above';
            } else if (type === 'bb_breakout') {
                const d = (await ask(iface, '  Direction — above_upper / below_lower (default above_upper): ')).trim() || 'above_upper';
                rule.direction = d === 'below_lower' ? 'below_lower' : 'above_upper';
            }

            rule.cooldownMinutes = +((await ask(iface, '  Cooldown minutes (default 60): ')).trim() || '60');
            addAlert(rule);
            console.log(`\n  ${K2}✓${RESET} Alert saved.\n`);

        } else if (choice === '3') {
            const alerts2 = readAlerts();
            if (!alerts2.length) { console.log(`\n  ${DIM}No alerts.${RESET}\n`); continue; }
            alerts2.forEach((a, i) => console.log(`  ${K2}${i+1}${RESET}  ${a.symbol}  ${a.type}  ${DIM}id:${a.id}${RESET}`));
            const idx = +((await ask(iface, '\n  Remove #: ')).trim()) - 1;
            if (alerts2[idx]) { removeAlert(alerts2[idx].id); console.log(`\n  ${K2}✓${RESET} Removed.\n`); }

        } else if (choice === '4') {
            const alerts3 = readAlerts();
            if (!alerts3.length) { console.log(`\n  ${DIM}No alerts.${RESET}\n`); continue; }
            alerts3.forEach((a, i) => {
                const status = a.enabled ? `${K2}ON${RESET}` : `${DIM}OFF${RESET}`;
                console.log(`  ${K2}${i+1}${RESET}  [${status}] ${a.symbol}  ${a.type}`);
            });
            const idx = +((await ask(iface, '\n  Toggle #: ')).trim()) - 1;
            if (alerts3[idx]) {
                updateAlert(alerts3[idx].id, { enabled: !alerts3[idx].enabled });
                console.log(`\n  ${K2}✓${RESET} Toggled.\n`);
            }

        } else if (choice === '5') {
            if (!cfg || !cfg.email || !cfg.gmailPass) {
                console.log(`\n  ${DIM}No email configured. Run: caloogy --reconfigure${RESET}\n`);
            } else {
                const spin = spinner('Sending test email…');
                try {
                    const { sendTestEmail } = require('../lib/monitor');
                    await sendTestEmail(cfg);
                    spin.stop(`  ${K2}✓${RESET} Test email sent to ${cfg.email}\n`);
                } catch (e) {
                    spin.stop(`  ${DIM}⚠ Failed: ${e.message}${RESET}\n`);
                }
            }

        } else if (choice === '6') {
            running = false;
        }
    }

    iface.close();
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    const args      = process.argv.slice(2);
    const reconfig  = args.includes('--reconfigure') || args.includes('-r');
    const alertMode = args.includes('--alerts')      || args.includes('-a');

    if (alertMode) { await alertsCLI(); return; }

    await showBanner();

    let cfg = reconfig ? null : readConfig();
    if (!cfg) cfg = await setup();

    const spin = spinner('Starting server…');
    const { startServer } = require('../server.js');
    const port = await startServer(cfg);
    const url  = `http://localhost:${port}`;
    const info = cfg.model ? ` · ${cfg.model}` : '';

    spin.stop(`  ${K2}✓${RESET} Running at ${BOLD}${url}${RESET}  ${DIM}(Ctrl+C to stop)${RESET}`);
    console.log(`  ${DIM}${cfg.provider}${info}  ·  caloogy --reconfigure to change settings${RESET}\n`);

    try { const open = (await import('open')).default; await open(url); } catch {}
}

main().catch(err => { console.error('\n  Error:', err.message, '\n'); process.exit(1); });
