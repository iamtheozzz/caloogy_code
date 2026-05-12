#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const rl   = require('readline');

const CONFIG_PATH = path.join(os.homedir(), '.caloogy-config.json');

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

async function setup() {
    const iface = rl.createInterface({ input: process.stdin, output: process.stdout });

    console.log('\n  Caloogy Code — Local Setup\n');
    console.log('  Select your AI provider:');
    console.log('    1) Google Gemini');
    console.log('    2) OpenAI (ChatGPT)');
    console.log('    3) Anthropic Claude\n');

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
    console.log(`\n  ✓ Config saved to ${CONFIG_PATH}`);
    return cfg;
}

async function main() {
    let cfg = readConfig();
    if (!cfg) { cfg = await setup(); }

    const { startServer } = require('../server.js');
    const port = await startServer(cfg);
    const url  = `http://localhost:${port}`;

    console.log(`\n  ✓ Caloogy Code running at ${url}`);
    console.log('    Press Ctrl+C to stop.\n');

    try {
        const open = (await import('open')).default;
        await open(url);
    } catch {}
}

main().catch(err => { console.error(err); process.exit(1); });
