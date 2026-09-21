#!/bin/bash
# jev-ego runner: injects config/secrets via a JEV_ENV stdin header because the
# ego nodejs runtime does not inherit the shell environment.
# Usage:
#   JEV_URL=https://news.ycombinator.com JEV_GOAL="Open the top story comments" ./run.sh
# Optional: TYPESAFE_MODEL, TEXT_MODEL_API_KEY, TEXT_MODEL_BASE_URL, TEXT_MODEL,
#           TEXT_MODEL_REASONING (none|omit)
set -euo pipefail
cd "$(dirname "$0")"

: "${JEV_URL:?set JEV_URL}" "${JEV_GOAL:?set JEV_GOAL}" "${TYPESAFE_API_KEY:?set TYPESAFE_API_KEY}"

header=$(python3 -c '
import json, os
keys = ["JEV_URL","JEV_GOAL","TYPESAFE_API_KEY","TYPESAFE_MODEL",
        "TEXT_MODEL_API_KEY","TEXT_MODEL_BASE_URL","TEXT_MODEL","TEXT_MODEL_REASONING","DEBUG","JEV_KEEP","JEV_AUTO","JEV_SPACE"]
print("globalThis.JEV_ENV = " + json.dumps({k: os.environ[k] for k in keys if k in os.environ}) + ";")
')

{ printf "%s\n" "$header"; cat jev-ego.js; } | ego-browser nodejs
