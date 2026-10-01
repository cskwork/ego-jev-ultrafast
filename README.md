# Jego — run Jev ultrafast on Ego Lite

**ego-jev-ultrafast**: [Jev](https://docs.typesafe.ai/introduction) drives your
[Ego Lite](https://github.com/citrolabs/ego-lite) browser. A single-file,
zero-dependency port of
[browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast) with
multi-model benchmarks and extra guardrails. You give it a goal in
plain language ("find one-way flights from Zurich to London on October 20"), and
it clicks, types, and scrolls through the site until the goal is done. It runs
in your real browser window, with your logged-in sessions, not in a headless
sandbox.

[中文文档](README.zh-CN.md)

## Why it is fast

Most browser agents send a screenshot to a vision model, wait several seconds,
get back an action, and repeat. Jego does something cheaper:

1. A script inside the page walks the DOM and builds an **indexed action
   space**: a numbered table of every visible control, its ARIA role, label,
   and current value.
2. That table goes to TypeSafe in a **single typed-choice request**. One
   response contains both the operation (CLICK / TYPE_TEXT / SELECT / WAIT /
   DONE) and the target element index. No screenshots, no chain-of-thought,
   no second call.
3. The executor re-checks the element in the page (freshness guard, geometry,
   hit-test) and fires raw CDP input events at it.

Measured on this codebase, the decision step takes a median of 0.6 to 1.9
seconds (see [bench/BENCHMARK.md](bench/BENCHMARK.md)). A click-only task like
"open the top Hacker News comments" finishes end to end in about 2.5 seconds.
A full Google Flights search (trip type, origin, destination, calendar date,
submit) takes 10 steps and about 60 seconds; most of that time is page
animation and the small helper model, not the decision step.

A small OpenAI-compatible model is called only when a text field needs a
value. It writes the string, nothing else. Tested with Qwen (DashScope) and
GLM (z.ai); Qwen3.8-flash was the fastest in our runs.

## Data flow: read this first

Jego works inside your real, logged-in browser. To make decisions it sends
page data to third-party APIs:

- **Every step**: page URL, title, up to 6000 characters of visible text,
  control labels, and the current values of ordinary input fields (password,
  file, and hidden inputs are excluded) go to `api.typesafe.ai`.
- **When typing**: the same page context, plus your goal and recent actions,
  goes to the `TEXT_MODEL_BASE_URL` you configured (any OpenAI-compatible
  endpoint, https only), or to OpenAI through your local `codex` CLI when
  `TEXT_MODEL_PROVIDER=codex`.
- **Terminal output**: action labels, typed text, and final URLs print to
  stdout. API keys never appear in any output, and query parameters that look
  like tokens or session IDs are masked in printed URLs.

Do not run Jego on pages that contain sensitive information unless you are
comfortable with these destinations. You are responsible for the terms of
TypeSafe and of whichever text-helper provider you choose.

## Requirements

- [Ego Lite](https://github.com/citrolabs/ego-lite) installed and running
  (macOS).
- A TypeSafe API key (`TYPESAFE_API_KEY`).
- Optional, for text fields: a key for any OpenAI-compatible chat endpoint,
  or a signed-in [Codex CLI](https://github.com/openai/codex) (no key needed).

No npm install, no build step. The whole agent is one file, `jego.js`.

## Quick start

```bash
git clone https://github.com/cskwork/ego-jev-ultrafast && cd ego-jev-ultrafast
export TYPESAFE_API_KEY=<your TypeSafe key>

# click-only task
JEV_URL=https://news.ycombinator.com \
JEV_GOAL="Open the comments page of the top-ranked story" \
./run.sh

# task with a text field (GLM shown; any OpenAI-compatible endpoint works)
export TEXT_MODEL_API_KEY=<your text-helper key>
export TEXT_MODEL_BASE_URL=https://api.z.ai/api/coding/paas/v4
export TEXT_MODEL=glm-4.6 TEXT_MODEL_REASONING=omit
JEV_URL="https://en.wikipedia.org/wiki/Main_Page" \
JEV_GOAL="Search Wikipedia for 'Gödel, Escher, Bach' and open the article about the book" \
./run.sh
```

`run.sh` is a thin wrapper: the ego Node runtime does not inherit your shell
environment, so the script injects config and secrets as a `JEV_ENV` header on
stdin. Keys never touch argv or disk.

Optional variables: `TYPESAFE_MODEL` (default `jev-latest`), `DEBUG=1` (log
every decision), `JEV_KEEP=1` (keep the result tab open), `JEV_AUTO=1`
(disable the high-risk keyword gate), `JEV_SPACE` (task space name),
`JEV_FOLLOW_POPUPS=1` (after a click, switch to a tab the page opened with
`window.open`; adds up to 0.75 s per click, so it is off by default),
`JEV_MAX_REPEAT` (identical consecutive clicks before the run stops, default 8).

### Using it for QA

The model's own DONE is not proof. Two options make a run checkable:

- `JEV_EXPECT="text one|text two"`: DONE is accepted only if every text is on
  the page; otherwise the agent keeps going, and after three rejected DONEs the
  run stops as blocked. The final JSON has `expect_missing` (empty = passed).
- `JEV_SHOT=/abs/path/final.png`: saves a screenshot of the final page before
  the tab closes, including popups and viewers that cannot be reopened later.

The final JSON also reports `model_calls`, `usage` (TypeSafe tokens), and
`text_usage` (text-helper tokens) for cost tracking.

### Keys from the macOS Keychain

`run-keychain.sh` reads keys from the login Keychain and then calls `run.sh`,
so keys stay out of shell history and dotfiles:

```bash
security add-generic-password -a "$USER" -s jego-typesafe -w     # prompts
security add-generic-password -a "$USER" -s jego-text-model -w   # optional
cp jego.local.env.example jego.local.env   # non-secret settings
JEV_URL=... JEV_GOAL=... ./run-keychain.sh
```

### Text fields through a Codex subscription

Set `TEXT_MODEL_PROVIDER=codex` and `CODEX_BIN` (absolute path; the ego
runtime does not see your shell `PATH`). Each text field runs
`codex exec --ignore-user-config` with `TEXT_MODEL` (default `gpt-6-luna`) and
`TEXT_MODEL_REASONING` as the reasoning effort (default `low`). Expect about
5 s per field, versus about 1 s for a direct API call.

## Guardrails

These reduce risk. They are mitigations, not guarantees, and they do not
replace supervision.

- **High-risk keyword gate (on by default)**: if an action's label or value
  matches payment, purchase, delete, send, transfer, authorize, or login
  terms (English, Chinese, and Korean), the run stops and reports the action instead
  of executing it. It is a denylist: a cleverly worded button can get past
  it, and link URLs are not inspected. `JEV_AUTO=1` turns it off.
- **Cross-domain stop**: after any action, if the page's hostname is no
  longer the starting host or a subdomain of it, the run stops. This limits
  phishing redirects, though it does not do a full public-suffix check.
- **Freshness guards**: the model can only pick indices from the observed
  action table, never raw selectors or code. Before any input fires, the
  executor re-validates the element (connected, visible, enabled, not
  covered) and compares a page fingerprint. A changed page invalidates the
  decision and forces a fresh observation.
- **Hard budgets**: 60 actions and 120 model calls per run, plus an
  automatic stop after 3 consecutive no-op actions.
- **Loop guards**: an action that keeps leading back to a page state it
  already produced (menu toggles, tabs flipping back) is hidden from later
  decisions; the same click repeated `JEV_MAX_REPEAT` times (default 8) stops
  the run with a reason.
- **User takeover**: if you take control of the task space, Jego stops
  immediately and leaves the space alone.
- **Other**: http/https only for the start URL, best-effort download
  blocking, dialog detection, and fatal (never retried) handling of
  interrupted `<select>` mutations.

Known residual risks: a millisecond-scale TOCTOU window between hit-test and
CDP input, and a DONE judgment that comes from the same model that acts, so a
manipulative page can try to talk it into declaring success. Both are
inherited from the upstream design.

## How it works

```
page ──> snapshot.js ──> indexed action table ──> TypeSafe (1 request)
                                                      │ operation + target
                          freshness guard, hit-test <─┘
                                      │
                            CDP input (click / type)
                                      │
                              observe, repeat
```

- `snapshot.js` comes from upstream with two changes: when the window itself
  does not scroll, it offers scrolling for the largest inner scroll pane
  (common in app shells that pin the window), and it offers plain elements
  made clickable by script (the outermost `cursor: pointer` element with text
  and no real control inside, e.g. list rows and cards). It assigns stable IDs to real
  DOM nodes via a `WeakMap`, collects visible controls and page text, and
  produces a page marker used for staleness checks. A copy is inlined in
  `jego.js` as `READ_STATE`; keep the two identical.
- `jego.js` ports the upstream model layer (typed-choice validation,
  probability checks), the executor (geometry + hit-test + `Input.*` CDP
  events), and the agent loop (single-use decisions, history-before-observe,
  pending-text cache, no-progress stop).
- The browser driver is the documented ego SDK: `taskSpace`,
  `page.evaluate`, and `page.cdp` for raw input. Input stays on raw CDP to
  keep the upstream execution timing; the ego docs allow the CDP escape
  hatch for exactly this case.

Two settle tweaks were added for a foreground browser: a 300 ms observation
cap after clicks (menu close animations are slower than in the upstream
background-tab setup), and one re-observation when a click leaves fewer than
six actions on the table (a sign of a mid-animation overlay). A BLOCKED
decision on a page that has rendered no controls yet (app boot, viewer load)
is retried after a short wait, up to five times.

## Limits

Same boundaries as upstream: web pages with a DOM only. No file uploads,
canvas, iframes, shadow DOM, or complex keyboard widgets. Date pickers and
other composite widgets are the most fragile part. Date goals must be in the
future: an unbookable date makes the agent spin until the step budget stops
it (fail-safe, it does not click randomly).

## Benchmarks

[bench/BENCHMARK.md](bench/BENCHMARK.md) has the full matrix: 4 text-helper
models (GLM-4.6, GLM-4.5-air, Qwen3.8-Max, Qwen3.8-Flash) x 3 task types,
with per-step decision latency, text-helper latency, and success rates.
Reproduce with `bench.sh` (env vars: `ZAI_API_KEY`, `DASHSCOPE_API_KEY`,
`TYPESAFE_API_KEY`). Small samples, one machine, your numbers will differ.

## Related projects

- [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast):
  the upstream Python agent this is a port of.
- [romaluev/jev-ego](https://github.com/romaluev/jev-ego): an independent
  TypeScript port of the same upstream, built as a daemon with an HTTP API
  and a test suite. Jego is a single dependency-free file with a multi-model
  benchmark and extra guardrails. Different tradeoffs, same idea.

## License and attribution

MIT, see [LICENSE](LICENSE). Jego is a port of
[browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast)
(MIT, copyright Browser Use); `snapshot.js` is copied with the inner-pane
scroll and clickable-element changes described above, and the
upstream license text is reproduced in the THIRD-PARTY NOTICES section.
Ego Lite is an MIT project by CitroLabs; Jego only calls its public CLI and
contains none of its code. Jego is an unofficial project, not affiliated
with CitroLabs or browser-use, and "Ego" is referenced only to indicate
compatibility. TypeSafe (Jev) is a hosted service; bring your own key.
