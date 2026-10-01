# Changelog

## v0.2.0 — works on real app shells, and checks its own work for QA

Jego could drive simple sites but stalled on modern web apps: buttons below
the fold of a pinned layout, rows clickable only through script, logins that
open a new tab, and runs that never ended. Measured on 20 real tasks in a
Korean web app (teacher and student roles, including a student writing and
submitting an assignment): 12/20 passed before these changes, 19/20 after,
with the 20th confirmed by screenshot; about 4 s per task and about $0.03 of
TypeSafe decisions in total. Wikipedia and Hacker News still pass.

### Reaching more of the page
- **Inner scroll panes:** when the window does not scroll, Scroll down/up
  targets the largest scrolling pane.
- **Script-clickable rows and cards:** the outermost `cursor: pointer` element
  with text and no real control inside is offered as a click.
- **Icon-only buttons** are named after their image file (`image: teacher-btn`).
- **New tabs:** `JEV_FOLLOW_POPUPS=1` follows a page opened with `window.open`.
- **Slow pages:** a BLOCKED decision on a page with no controls yet is retried
  after a short wait, up to five times.

### Ending runs honestly
- **Loop guards:** an action that keeps returning to a page state it already
  produced is hidden from later decisions; the same click repeated
  `JEV_MAX_REPEAT` times (default 8) stops the run with a reason.
- **`JEV_EXPECT="a|b"`:** DONE is accepted only when every text is on the
  page; the final JSON reports `expect_missing`.
- **`JEV_SHOT=path`:** screenshot of the final page before the tab closes.
- **Cost:** the final JSON reports `model_calls`, `usage`, and `text_usage`.

### QA runner
- **`qa/run.mjs` + `qa/report.mjs`:** a scenario file in, one HTML report out —
  independent re-checks, screenshots, time and cost per scenario, before/after
  comparison. See [qa/README.md](qa/README.md).

### Setup and safety
- **Codex text helper:** `TEXT_MODEL_PROVIDER=codex` fills text fields through
  a signed-in Codex CLI (default `gpt-6-luna`, low effort), no API key.
- **Keychain launcher:** `run-keychain.sh` reads keys from the macOS Keychain;
  non-secret settings go in git-ignored `jego.local.env`.
- **Korean** terms join the high-risk keyword gate (결제, 삭제, 전송, 로그인, …).
- **Token masking:** token- and session-like query parameters are masked in
  printed URLs.
- **Landing page:** bilingual guide at https://cskwork.github.io/ego-jev-ultrafast/
  with a plain-language section for non-developers.

`snapshot.js` now differs from upstream in the two snapshot changes above; the
inlined copy in `jego.js` is kept identical.

## v0.1.0 — the port

Single-file, zero-dependency port of browser-use/jev-ultrafast to Ego Lite,
with multi-model benchmarks and guardrails (high-risk keyword gate,
cross-domain stop, freshness guards, hard budgets).
