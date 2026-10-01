// Builds <out>/report.html from a qa/run.mjs output folder.
//
//   node qa/report.mjs <out-dir> [--baseline <older results.json>] [--open]
//
// Optional <out-dir>/notes.json adds reviewer judgement:
//   { "<id>": { "verdict": "pass|partial|fail", "summary": "...", "checks": [{ "name": "...", "ok": true }] },
//     "_findings": ["..."], "_env": ["..."] }
// Cost uses TypeSafe's published input price ($42 per billion input tokens,
// typesafe.ai, 2026-10). No output price is published, so output is not priced.
// Override with QA_INPUT_PRICE_PER_BILLION.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const dir = resolve(args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1] === "--baseline")) ?? "qa-out");
const read = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback);
const meta = read(join(dir, "meta.json"), {});
const results = read(join(dir, "results.json"), {});
const notes = read(join(dir, "notes.json"), {});
const bi = args.indexOf("--baseline");
const baseline = bi >= 0 ? read(resolve(args[bi + 1]), {}) : null;
const { scenarios = [] } = meta.scenarioFile && existsSync(meta.scenarioFile)
  ? await import(pathToFileURL(meta.scenarioFile).href)
  : { scenarios: Object.keys(results).map((id) => ({ id, title: id })) };

const ko = meta.lang !== "en";
const L = ko
  ? { pass: "통과", partial: "부분", fail: "실패", none: "미실행", prep: "준비", passed: "통과", before: "개선 전", after: "결과",
      steps: "단계", calls: "판단 호출", agentTime: "소요(에이전트)", wallTime: "소요(확인 포함)", tokens: "입력 토큰", cost: "비용",
      total: "전체 소요(확인 포함)", avg: "기능당 평균 소요(에이전트)", costSum: "판단 비용 합계", actions: "총 브라우저 동작",
      overview: "한눈에 보기", detail: "기능별 상세", basis: "시간·비용 기준", findings: "핵심 발견", env: "환경·데이터 변경 기록",
      goal: "지시", result: "결과", stopped: "멈춘 이유", url: "최종 주소", spend: "비용", mutation: "데이터 변경", reviewed: "화면 검토",
      noshot: "캡처 없음", role: "역할", feature: "기능", sec: "초", min: "분",
      lead: "각 기능은 Jego에게 목표 문장만 주고 실행했습니다. 에이전트의 \"완료\" 보고는 믿지 않고, 기대 문구 확인·최종 캡처·결과 화면 재확인으로 검증했습니다.",
      basisLines: (calls, tin, n, codex) => [
        "소요(에이전트): Jego가 첫 화면을 연 뒤 끝날 때까지. 소요(확인 포함): 브라우저 실행·재확인·캡처까지 포함한 실제 시간.",
        `판단 비용: TypeSafe 공개 가격 입력 토큰 10억 개당 $${PRICE}로 계산. 출력 토큰 가격은 공개되지 않아 제외. 원화는 1달러 1,400원 가정.`,
        `글자 입력 도우미(Codex 등 구독형)는 추가 요금 없이 토큰 수만 표시합니다. 합계 ${codex.toLocaleString()} 토큰.`,
        `판단 호출 ${calls}회 · 입력 ${tin.toLocaleString()} 토큰 (사용량이 측정된 ${n}개 기능 기준).`] }
  : { pass: "pass", partial: "partial", fail: "fail", none: "not run", prep: "prep", passed: "passed", before: "before", after: "result",
      steps: "steps", calls: "model calls", agentTime: "agent time", wallTime: "wall time", tokens: "input tokens", cost: "cost",
      total: "total wall time", avg: "avg agent time", costSum: "decision cost", actions: "browser actions",
      overview: "Overview", detail: "Details", basis: "How time and cost are measured", findings: "Findings", env: "Environment and data changes",
      goal: "goal", result: "result", stopped: "stopped", url: "final URL", spend: "cost", mutation: "writes data", reviewed: "screen review",
      noshot: "no screenshot", role: "role", feature: "feature", sec: "s", min: "min",
      lead: "Each feature was run by giving Jego a plain-language goal. The agent's own DONE is not trusted: expected text, a final screenshot, and an independent re-open decide.",
      basisLines: (calls, tin, n, codex) => [
        "Agent time: from the first page to the end of the run. Wall time: including browser start, re-check and screenshots.",
        `Decision cost: TypeSafe's published price, $${PRICE} per billion input tokens. No output price is published, so output is not priced.`,
        `Subscription text helpers (e.g. Codex) add no per-call charge; tokens only: ${codex.toLocaleString()}.`,
        `${calls} model calls, ${tin.toLocaleString()} input tokens (over ${n} measured features).`] };

