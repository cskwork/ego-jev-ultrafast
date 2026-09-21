#!/bin/bash
# Jego benchmark harness. Loops text-helper models x tasks x runs.
# Keys come from env vars only; nothing secret is written to disk.
# Usage: ZAI_API_KEY=... DASHSCOPE_API_KEY=... TYPESAFE_API_KEY=... ./bench.sh [runs_per_task]
set -uo pipefail
cd "$(dirname "$0")" || exit 1
RUNS=${1:-2}
OUT=bench/results
mkdir -p "$OUT"

ZAI_KEY=${ZAI_API_KEY:?set ZAI_API_KEY (api.z.ai key for GLM models)}
QWEN_KEY=${DASHSCOPE_API_KEY:?set DASHSCOPE_API_KEY (Alibaba DashScope key for Qwen models)}

# model|base_url|reasoning_mode
MODELS=(
  "glm-4.6|https://api.z.ai/api/coding/paas/v4|omit|$ZAI_KEY"
  "glm-4.5-air|https://api.z.ai/api/coding/paas/v4|omit|$ZAI_KEY"
  "qwen3.8-flash|https://dashscope.aliyuncs.com/compatible-mode/v1|omit|$QWEN_KEY"
  "qwen3.8-max|https://dashscope.aliyuncs.com/compatible-mode/v1|omit|$QWEN_KEY"
)

# task_id|url|goal  (same-domain tasks only; cross-domain guard blocks result-opening)
# The flights date must always be in the FUTURE (past dates are unbookable and
# make the agent spin until the step budget stops it); compute it dynamically.
FLIGHTS_DATE=$(python3 -c "import datetime;print((datetime.date.today()+datetime.timedelta(days=30)).strftime('%B %-d, %Y'))")
TASKS=(
  "flights|https://www.google.com/travel/flights?hl=en|Find one-way flights from Zurich to London on $FLIGHTS_DATE, for one adult in economy. Stop when matching flight options are visible. Do not select or book a flight."
  "hn|https://news.ycombinator.com|Open the comments page of the top-ranked story"
  "wiki|https://en.wikipedia.org/wiki/Main_Page|Search Wikipedia for 'Gödel, Escher, Bach' and open the article about the book"
  "wiki2|https://en.wikipedia.org/wiki/Main_Page|Search Wikipedia for 'Marie Curie' and open the article about the scientist"
)

export JEV_SPACE=jev-bench TYPESAFE_API_KEY="${TYPESAFE_API_KEY:?set TYPESAFE_API_KEY}"

for m in "${MODELS[@]}"; do
  IFS='|' read -r model base reasoning key <<< "$m"
  for t in "${TASKS[@]}"; do
    IFS='|' read -r tid url goal <<< "$t"
    # hn is click-only; the text model is never called, so one run under glm-4.6 suffices
    [ "$tid" = "hn" ] && [ "$model" != "glm-4.6" ] && continue
    n=$RUNS; { [ "$tid" = "hn" ] || [ "$tid" = "flights" ]; } && n=1
    for r in $(seq 1 $n); do
      log="$OUT/${model}__${tid}__r${r}.log"
      echo ">>> $model $tid run$r $(date +%H:%M:%S)"
      TEXT_MODEL_API_KEY="$key" TEXT_MODEL_BASE_URL="$base" TEXT_MODEL="$model" TEXT_MODEL_REASONING="$reasoning" \
        JEV_URL="$url" JEV_GOAL="$goal" ./run.sh > "$log" 2>&1
      echo "    exit=$? $(grep -m1 '"status"' "$log" | tr -d ' ,') $(grep -m1 '"elapsed_ms"' "$log" | tr -d ' ,')"
    done
  done
done
echo "DONE. raw logs in $OUT/"
