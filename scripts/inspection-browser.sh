#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
chrome_binary="${REA_CHROME_BINARY:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
profile_directory="$repo_root/.local/browser-profiles/superhuman"

if [[ ! -x "$chrome_binary" ]]; then
  echo "Set REA_CHROME_BINARY to an installed Chrome-family browser executable." >&2
  exit 1
fi

mkdir -p "$profile_directory"
echo "Opening the dedicated Superhuman inspection profile. Sign in normally."
echo "REA endpoint: http://127.0.0.1:9222. Close this Chrome profile after inspection."
exec "$chrome_binary" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir="$profile_directory" \
  --no-first-run \
  --no-default-browser-check \
  'https://mail.superhuman.com'
