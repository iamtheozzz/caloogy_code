#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

GREEN='\033[0;32m'
DIM='\033[2m'
BOLD='\033[1m'
RED='\033[0;31m'
RESET='\033[0m'

ok()   { echo -e "  ${GREEN}✓${RESET} $1"; }
fail() { echo -e "  ${RED}✗${RESET} $1"; }
skip() { echo -e "  ${DIM}▸ $1 — skipped${RESET}"; }

echo -e "\n  ${BOLD}Building optional extensions${RESET}\n"

# ── 1. Go collector ───────────────────────────────────────────────────────────
if [ -f "$ROOT/collector/go.mod" ]; then
    if command -v go &>/dev/null; then
        echo -n "  ▸ Go: tidy deps… "
        go -C "$ROOT/collector" mod tidy && ok "done" || fail "failed"
        echo -n "  ▸ Go: build collector… "
        go -C "$ROOT/collector" build -o caloogy-collector . && ok "done" || fail "failed"
    else
        skip "Go collector (go not found)"
    fi
else
    skip "Go collector (collector/ not found)"
fi

# ── 2. Rust backtest engine (maturin) ────────────────────────────────────────
if [ -f "$ROOT/engine/Cargo.toml" ]; then
    if command -v cargo &>/dev/null; then
        if ! command -v maturin &>/dev/null; then
            echo -n "  ▸ Installing maturin… "
            pip3 install maturin --quiet && ok "done" || { fail "failed"; }
        fi
        echo -n "  ▸ Rust: build engine… "
        (cd "$ROOT/engine" && maturin develop --release) && ok "done" || fail "failed"
    else
        skip "Rust engine (cargo not found)"
    fi
else
    skip "Rust engine (engine/ not found)"
fi

# ── 3. WASM indicators ────────────────────────────────────────────────────────
if [ -f "$ROOT/wasm/Cargo.toml" ]; then
    if command -v cargo &>/dev/null; then
        if ! command -v wasm-pack &>/dev/null; then
            echo -n "  ▸ Installing wasm-pack… "
            cargo install wasm-pack && ok "done" || { fail "failed"; }
        fi
        echo -n "  ▸ WASM: build indicators… "
        (cd "$ROOT/wasm" && wasm-pack build --target web --out-dir ../public/wasm --no-typescript) \
            && ok "done" || fail "failed"
    else
        skip "WASM indicators (cargo not found)"
    fi
else
    skip "WASM indicators (wasm/ not found)"
fi

echo -e "\n  ${GREEN}Build complete.${RESET} Run ${BOLD}caloogy${RESET} to start.\n"
