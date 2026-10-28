#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
launcher="$repo_root/node_modules/rea-agents/scripts/rea.mjs"

if [[ ! -f "$launcher" ]]; then
  echo "REA is missing. Run npm ci in $repo_root." >&2
  exit 1
fi

# Use an existing supported runtime. Never upgrade the user's system Node.
runtime_candidates=("${REA_NODE_BINARY:-}" "$(command -v node || true)" "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node")
for runtime_candidate in "${runtime_candidates[@]}"; do
  [[ -n "$runtime_candidate" && -x "$runtime_candidate" ]] || continue
  if "$runtime_candidate" -e 'const [a,b,c] = process.versions.node.split(".").map(Number); process.exit((a === 22 && (b > 23 || (b === 23 && c >= 4))) || (a === 24 && (b > 22 || (b === 22 && c >= 1))) || (a === 26 && (b > 12 || (b === 12 && c >= 1))) || a > 26 ? 0 : 1)'; then
    exec "$runtime_candidate" "$launcher" "$@"
  fi
done

echo "REA needs Node ^22.23.4, ^24.22.1, or >=26.12.1. Set REA_NODE_BINARY to an existing supported executable." >&2
exit 1
