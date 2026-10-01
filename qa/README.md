# Jego QA: scenarios in, an HTML report out

Turns Jego into a small QA runner. You list what a user should be able to do,
each as a plain-language goal; Jego does it in Ego Lite; the runner then checks
the result itself and writes one HTML report with screenshots, time, and cost.

```bash
node qa/run.mjs qa/examples/public-sites.mjs --out /tmp/jego-qa
node qa/report.mjs /tmp/jego-qa --open
```

## Why a separate check

The model that clicks also decides when it is done, so its DONE is not proof.
Each scenario is judged by:

1. the agent's final status (`accept`, default `["done"]`);
2. `expect` texts on the agent's own final page (`JEV_EXPECT`), and the final
   URL (`expectUrl`);
3. an independent re-open of the result page (`verifyUrl`, or the final URL)
   in a fresh tab: not an error page, and the `expect` texts are there.

A final screenshot (`JEV_SHOT`) is kept for every scenario, including popups
and viewers that cannot be re-opened.

## Scenario file

```js
export const meta = { title: "My app QA", env: "staging", lang: "ko" }; // lang: ko | en
export const scenarios = [
  { id: "login-home", title: "Teacher lands on the dashboard", role: "teacher",
    url: "https://app.example.com/entry",
    goal: "Press the teacher entry button and wait for the dashboard",
    accept: ["done", "blocked"],          // a hand-off to another domain stops the run on purpose
    expectUrl: "user_type=T",
    verifyUrl: "https://tenant.example.com/dashboard", expect: ["Dashboard"] },
];
```

Other fields: `reopen: false` (skip the re-open), `mutation: true` (flag
scenarios that write data), `prep: true` (setup step, not counted), and
`env: { JEV_MAX_REPEAT: "12" }` for per-scenario Jego options.

Runs resume: `--start <id>` continues from a scenario, `--only a,b` reruns a
few; results are merged into `<out>/results.json`.

## Report

`qa/report.mjs <out> [--baseline <older results.json>] [--open]` writes
`<out>/report.html`: pass counts (before/after with `--baseline`), a table with
steps, model calls, agent and wall time, input tokens and cost per scenario,
and one card per scenario with goal, steps, checks, and the final screenshot.

Add reviewer judgement in `<out>/notes.json`:

```json
{ "login-home": { "verdict": "pass", "summary": "Plain-language note", "checks": [{ "name": "Screenshot shows the class list", "ok": true }] },
  "_findings": ["What a non-developer should know"],
  "_env": ["Accounts used, data changed, what to clean up"] }
```

Cost uses TypeSafe's published input price, $42 per billion input tokens
(set `QA_INPUT_PRICE_PER_BILLION` to change it); no output price is published.
Subscription text helpers such as Codex are shown as tokens only.