const PRICE = Number(process.env.QA_INPUT_PRICE_PER_BILLION ?? 42);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const sec = (ms) => (ms == null ? "-" : (ms / 1000).toFixed(1) + L.sec);
const cost = (r) => (r?.usage?.input_tokens != null ? (r.usage.input_tokens * PRICE) / 1e9 : null);
const usd = (v) => (v == null ? "-" : "$" + v.toFixed(4));
const krw = (v) => (v == null || !ko ? "" : ` · 약 ${Math.round(v * 1400 * 10) / 10}원`);
const VMAP = { pass: L.pass, partial: L.partial, fail: L.fail };
const verdict = (id) => {
  const n = notes[id]?.verdict;
  if (n) return VMAP[n] ?? n;
  const r = results[id];
  return r ? (r.pass ? L.pass : L.fail) : L.none;
};
const baseVerdict = (id) => (baseline?.[id] ? (baseline[id].pass ? L.pass : L.fail) : "-");

const rows = scenarios.map((sc) => ({ sc, r: results[sc.id], n: notes[sc.id] ?? {} }));
const counted = rows.filter(({ sc }) => !sc.prep);
const nPass = counted.filter(({ sc }) => verdict(sc.id) === L.pass).length;
const nPartial = counted.filter(({ sc }) => verdict(sc.id) === L.partial).length;
const measured = counted.filter(({ r }) => cost(r) != null);
const totalCost = measured.reduce((a, { r }) => a + cost(r), 0);
const totalIn = measured.reduce((a, { r }) => a + r.usage.input_tokens, 0);
const totalCalls = measured.reduce((a, { r }) => a + (r.modelCalls ?? 0), 0);
const totalWall = counted.reduce((a, { r }) => a + (r?.wallMs ?? 0), 0);
const totalSteps = counted.reduce((a, { r }) => a + (r?.history?.length ?? 0), 0);
const codexTok = counted.reduce((a, { r }) => a + (r?.textUsage?.total_tokens ?? 0), 0);
const timed = counted.filter(({ r }) => r?.elapsedMs);
const avg = timed.reduce((a, { r }) => a + r.elapsedMs, 0) / (timed.length || 1);
const num = (sc) => (sc.prep ? L.prep : String(counted.findIndex((x) => x.sc.id === sc.id) + 1).padStart(2, "0"));
const badge = (v) => `<span class="b ${v === L.pass ? "ok" : v === L.partial ? "warn" : v === "-" ? "" : "bad"}">${esc(v)}</span>`;
const shotOf = (id) => (existsSync(join(dir, "shots", `${id}-final.png`)) ? `shots/${id}-final.png` : existsSync(join(dir, "shots", `${id}.png`)) ? `shots/${id}.png` : null);

