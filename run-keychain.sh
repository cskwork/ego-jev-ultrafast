#!/bin/bash
# Runs run.sh with API keys read from the macOS login Keychain, so keys never
# live in shell history, dotfiles, or argv.
# One-time setup (-w with no value prompts for the secret):
#   security add-generic-password -a "$USER" -s jego-typesafe -w
#   security add-generic-password -a "$USER" -s jego-text-model -w   # optional
# Non-secret text-helper settings go in jego.local.env (TEXT_MODEL_BASE_URL, TEXT_MODEL, ...).
set -euo pipefail
cd "$(dirname "$0")"

TYPESAFE_API_KEY=$(security find-generic-password -a "$USER" -s jego-typesafe -w) || {
  echo "Keychain item 'jego-typesafe' not found; see setup in $0" >&2
  exit 2
}
export TYPESAFE_API_KEY
if key=$(security find-generic-password -a "$USER" -s jego-text-model -w 2>/dev/null); then
  export TEXT_MODEL_API_KEY="$key"
fi

if [[ -f jego.local.env ]]; then
  set -a
  source jego.local.env
  set +a
fi

exec ./run.sh
