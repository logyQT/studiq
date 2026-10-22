#!/usr/bin/env python3
"""Dispatch and monitor StudiQ manual QA scenarios across the four persistent slots.

Run inside the container:

    python3 /workspaces/studiq/.worktrees/qa-env/qa/tools/qa-manager.py status
    python3 .../qa-manager.py free
    python3 .../qa-manager.py dispatch MGR-INV-03
    python3 .../qa-manager.py dispatch MGR-GRP-02 --env 4
    python3 .../qa-manager.py queue MGR-INV-03 MGR-INV-04 MGR-GRP-01 --dry-run
    python3 .../qa-manager.py report --env 1
    python3 .../qa-manager.py report --session ses_xxx
    python3 .../qa-manager.py interrupt 2

Concurrency is one scenario per slot, max four. The helper never files issues,
never changes code, and never resets/restarts the environments.
"""
from __future__ import annotations

import argparse
import base64
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]          # .worktrees/qa-env
QA = ROOT / "qa"
BASE = "http://127.0.0.1:4096"
AUTH = "Basic " + base64.b64encode(b"opencode:studiq-local-dev").decode()
MODEL = {"providerID": "opencode-go", "id": "deepseek-v4.1-flash", "variant": "high"}
SLOTS = {n: f"/workspaces/studiq/.worktrees/qa-env-{n}" for n in range(1, 5)}
APP_PORT = {n: 3009 + n for n in SLOTS}
ADMIN_PORT = {n: 4009 + n for n in SLOTS}
DASHBOARD = "http://localhost:4000/"


