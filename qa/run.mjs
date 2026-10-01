// QA runner: drives each scenario through Jego, then re-checks the result
// independently (the agent's own DONE is not proof).
//
//   node qa/run.mjs <scenarios.mjs> [--out <dir>] [--start <id> | --only <id,id>]
//
// <scenarios.mjs> exports `meta` ({ title, env, lang }) and `scenarios`:
//   { id, title, url, goal,               required
//     role,                               label shown in the report
//     expect: ["text", ...],              must be on the agent's final page (JEV_EXPECT)
//     expectUrl: "substring",             must be in the agent's final URL
//     accept: ["done"],                   agent statuses that count (e.g. ["done","blocked"]
//                                         for a hand-off that ends on another domain)
//     verifyUrl: "https://...",           page to re-open for the independent check
//     reopen: true,                       re-open the final URL when no verifyUrl (default true)
//     mutation: true, prep: true,         report flags (prep = not counted)
//     env: { JEV_...: "..." } }           extra Jego options for this scenario
//
// Results go to <out>/results.json (merged, so a run can resume), screenshots
// to <out>/shots/. Build the page with qa/report.mjs.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const JEGO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const file = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
if (!file) {
  console.error("Usage: node qa/run.mjs <scenarios.mjs> [--out <dir>] [--start <id> | --only <id,id>]");
  process.exit(2);
}
const { scenarios, meta = {} } = await import(pathToFileURL(resolve(file)).href);
const OUT = resolve(opt("--out") ?? join(dirname(resolve(file)), "qa-out"));
const SHOTS = join(OUT, "shots");
mkdirSync(SHOTS, { recursive: true });
const RESULTS = join(OUT, "results.json");
const results = existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, "utf8")) : {};
const save = () => writeFileSync(RESULTS, JSON.stringify(results, null, 2));
writeFileSync(join(OUT, "meta.json"), JSON.stringify({ ...meta, scenarioFile: resolve(file) }, null, 2));

// Keys from the Keychain when that launcher is set up, else from the environment.
const launcher = process.env.JEGO_LAUNCHER ??
  (existsSync(join(JEGO, "run-keychain.sh")) && !process.env.TYPESAFE_API_KEY ? "./run-keychain.sh" : "./run.sh");
// Non-secret settings (text helper etc.) apply with either launcher; the shell wins.
const localEnv = {};
if (existsSync(join(JEGO, "jego.local.env"))) {
  for (const line of readFileSync(join(JEGO, "jego.local.env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) localEnv[m[1]] = m[2].trim();
  }
}

function sh(cmd, argv, { env, input, cwd, timeoutMs }) {
  return new Promise((done) => {
    const child = spawn(cmd, argv, { cwd, env: { ...process.env, ...env } });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code) => (clearTimeout(timer), done({ code, out, err })));
    child.stdin.end(input ?? "");
  });
}

// The ego runtime prints with CRLF and may route console.log to either stream.
function parseRun(text) {
  const lines = text.split(/\r?\n/);
  const steps = lines.filter((l) => l.startsWith("step "));
  const start = lines.lastIndexOf("{"), end = lines.lastIndexOf("}");
  let summary = null;
  if (start >= 0 && end > start) {
    try {
      summary = JSON.parse(lines.slice(start, end + 1).join("\n"));
    } catch {}
  }
  return { steps, summary };
}

async function probe(id, url) {
  const outFile = join(SHOTS, `${id}.json`);
  const script = `
const task = await taskSpace("jego-qa-probe");
const page = (await task.pages())[0] || await task.newPage();
await page.goto(${JSON.stringify(url)}, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4500);
let shot = null;
try { await page.screenshot({ path: ${JSON.stringify(join(SHOTS, id + ".png"))} }); shot = true; } catch (e) { shot = String(e.message).slice(0, 120); }
const text = await page.evaluate("document.body.innerText.replace(/\\\\s+/g,' ').slice(0,4000)");
const fs = await import("node:fs");
fs.writeFileSync(${JSON.stringify(outFile)}, JSON.stringify({ url: await page.url(), title: await page.title(), shot, text }));
await page.close();
`;
  if (existsSync(outFile)) writeFileSync(outFile, "");
  const r = await sh("ego-browser", ["nodejs"], { input: script, timeoutMs: 90000 });
  try {
    return JSON.parse(readFileSync(outFile, "utf8"));
  } catch {
    return { error: (r.out + r.err).slice(-300) };
  }
}

