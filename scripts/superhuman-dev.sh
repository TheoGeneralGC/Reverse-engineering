#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
runtime="${REA_NODE_BINARY:-$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node}"
[[ -x "$runtime" ]] || runtime="$(command -v node)"
export PATH="$(dirname "$runtime"):$PATH"
"$runtime" --env-file-if-exists=apps/superhuman/api/.env apps/superhuman/api/src/server.ts &
api_pid=$!
trap 'kill "$api_pid" 2>/dev/null || true' EXIT INT TERM
"$runtime" scripts/wait-for-local-api.mjs http://127.0.0.1:3001
"$runtime" node_modules/vite/bin/vite.js --config apps/superhuman/web/vite.config.ts apps/superhuman/web
