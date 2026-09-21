#!/usr/bin/env python3
"""Summarize bench/results/*.log into a markdown table."""
import json, re, glob, os, statistics as st

rows = []
for path in sorted(glob.glob(os.path.join(os.path.dirname(__file__), "results", "*.log"))):
    name = os.path.basename(path)[:-4]
    model, tid, run = name.split("__")
    text = open(path, errors="replace").read()
    # final JSON block
    m = re.search(r'^\{$.*?^\}$', text, re.S | re.M)
    status = elapsed = steps = reason = None
    if m:
        try:
            d = json.loads(m.group(0))
            status, elapsed, steps = d["status"], d["elapsed_ms"], d["steps"]
            reason = d.get("block_reason")
        except Exception:
            pass
    jev = [int(x) for x in re.findall(r"jev=(\d+)ms", text)]
    txt = [int(x) for x in re.findall(r"text=(\d+)ms", text)]
    err = None
    em = re.search(r"^(?:Error|TypeError|\[error\].*): (.*)$", text, re.M)
    if em and not status:
        err = em.group(1)[:80]
    rows.append(dict(model=model, task=tid, run=run, status=status or f"ERROR: {err or 'no result'}",
                     elapsed=elapsed, steps=steps, jev=jev, txt=txt, reason=reason))

by = {}
for r in rows:
    by.setdefault((r["model"], r["task"]), []).append(r)

print("| model | task | runs | success | steps | jev/step ms (med) | text ms (med) | total ms (med) | notes |")
print("|---|---|---|---|---|---|---|---|---|")
for (model, tid), rs in sorted(by.items()):
    ok = [r for r in rs if r["status"] == "done"]
    jev_all = [x for r in rs for x in r["jev"]]
    txt_all = [x for r in rs for x in r["txt"]]
    elapsed = [r["elapsed"] for r in rs if r["elapsed"] is not None]
    steps = [r["steps"] for r in rs if r["steps"] is not None]
    notes = "; ".join(sorted({(r["reason"] or r["status"])[:60] for r in rs if r["status"] != "done"})) or "-"
    f = lambda v: f"{int(st.median(v))}" if v else "-"
    print(f"| {model} | {tid} | {len(rs)} | {len(ok)}/{len(rs)} | {f(steps)} | {f(jev_all)} | {f(txt_all)} | {f(elapsed)} | {notes} |")

print("\n### raw runs\n")
for r in rows:
    print(f"- {r['model']} {r['task']} {r['run']}: {r['status']} elapsed={r['elapsed']} steps={r['steps']} jev={r['jev']} text={r['txt']}" + (f" reason={r['reason']}" if r["reason"] else ""))