const only = opt("--only") ? new Set(opt("--only").split(",")) : null;
const startId = opt("--start");
let started = !startId;
for (const sc of scenarios) {
  if (only && !only.has(sc.id)) continue;
  if (!started && sc.id !== startId) continue;
  started = true;
  console.log(`\n=== ${sc.id} ${sc.title}`);
  const t0 = Date.now();
  const run = await sh(launcher, [], {
    cwd: JEGO,
    env: {
      ...localEnv,
      JEV_URL: sc.url, JEV_GOAL: sc.goal, JEV_SPACE: `jego-qa-${sc.id}`, JEV_FOLLOW_POPUPS: "1",
      JEV_SHOT: join(SHOTS, `${sc.id}-final.png`),
      ...(sc.expect?.length ? { JEV_EXPECT: sc.expect.join("|") } : {}),
      ...(sc.env ?? {}),
    },
    timeoutMs: 420000,
  });
  const { steps, summary } = parseRun(`${run.out}\n${run.err}`);
  const wallMs = Date.now() - t0;
  steps.forEach((s) => console.log("  " + s));
  const status = summary?.status ?? "error";
  const finalUrl = summary?.final_url ?? null;
  console.log(`  -> ${status} ${summary?.block_reason ?? ""}`);

  const accept = sc.accept ?? ["done"];
  const checks = [{ name: `agent status in [${accept.join(", ")}]`, key: "status", ok: accept.includes(status) }];
  if (summary?.expect_missing) {
    checks.push({ name: `expected text on agent page: ${(sc.expect ?? []).join(", ")}`, key: "expect", ok: summary.expect_missing.length === 0 });
  }
  if (sc.expectUrl) checks.push({ name: `final URL contains ${sc.expectUrl}`, key: "url", ok: !!finalUrl?.includes(sc.expectUrl) });
  let probeRes = null;
  const reopen = sc.verifyUrl ?? (sc.reopen !== false && finalUrl && !finalUrl.includes("REDACTED") ? finalUrl : null);
  if (reopen) {
    probeRes = await probe(sc.id, reopen);
    checks.push({ name: "re-opened page is not an error page", key: "reopen", ok: !!probeRes.url && !/error|40[134]|50\d/i.test(new URL(probeRes.url).pathname) });
    for (const t of sc.expect ?? []) checks.push({ name: `re-opened page shows '${t}'`, key: "reopen-text", ok: !!probeRes.text?.includes(t) });
  }
  const pass = checks.every((c) => c.ok);
  console.log(`  verify: ${pass ? "PASS" : "FAIL"} ${checks.map((c) => (c.ok ? "✓ " : "✗ ") + c.name).join(" | ")}`);
  results[sc.id] = {
    id: sc.id, status, finalUrl, blockReason: summary?.block_reason ?? null, steps,
    history: summary?.history ?? [], elapsedMs: summary?.elapsed_ms ?? null, wallMs,
    modelCalls: summary?.model_calls ?? null, usage: summary?.usage ?? null,
    textCalls: summary?.text_calls ?? 0, textUsage: summary?.text_usage ?? null,
    finalShot: summary?.screenshot ? `shots/${sc.id}-final.png` : null,
    error: summary ? null : `${run.out}\n${run.err}`.slice(-600),
    probe: probeRes && { url: probeRes.url, title: probeRes.title, shot: probeRes.shot === true, text: probeRes.text?.slice(0, 1200), error: probeRes.error },
    checks, pass, at: new Date().toISOString(),
  };
  save();
}
console.log(`\nALL DONE → ${RESULTS}`);
