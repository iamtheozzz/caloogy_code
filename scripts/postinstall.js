'use strict';
/**
 * Postinstall script for caloogy-code.
 *
 * Runs after `npm install` (including `npm install -g github:...`).
 * Two jobs:
 *   1. Install duckdb with a shell-safe environment (fixes ENOENT on Homebrew npm)
 *   2. Compile C++ native addons (indicators + CSV parser) with node-gyp >= 10
 *
 * Both steps degrade gracefully: the app still works in pure-JS mode if either fails.
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

const ROOT = path.join(__dirname, '..');

// ── 1. Fix PATH ───────────────────────────────────────────────────────────────
// Homebrew npm global install runs postinstall scripts with a stripped PATH
// where /bin, /usr/bin etc. may be missing. Add them back so child processes
// (duckdb's install script, make, cc, node-gyp…) can find standard tools.
const STANDARD_PATHS = [
    '/usr/bin', '/bin', '/usr/sbin', '/sbin',
    '/usr/local/bin', '/opt/homebrew/bin', '/opt/homebrew/sbin',
];
const existingPaths = new Set((process.env.PATH || '').split(':').filter(Boolean));
for (const p of STANDARD_PATHS) existingPaths.add(p);
const env = {
    ...process.env,
    PATH:  [...existingPaths].join(':'),
    SHELL: '/bin/sh',
};

// shell:true → Node always invokes /bin/sh, bypassing the stripped-PATH issue.
function run(cmd, args) {
    const r = spawnSync(cmd, args, {
        cwd:   ROOT,
        env,
        stdio: 'inherit',
        shell: true,
    });
    return r.status === 0;
}

// ── 2. Install duckdb ─────────────────────────────────────────────────────────
// duckdb's own postinstall downloads a native binary using shell scripts that
// fail in Homebrew npm's global install environment (stripped PATH). We run
// it ourselves after fixing the environment.
const duckdbPkg = path.join(ROOT, 'node_modules', 'duckdb', 'package.json');
if (!fs.existsSync(duckdbPkg)) {
    console.log('[caloogy] Installing duckdb…');
    const ok = run('npm', ['install', '--no-save', 'duckdb@1.4.4']);
    if (ok) {
        console.log('[caloogy] duckdb installed.');
    } else {
        console.warn('[caloogy] duckdb install failed — data-manager features will not work.');
        console.warn('[caloogy] To fix, run inside the install directory:');
        console.warn('[caloogy]   npm install --no-save duckdb@1.4.4');
    }
} else {
    console.log('[caloogy] duckdb ready.');
}

// ── 3. Build C++ native addons ────────────────────────────────────────────────
// Use the locally installed node-gyp (listed in dependencies, v10+) so we
// avoid the npm-bundled v9.x that breaks under Python 3.12+.
const nodeGypBin = path.join(ROOT, 'node_modules', '.bin', 'node-gyp');
const nodeGypExists = fs.existsSync(nodeGypBin);

console.log('[caloogy] Building C++ addons…');
const built = nodeGypExists
    ? run(nodeGypBin, ['configure', 'build', '--quiet'])
    : run('node-gyp',  ['configure', 'build', '--quiet']);   // fall back to global

if (built) {
    console.log('[caloogy] C++ addons built — running in accelerated mode.');
} else {
    console.warn('[caloogy] C++ addon build skipped — running in pure-JS mode (slower but fully functional).');
}