# --------------------------------------------------------------------------- api
def api(method: str, path: str, body: dict | None = None, timeout: int = 60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        BASE + path,
        data=data,
        method=method,
        headers={"Authorization": AUTH, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        detail = exc.read()[:400].decode("utf-8", "replace")
        raise RuntimeError(f"{method} {path} -> {exc.code}: {detail}") from exc


def http_code(url: str, timeout: int = 3) -> str:
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return str(resp.status)
    except urllib.error.HTTPError as exc:
        return str(exc.code)
    except Exception:
        return "000"


def sessions(directory: str | None = None, limit: int = 20) -> list[dict]:
    q = f"/api/session?limit={limit}&order=desc"
    if directory:
        q += "&directory=" + urllib.parse.quote(directory)
    data = api("GET", q)
    return data.get("data", data) if isinstance(data, dict) else data


def active_map() -> dict:
    data = api("GET", "/api/session/active")
    return data.get("data", data) if isinstance(data, dict) else data


def latest(n: int) -> dict | None:
    items = sessions(SLOTS[n], 5)
    return items[0] if items else None


def busy_slots() -> set[int]:
    act = active_map()
    busy: set[int] = set()
    for n in SLOTS:
        for s in sessions(SLOTS[n], 10):
            if s.get("id") in act:
                busy.add(n)
                break
    return busy


def messages(sid: str) -> list[dict]:
    data = api("GET", f"/api/session/{sid}/message")
    return data.get("data", data) if isinstance(data, dict) else data


def msg_text(m: dict) -> str:
    out = []
    for p in (m.get("content") or m.get("parts") or []):
        if p.get("type") == "text" and p.get("text"):
            out.append(p["text"])
    return "\n".join(out)


def msg_ts(m: dict) -> int | None:
    t = m.get("time") or {}
    return t.get("updated") or t.get("completed") or t.get("created")


def age(ts_ms: int | None) -> str:
    if not ts_ms:
        return "?"
    sec = max(0, int(time.time() - ts_ms / 1000))
    if sec < 90:
        return f"{sec}s"
    if sec < 3600:
        return f"{sec // 60}m"
    return f"{sec // 3600}h{(sec % 3600) // 60:02d}m"


def session_state(n: int, s: dict | None, act: dict) -> str:
    if not s:
        return "empty"
    if s.get("id") in act:
        return "running"
    return s.get("outcome") or "idle"


# ------------------------------------------------------------------- scenarios
def known_ids() -> list[str]:
    text = (QA / "index.md").read_text(encoding="utf-8")
    return re.findall(r"^\|\s*([A-Z][A-Z0-9]+(?:-[A-Z0-9]+)+)\s*\|", text, re.M)


def resolve(raw: str) -> str:
    raw = raw.strip()
    ids = known_ids()
    if raw in ids:
        return raw
    cands = sorted({i for i in ids if i.endswith("-" + raw)})
    if len(cands) == 1:
        return cands[0]
    if cands:
        raise SystemExit(f"ambiguous scenario {raw!r}: {', '.join(cands)}")
    raise SystemExit(f"unknown scenario {raw!r} (see qa/index.md)")


def case_meta(sid: str) -> dict:
    path = QA / "cases" / f"{sid}.md"
    if not path.exists():
        return {"prereqs": [], "title": sid}
    text = path.read_text(encoding="utf-8")
    title = text.splitlines()[0].split("—", 1)[-1].strip() if text else sid
    m = re.search(r"^- prereqs:\s*(.+)$", text, re.M)
    raw = (m.group(1).strip() if m else "none")
    prereqs = [] if raw.lower() in ("none", "—", "") else [x.strip() for x in raw.split(",")]
    return {"prereqs": prereqs, "title": title}


def prompt_for(scenario: str) -> str:
    md = (QA / "AGENT-PROMPT.md").read_text(encoding="utf-8")
    m = re.search(r"```markdown\n(.*?)\n```", md, re.S)
    if not m:
        raise SystemExit("QA prompt block not found in qa/AGENT-PROMPT.md")
    text = m.group(1).strip()
    return re.sub(r"## SCENARIO ▶.*$", f"## SCENARIO ▶ {scenario}", text, flags=re.S)


# ---------------------------------------------------------------------- actions
def cmd_status(_args) -> None:
    act = active_map()
    busy = busy_slots()
    print(f"{'slot':<7} {'state':<8} {'msgs':>4} {'age':>5}  {'web/admin':<9} scenario / session")
    for n in SLOTS:
        s = latest(n)
        state = session_state(n, s, act)
        if s:
            msgs = messages(s["id"])
            ts = msg_ts(msgs[-1]) if msgs else None
            text = msg_text(msgs[-1]) if msgs else ""
            snippet = re.sub(r"\s+", " ", text)[-110:]
            title = (s.get("title") or "").split(" — ")[0]
            print(
                f"{'qa-env-'+str(n):<7} {state:<8} {len(msgs):>4} {age(ts):>5}  "
                f"{http_code(f'http://localhost:{APP_PORT[n]}/login')}/{http_code(f'http://localhost:{ADMIN_PORT[n]}/'):<4} "
                f"{title:<14} {s['id']}"
            )
            if snippet:
                print(f"        last: {snippet}")
        else:
            print(f"{'qa-env-'+str(n):<7} {state:<8} {'-':>4} {'-':>5}  "
                  f"{http_code(f'http://localhost:{APP_PORT[n]}/login')}/{http_code(f'http://localhost:{ADMIN_PORT[n]}/'):<4} (no session)")
    print(f"\nfree slots: {', '.join('qa-env-'+str(n) for n in sorted(set(SLOTS) - busy)) or 'none'}")
    print(f"dashboard: {DASHBOARD}  (Refresh all after a dispatch)")


def cmd_free(_args) -> None:
    free = sorted(set(SLOTS) - busy_slots())
    print(" ".join(str(n) for n in free) if free else "none")


def cmd_dispatch(args) -> None:
    scenario = resolve(args.scenario)
    meta = case_meta(scenario)
    busy = busy_slots()
    if args.env is not None:
        if args.env not in SLOTS:
            raise SystemExit("--env must be 1..4")
        if args.env in busy:
            raise SystemExit(f"qa-env-{args.env} is busy; free: {sorted(set(SLOTS) - busy) or 'none'}")
        slot = args.env
    else:
        free = sorted(set(SLOTS) - busy)
        if not free:
            raise SystemExit("no free slot; queue it and retry when one finishes")
        slot = free[0]
    if meta["prereqs"]:
        print(f"note: {scenario} lists prereqs: {', '.join(meta['prereqs'])} "
              f"(the QA agent recreates state; run a case-ID prereq first if it is not done)")
    if args.dry_run:
        print(f"would dispatch {scenario} -> qa-env-{slot}  title={scenario} — manual QA")
        return
    created = api("POST", "/api/session", {
        "title": f"{scenario} — manual QA",
        "location": {"directory": SLOTS[slot]},
        "model": MODEL,
    })
    session = created.get("data", created) if isinstance(created, dict) else created
    sid = session.get("id")
    if not sid:
        raise SystemExit(f"session create failed: {json.dumps(created)[:400]}")
    api("POST", f"/api/session/{sid}/prompt", {"text": prompt_for(scenario)})
    print(f"qa-env-{slot}\t{scenario}\t{sid}\t{meta['title']}")
    print(f"dashboard: {DASHBOARD}  (Refresh all)")


def cmd_queue(args) -> None:
    scenarios = [resolve(s) for s in args.scenarios]
    busy = set(busy_slots())
    dispatched, queued = [], []
    for scenario in scenarios:
        free = sorted(set(SLOTS) - busy)
        if not free:
            queued.append(scenario)
            continue
        slot = free[0]
        busy.add(slot)
        meta = case_meta(scenario)
        if meta["prereqs"]:
            print(f"note: {scenario} prereqs: {', '.join(meta['prereqs'])}")
        if args.dry_run:
            dispatched.append((slot, scenario, "dry-run"))
            continue
        created = api("POST", "/api/session", {
            "title": f"{scenario} — manual QA",
            "location": {"directory": SLOTS[slot]},
            "model": MODEL,
        })
        session = created.get("data", created) if isinstance(created, dict) else created
        sid = session.get("id")
        if not sid:
            print(f"FAILED {scenario}: {json.dumps(created)[:300]}")
            continue
        api("POST", f"/api/session/{sid}/prompt", {"text": prompt_for(scenario)})
        dispatched.append((slot, scenario, sid))
    for slot, scenario, sid in dispatched:
        print(f"qa-env-{slot}\t{scenario}\t{sid}")
    if queued:
        print("\nQUEUED (no free slot): " + " ".join(queued))
        print("Re-run: qa-manager.py queue " + " ".join(queued))
    print(f"\ndashboard: {DASHBOARD}  (Refresh all)")


def cmd_report(args) -> None:
    targets: list[dict] = []
    if args.session:
        data = api("GET", f"/api/session/{args.session}")
        targets = [data.get("data", data)]
    elif args.env:
        s = latest(args.env)
        if s:
            targets = [s]
    else:
        for n in SLOTS:
            s = latest(n)
            if s:
                targets.append(s)
    if not targets:
        print("no sessions")
        return
    act = active_map()
    for s in targets:
        msgs = messages(s["id"])
        state = "running" if s.get("id") in act else (s.get("outcome") or "idle")
        text = ""
        for m in reversed(msgs):
            t = msg_text(m)
            if t:
                text = t
                break
        print("=" * 78)
        print(f"{s.get('title')}  [{state}]  {s['id']}")
        print(f"location: {(s.get('location') or {}).get('directory')}")
        if not text:
            print("(no assistant text yet)")
            continue
        limit = len(text) if args.full else 3500
        print(text[-limit:])


def cmd_interrupt(args) -> None:
    s = latest(args.env)
    if not s:
        raise SystemExit(f"qa-env-{args.env} has no session")
    if s.get("id") not in active_map():
        print(f"qa-env-{args.env} is not running ({s.get('outcome') or 'idle'})")
        return
    if args.dry_run:
        print(f"would interrupt qa-env-{args.env} {s['id']} ({s.get('title')})")
        return
    api("POST", f"/api/session/{s['id']}/interrupt", {})
    print(f"interrupted qa-env-{args.env} {s['id']}")


# ------------------------------------------------------------------------- main
def main() -> None:
    p = argparse.ArgumentParser(description="Dispatch/monitor QA scenarios on qa-env-1..4")
    sub = p.add_subparsers(dest="cmd")

    sub.add_parser("status", help="slot, state, messages, age, health").set_defaults(fn=cmd_status)
    sub.add_parser("free", help="print free slot numbers").set_defaults(fn=cmd_free)

    d = sub.add_parser("dispatch", help="start one scenario")
    d.add_argument("scenario")
    d.add_argument("--env", type=int, choices=[1, 2, 3, 4])
    d.add_argument("--dry-run", action="store_true")
    d.set_defaults(fn=cmd_dispatch)

    q = sub.add_parser("queue", help="fill free slots from a scenario list")
    q.add_argument("scenarios", nargs="+")
    q.add_argument("--dry-run", action="store_true")
    q.set_defaults(fn=cmd_queue)

    r = sub.add_parser("report", help="show the last assistant report")
    r.add_argument("--env", type=int, choices=[1, 2, 3, 4])
    r.add_argument("--session")
    r.add_argument("--full", action="store_true")
    r.set_defaults(fn=cmd_report)

    i = sub.add_parser("interrupt", help="interrupt the current session in a slot")
    i.add_argument("env", type=int, choices=[1, 2, 3, 4])
    i.add_argument("--dry-run", action="store_true")
    i.set_defaults(fn=cmd_interrupt)

    args = p.parse_args()
    if not getattr(args, "fn", None):
        args = p.parse_args(["status"])
    args.fn(args)


if __name__ == "__main__":
    main()