const card = ({ sc, r, n }) => {
  const shot = shotOf(sc.id);
  return `<article class="card" id="${esc(sc.id)}">
  <header><span class="num">${num(sc)}</span>${sc.role ? `<span class="role">${esc(sc.role)}</span>` : ""}<h3>${esc(sc.title)}</h3>${badge(verdict(sc.id))}${sc.mutation ? `<span class="b mut">${L.mutation}</span>` : ""}</header>
  ${n.summary ? `<p class="sum">${esc(n.summary)}</p>` : ""}
  <div class="grid"><div>
    <dl><dt>${L.goal}</dt><dd class="goal">${esc(sc.goal)}</dd>
    <dt>${L.result}</dt><dd>${esc(r?.status ?? "-")} · ${r?.history?.length ?? 0} ${L.steps} · ${sec(r?.elapsedMs)}</dd>
    <dt>${L.spend}</dt><dd>${L.calls} ${r?.modelCalls ?? "-"} · in ${r?.usage?.input_tokens?.toLocaleString() ?? "-"} / out ${r?.usage?.output_tokens?.toLocaleString() ?? "-"} · ${usd(cost(r))}${r?.textUsage?.total_tokens ? ` · text ${r.textUsage.total_tokens.toLocaleString()} tok` : ""}</dd>
    ${r?.blockReason ? `<dt>${L.stopped}</dt><dd>${esc(r.blockReason)}</dd>` : ""}
    <dt>${L.url}</dt><dd class="mono">${esc(r?.finalUrl?.replace(/^https?:\/\/[^/]+/, "") ?? "-")}</dd></dl>
    <ol class="steps">${(r?.history ?? []).map((h) => `<li><b>${esc(h.operation)}</b> ${esc(h.action)}${h.text ? ` <q>${esc(h.text)}</q>` : ""}</li>`).join("")}</ol>
    <ul class="checks">${[...(r?.checks ?? []), ...(n.checks ?? []).map((c) => ({ ...c, name: `${c.name} (${L.reviewed})` }))].map((c) => `<li class="${c.ok ? "y" : "n"}">${c.ok ? "✓" : "✗"} ${esc(c.name)}</li>`).join("")}</ul>
  </div><div class="shot">${shot ? `<a href="${shot}"><img loading="lazy" src="${shot}" alt="${esc(sc.title)}"></a>` : `<div class="noshot">${L.noshot}</div>`}</div></div>
</article>`;
};

