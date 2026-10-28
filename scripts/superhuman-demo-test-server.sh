#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
runtime="${REA_NODE_BINARY:-$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node}"
[[ -x "$runtime" ]] || runtime="$(command -v node)"
export PATH="$(dirname "$runtime"):$PATH"

# A separate database and ports keep browser regression mutations off live mail.
# Do not load the real API .env; explicitly disable provider credentials here.
PORT=3002 WEB_ORIGIN=http://127.0.0.1:5174 \
DATABASE_PATH="$repo_root/.local/e2e/superhuman-browser.sqlite" \
GOOGLE_CLIENT_ID= GOOGLE_CLIENT_SECRET= TOKEN_ENCRYPTION_KEY= \
APPROVED_TEST_SENDERS= APPROVED_TEST_RECIPIENTS= OPENAI_API_KEY= OPENAI_MODEL= \
AI_PROVIDER=anthropic ANTHROPIC_API_KEY= ANTHROPIC_MODEL= ANTHROPIC_WORKSPACE_ID= \
GOOGLE_CALENDAR_ENABLED=false APPROVED_CALENDAR_TEST_ACCOUNTS= \
APPROVED_CALENDAR_TEST_IDS= APPROVED_CALENDAR_TEST_ATTENDEES= \
"$runtime" apps/superhuman/api/src/server.ts &
api_pid=$!
trap 'kill "$api_pid" 2>/dev/null || true' EXIT INT TERM
"$runtime" scripts/wait-for-local-api.mjs http://127.0.0.1:3002
SUPERHUMAN_API_PORT=3002 SUPERHUMAN_WEB_PORT=5174 \
"$runtime" node_modules/vite/bin/vite.js --config apps/superhuman/web/vite.config.ts apps/superhuman/web
