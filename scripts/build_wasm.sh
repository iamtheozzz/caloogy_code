#!/bin/bash
set -e
cd "$(dirname "$0")/../wasm"
wasm-pack build --target web --out-dir ../public/wasm --no-typescript
echo "[wasm] built → public/wasm/"