const list = (items) => `<div class="note"><ul>${items.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div>`;
const html = `<!doctype html><html lang="${ko ? "ko" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(meta.title ?? "Jego QA report")}</title>
<style>
:root{--bg:#0f1115;--panel:#171a21;--line:#262b36;--fg:#e7e9ee;--mut:#9aa3b2;--ok:#2fbf71;--warn:#e0a526;--bad:#e5484d;--acc:#6aa8ff}
@media (prefers-color-scheme:light){:root{--bg:#f6f7f9;--panel:#fff;--line:#e3e6eb;--fg:#15181e;--mut:#5d6675}}
*{box-sizing:border-box}body{margin:0;font:15px/1.6 -apple-system,"Apple SD Gothic Neo",Pretendard,"Segoe UI",sans-serif;background:var(--bg);color:var(--fg)}
main{max-width:1180px;margin:0 auto;padding:40px 24px 80px}h1{font-size:28px;margin:0 0 6px}h2{margin:40px 0 12px;font-size:20px}
.lead{color:var(--mut);margin:0 0 24px}.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.kpi{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px}.kpi b{display:block;font-size:26px}.kpi span{color:var(--mut);font-size:13px}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
td,th{padding:8px 12px;border-bottom:1px solid var(--line);text-align:left;font-size:14px}th{color:var(--mut);font-weight:600}
a{color:var(--acc);text-decoration:none}.b{display:inline-block;padding:1px 9px;border-radius:999px;font-size:12px;font-weight:700;margin-left:6px}
.ok{background:color-mix(in srgb,var(--ok) 18%,transparent);color:var(--ok)}.warn{background:color-mix(in srgb,var(--warn) 18%,transparent);color:var(--warn)}
.bad{background:color-mix(in srgb,var(--bad) 18%,transparent);color:var(--bad)}.mut{background:color-mix(in srgb,var(--acc) 18%,transparent);color:var(--acc)}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin:14px 0}
.card header{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.card h3{margin:0;font-size:17px}
.num{font-weight:800;color:var(--acc)}.role{font-size:12px;color:var(--mut);border:1px solid var(--line);border-radius:6px;padding:0 6px}
.sum{margin:10px 0 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:12px}@media(max-width:860px){.grid{grid-template-columns:1fr}}
dl{margin:0;display:grid;grid-template-columns:90px 1fr;gap:4px 10px;font-size:14px}dt{color:var(--mut)}dd{margin:0}.goal{color:var(--mut)}
.mono{font-family:ui-monospace,Menlo,monospace;font-size:12px;word-break:break-all}.steps{font-size:13px;margin:10px 0;padding-left:20px}
.steps q{color:var(--acc)}.checks{list-style:none;padding:0;margin:8px 0 0;font-size:13px}.checks .y{color:var(--ok)}.checks .n{color:var(--bad)}
.shot img{width:100%;border-radius:8px;border:1px solid var(--line)}.noshot{height:100%;min-height:120px;display:grid;place-items:center;color:var(--mut);border:1px dashed var(--line);border-radius:8px;font-size:13px}
.note{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 18px}.note li{margin:4px 0}
</style></head><body><main>
<h1>${esc(meta.title ?? "Jego QA report")}</h1>
<p class="lead">${esc([new Date().toISOString().slice(0, 10), meta.env].filter(Boolean).join(" · "))}<br>${L.lead}</p>
<div class="kpis">
<div class="kpi"><b>${nPass} / ${counted.length}</b><span>${L.passed}</span></div>
${baseline ? `<div class="kpi"><b>${counted.filter(({ sc }) => baseVerdict(sc.id) === L.pass).length} / ${counted.length}</b><span>${L.passed} (${L.before})</span></div>` : ""}
${nPartial ? `<div class="kpi"><b>${nPartial}</b><span>${L.partial}</span></div>` : ""}
<div class="kpi"><b>${totalSteps}</b><span>${L.actions}</span></div>
<div class="kpi"><b>${sec(avg)}</b><span>${L.avg}</span></div>
<div class="kpi"><b>${(totalWall / 60000).toFixed(1)}${L.min}</b><span>${L.total}</span></div>
<div class="kpi"><b>${usd(totalCost)}</b><span>${L.costSum}${krw(totalCost)}</span></div>
</div>
${notes._findings ? `<h2>${L.findings}</h2>${list(notes._findings)}` : ""}
<h2>${L.basis}</h2>${list(L.basisLines(totalCalls, totalIn, measured.length, codexTok))}
<h2>${L.overview}</h2>
<table><thead><tr><th>#</th><th>${L.role}</th><th>${L.feature}</th>${baseline ? `<th>${L.before}</th>` : ""}<th>${L.after}</th><th>${L.steps}</th><th>${L.calls}</th><th>${L.agentTime}</th><th>${L.wallTime}</th><th>${L.tokens}</th><th>${L.cost}</th></tr></thead><tbody>
${rows.map(({ sc, r }) => `<tr><td>${num(sc)}</td><td>${esc(sc.role ?? "")}</td><td><a href="#${esc(sc.id)}">${esc(sc.title)}</a></td>${baseline ? `<td>${badge(baseVerdict(sc.id))}</td>` : ""}<td>${badge(verdict(sc.id))}</td><td>${r?.history?.length ?? "-"}</td><td>${r?.modelCalls ?? "-"}</td><td>${sec(r?.elapsedMs)}</td><td>${sec(r?.wallMs)}</td><td>${r?.usage?.input_tokens?.toLocaleString() ?? "-"}</td><td>${usd(cost(r))}</td></tr>`).join("")}
</tbody></table>
<h2>${L.detail}</h2>
${rows.map(card).join("\n")}
${notes._env ? `<h2>${L.env}</h2>${list(notes._env)}` : ""}
</main></body></html>`;
const outFile = join(dir, "report.html");
writeFileSync(outFile, html);
console.log(`${outFile}  ${nPass}/${counted.length} ${L.passed}`);
if (args.includes("--open")) spawn(process.platform === "darwin" ? "open" : "xdg-open", [outFile], { detached: true, stdio: "ignore" }).unref();
