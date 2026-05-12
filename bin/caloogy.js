#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const rl   = require('readline');

const CONFIG_PATH = path.join(os.homedir(), '.caloogy-config.json');

// ── ANSI ──────────────────────────────────────────────────────────────────────

const TEAL  = '\x1b[38;5;43m';
const TEAL2 = '\x1b[38;5;30m';
const BOLD  = '\x1b[1m';
const DIM   = '\x1b[2m';
const RESET = '\x1b[0m';

// ── Pixel font (5 × 5, each cell = '1' filled / '0' empty) ──────────────────

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
    const letters = word.toUpperCase().split('').map(c => FONT[c] || FONT[' ']);
    const rows = [];
    for (let r = 0; r < 5; r++) {
        rows.push(
            letters.map(l => l[r].split('').map(p => p === '1' ? '██' : '  ').join('')).join(' ')
        );
    }
    return rows;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function printBanner() {
    process.stdout.write('\x1b[2J\x1b[H'); // clear screen

    // Welcome badge
    const badge = '  ✦  Welcome to Caloogy Code  ';
    const w = badge.length;
    console.log(`\n  ${TEAL}┌${'─'.repeat(w)}┐${RESET}`);
    console.log(`  ${TEAL}│${RESET}${BOLD}${badge}${RESET}${TEAL}│${RESET}`);
    console.log(`  ${TEAL}└${'─'.repeat(w)}┘${RESET}\n`);

    // Animated pixel art — row by row, alternating teal shades
    const rows1 = wordRows('CALOOGY');
    const rows2 = wordRows('CODE');

    for (const row of rows1) {
        await sleep(38);
        process.stdout.write(`  ${TEAL}${row}${RESET}\n`);
    }
    console.log('');
    for (const row of rows2) {
        await sleep(38);
        process.stdout.write(`  ${TEAL2}${row}${RESET}\n`);
    }

    console.log(`\n  ${DIM}Press Enter to continue${RESET}`);
}

// ── Terminal spinner ──────────────────────────────────────────────────────────

const FRAMES = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];

function spinner(label) {
    let i = 0;
    process.stdout.write('\x1b[?25l');
    const id = setInterval(() => {
        process.stdout.write(`\r  ${TEAL}${FRAMES[i++ % FRAMES.length]}${RESET} ${label}   `);
    }, 80);
    return {
        stop(line) {
            clearInterval(id);
            process.stdout.write('\r\x1b[K');
            process.stdout.write('\x1b[?25h');
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
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}
function ask(iface, question) {
    return new Promise(resolve => iface.question(question, resolve));
}
function waitEnter() {
    return new Promise(resolve => {
        const iface = rl.createInterface({ input: process.stdin, output: process.stdout });
        iface.question('', () => { iface.close(); resolve(); });
    });
}

// ── Interactive setup ─────────────────────────────────────────────────────────

const GEMINI_MODELS = [
    { label: 'gemini-1.5-flash  (free tier, recommended)', val: 'gemini-1.5-flash' },
    { label: 'gemini-1.5-pro',   val: 'gemini-1.5-pro'   },
    { label: 'gemini-2.5-flash', val: 'gemini-2.5-flash'  },
    { label: 'Custom…',          val: '__custom__'         },
];

async function setup() {
    process.stdout.write('\x1b[2J\x1b[H');
    console.log(`\n  ${BOLD}${TEAL}Caloogy Code${RESET}  ${DIM}— first-time setup${RESET}\n`);

    const iface = rl.createInterface({ input: process.stdin, output: process.stdout });

    console.log('  Select your AI provider:');
    console.log(`    ${TEAL}1${RESET}  Google Gemini`);
    console.log(`    ${TEAL}2${RESET}  OpenAI  (GPT-4o)`);
    console.log(`    ${TEAL}3${RESET}  Anthropic Claude\n`);

    let choice = '';
    while (!['1','2','3'].includes(choice)) {
        choice = (await ask(iface, '  Enter 1, 2, or 3: ')).trim();
    }

    const providers = { '1': 'gemini', '2': 'openai', '3': 'claude' };
    const names     = { '1': 'Gemini', '2': 'OpenAI',  '3': 'Claude'  };
    const provider  = providers[choice];

    const key = (await ask(iface, `\n  Paste your ${names[choice]} API key: `)).trim();
    if (!key) { iface.close(); console.error('\n  Error: key cannot be empty.\n'); process.exit(1); }

    let model;
    if (provider === 'gemini') {
        console.log('\n  Select Gemini model:');
        GEMINI_MODELS.forEach((m, i) => console.log(`    ${TEAL}${i+1}${RESET}  ${m.label}`));
        let mc = '';
        while (!mc || isNaN(mc) || +mc < 1 || +mc > GEMINI_MODELS.length) {
            mc = (await ask(iface, `\n  Enter 1–${GEMINI_MODELS.length}: `)).trim();
        }
        const chosen = GEMINI_MODELS[+mc - 1];
        model = chosen.val === '__custom__'
            ? (await ask(iface, '  Model name: ')).trim()
            : chosen.val;
    }

    iface.close();

    const cfg = { provider, key, ...(model ? { model } : {}) };
    saveConfig(cfg);
    console.log(`\n  ${TEAL}✓${RESET} Saved to ${DIM}${CONFIG_PATH}${RESET}\n`);
    return cfg;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    const args     = process.argv.slice(2);
    const reconfig = args.includes('--reconfigure') || args.includes('-r');

    await printBanner();
    await waitEnter();

    let cfg = reconfig ? null : readConfig();
    if (!cfg) { cfg = await setup(); }

    const spin = spinner('Starting server…');
    const { startServer } = require('../server.js');
    const port = await startServer(cfg);
    const url  = `http://localhost:${port}`;

    const modelInfo = cfg.model ? ` · ${cfg.model}` : '';
    spin.stop(`  ${TEAL}✓${RESET} Running at ${BOLD}${url}${RESET}  ${DIM}(Ctrl+C to stop)${RESET}`);
    console.log(`  ${DIM}${cfg.provider}${modelInfo}  ·  caloogy --reconfigure to change settings${RESET}\n`);

    try { const open = (await import('open')).default; await open(url); } catch {}
}

main().catch(err => { console.error('\n  Error:', err.message, '\n'); process.exit(1); });
