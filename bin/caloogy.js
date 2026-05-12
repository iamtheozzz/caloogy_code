#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const rl   = require('readline');

const CONFIG_PATH = path.join(os.homedir(), '.caloogy-config.json');

// ── Terminal spinner (Claude Code style) ─────────────────────────────────────

const FRAMES  = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
const TEAL    = '\x1b[38;5;43m';
const BOLD    = '\x1b[1m';
const DIM     = '\x1b[2m';
const RESET   = '\x1b[0m';

function spinner(label) {
    let i = 0;
    process.stdout.write('\x1b[?25l'); // hide cursor
    const id = setInterval(() => {
        process.stdout.write(`\r  ${TEAL}${FRAMES[i++ % FRAMES.length]}${RESET} ${label}   `);
    }, 80);
    return {
        stop(finalLine) {
            clearInterval(id);
            process.stdout.write('\r\x1b[K');   // clear line
            process.stdout.write('\x1b[?25h');  // show cursor
            if (finalLine) console.log(finalLine);
        },
    };
}

function printBanner() {
    console.log('');
    console.log(`  ${BOLD}${TEAL}Caloogy Code${RESET}`);
    console.log(`  ${DIM}Local quant analysis — powered by your AI key${RESET}`);
    console.log('');
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

// ── Interactive setup ─────────────────────────────────────────────────────────

async function setup() {
    const iface = rl.createInterface({ input: process.stdin, output: process.stdout });

    console.log(`  ${BOLD}First-time setup${RESET}\n`);
    console.log('  Select your AI provider:');
    console.log(`    ${TEAL}1${RESET}  Google Gemini`);
    console.log(`    ${TEAL}2${RESET}  OpenAI  (GPT-4o)`);
    console.log(`    ${TEAL}3${RESET}  Anthropic Claude\n`);

    let choice = '';
    while (!['1','2','3'].includes(choice)) {
        choice = (await ask(iface, '  Enter 1, 2, or 3: ')).trim();
    }

    const providers = { '1': 'gemini', '2': 'openai', '3': 'claude' };
    const names     = { '1': 'Gemini', '2': 'OpenAI', '3': 'Claude' };
    const provider  = providers[choice];

    const key = (await ask(iface, `\n  Paste your ${names[choice]} API key: `)).trim();
    iface.close();

    if (!key) { console.error('\n  Error: API key cannot be empty.\n'); process.exit(1); }

    const cfg = { provider, key };
    saveConfig(cfg);
    console.log(`\n  ${TEAL}✓${RESET} Config saved to ${DIM}${CONFIG_PATH}${RESET}`);
    return cfg;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    printBanner();

    let cfg = readConfig();
    if (!cfg) { cfg = await setup(); console.log(''); }

    const spin = spinner('Starting server…');

    const { startServer } = require('../server.js');
    const port = await startServer(cfg);
    const url  = `http://localhost:${port}`;

    spin.stop(`  ${TEAL}✓${RESET} Running at ${BOLD}${url}${RESET}  ${DIM}(Ctrl+C to stop)${RESET}\n`);

    try {
        const open = (await import('open')).default;
        await open(url);
    } catch {}
}

main().catch(err => { console.error('\n  Error:', err.message, '\n'); process.exit(1); });
