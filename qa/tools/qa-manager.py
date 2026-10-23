#!/usr/bin/env python3
"""Dispatch and monitor StudiQ manual QA scenarios across the four persistent slots.

Run inside the container:

    python3 .../qa-manager.py status
    python3 .../qa-manager.py queue MGR-INV-03 MGR-INV-04 MGR-GRP-01
    python3 .../qa-manager.py dispatch MGR-GRP-02 --env 4
    python3 .../qa-manager.py report --env 1
    python3 .../qa-manager.py decisions sync
    python3 .../qa-manager.py decisions pending
    python3 .../qa-manager.py decisions file dec_1 --yes
    python3 .../qa-manager.py decisions file dec_1 --yes --attach dashboard/shots/shot.png
    python3 .../qa-manager.py decisions spawn dec_1
    python3 .../qa-manager.py spawn --env 3 --title "Investigate X" --prompt "..."

The helper never changes code. It only files an issue after an explicit
`decisions file <id> --yes`, and only for a held finding the QA agent proposed.
"""
from __future__ import annotations

import argparse
import base64
import json
import re
import shlex
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]          # .worktrees/qa-env
QA = ROOT / "qa"
LEDGER = QA / "decisions.json"
SHOTS = ROOT / "dashboard" / "shots"
BASE = "http://127.0.0.1:4096"
AUTH = "Basic " + base64.b64encode(b"opencode:studiq-local-dev").decode()
MODEL = {"providerID": "opencode-go", "id": "deepseek-v4.1-flash", "variant": "high"}
SLOTS = {n: f"/workspaces/studiq/.worktrees/qa-env-{n}" for n in range(1, 9)}
APP_PORT = {n: 3009 + n for n in SLOTS}
ADMIN_PORT = {n: 4009 + n for n in SLOTS}
DASHBOARD = "http://localhost:5000/"
SEVERITIES = ("critical", "high", "medium", "low")
AREAS = ("frontend", "backend", "database", "i18n", "visual", "security",
         "accessibility", "performance", "payments")


# --------------------------------------------------------------------------- api
def api(method: str, path: str, body: dict | None = None, timeout: int = 60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        BASE + path, data=data, method=method,
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


def sessions(directory: str | None = None, limit: int = 30) -> list[dict]:
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


def messages(sid: str, order: str = "desc", limit: int = 100) -> list[dict]:
    data = api("GET", f"/api/session/{sid}/message?limit={limit}&order={order}")
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


def last_text(sid: str) -> str:
    for m in messages(sid):          # newest first
        if m.get("type") != "assistant":
            continue
        t = msg_text(m)
        if t.strip():
            return t
    return ""


def create_session(slot: int, title: str, text: str, model: dict | None = None) -> str:
    created = api("POST", "/api/session", {
        "title": title,
        "location": {"directory": SLOTS[slot]},
        "model": model or MODEL,
    })
    session = created.get("data", created) if isinstance(created, dict) else created
    sid = session.get("id")
    if not sid:
        raise SystemExit(f"session create failed: {json.dumps(created)[:400]}")
    api("POST", f"/api/session/{sid}/prompt", {"text": text})
    return sid


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


# ------------------------------------------------------------ report parsing
def extract_json_summary(text: str) -> dict | None:
    blocks = re.findall(r"(?:```|~~~)json\s*(\{.*?\})\s*(?:```|~~~)", text, re.S)
    for raw in reversed(blocks):
        try:
            data = json.loads(raw)
        except Exception:
            continue
        if isinstance(data, dict) and any(k in data for k in ("held", "decisions", "filed")):
            return data
    return None


def section(text: str, name: str) -> str:
    m = re.search(rf"(?:\*\*|#+\s*)\s*(?:\d+\.\s*)?{re.escape(name)}\s*(?:\*\*)?", text, re.I)
    if not m:
        return ""
    start = m.end()
    rest = text[start:]
    nxt = re.search(
        r"(?:\*\*|#+\s*)\s*(?:\d+\.\s*)?(Filed|Found but not filed|Decisions I need|Machine-readable summary)\s*(?:\*\*)?",
        rest, re.I,
    )
    end = nxt.start() if nxt else len(rest)
    return rest[:end].strip()


def bullets(block: str) -> list[str]:
    out, cur = [], []
    for line in block.splitlines():
        if re.match(r"^\s*[-*]\s+", line):
            if cur:
                out.append("\n".join(cur).strip())
            cur = [line]
        elif cur:
            cur.append(line)
    if cur:
        out.append("\n".join(cur).strip())
    return out


def first_sentence(block: str) -> str:
    text = re.sub(r"^\s*[-*]\s+", "", block).strip()
    text = re.sub(r"\s+", " ", text)
    return text.split(". ")[0][:180]


def is_non_finding(block: str) -> bool:
    text = re.sub(r"\s+", " ", re.sub(r"^\s*[-*]\s+", "", block)).strip().lower()
    if not text:
        return True
    if text.startswith(("not re-filed", "not a defect", "no defect", "none.", "none ",
                        "empty", "nothing else", "nothing new", "no other", "all expected",
                        "the rest")):
        return True
    return ("is **not** listed as a defect" in text
            or "not a product defect" in text
            or "not listed as a defect" in text
            or "all expected results all passed" in text)


def is_empty_decision(question: str) -> bool:
    q = re.sub(r"[*`\s]", "", (question or "")).lower()
    if q.startswith("none") or q.startswith("nothing") or q.startswith("n/a"):
        return True
    return q in ("", "na", "nodecision")


def parse_held(block: str) -> dict:
    title = ""
    m = re.search(r"Proposed:\s*`([^`]+)`", block)
    if m:
        title = m.group(1).strip()
    segment = ""
    m = re.search(r"Proposed:[^\n]*", block)
    if m:
        segment = m.group(0)
    sev = ""
    m = (re.search(r"\b(critical|high|medium|low)\b", segment, re.I)
         or re.search(r"`(critical|high|medium|low)`", block, re.I))
    if m:
        sev = m.group(1).lower()
    areas = []
    haystack = segment or block
    for a in AREAS:
        if a not in areas and re.search(rf"\b{re.escape(a)}\b", haystack, re.I):
            areas.append(a)
    why = ""
    m = re.search(r"Held because\s+(.+)", block, re.S)
    if m:
        why = re.sub(r"\s+", " ", m.group(1)).strip()
    return {
        "title": title or first_sentence(block),
        "severity": sev or "medium",
        "areas": areas[:2],
        "why": why,
        "body": block.strip(),
    }


def parse_report(text: str) -> dict:
    summary = extract_json_summary(text)
    if summary:
        held = [{
            "title": h.get("title", ""),
            "severity": h.get("severity", "medium"),
            "areas": h.get("areas", [])[:2],
            "why": h.get("why", ""),
            "body": h.get("body", ""),
        } for h in summary.get("held", [])
            if h.get("title") and h.get("title", "").strip().lower() not in ("none", "empty")]
        decisions = []
        for dec in summary.get("decisions", []):
            if is_empty_decision(dec.get("question", "")):
                continue
            idx = dec.get("held")
            decisions.append({
                "question": dec.get("question", ""),
                "held": idx if isinstance(idx, int) and 0 <= idx < len(held) else None,
            })
        covered = {d["held"] for d in decisions if d.get("held") is not None}
        for i, h in enumerate(held):
            if i not in covered:
                decisions.append({"question": f"File or investigate: {h['title']}?", "held": i})
        return {"held": held, "decisions": decisions, "filed": summary.get("filed", [])}

    held_blocks = [b for b in bullets(section(text, "Found but not filed")) if not is_non_finding(b)]
    held = [parse_held(b) for b in held_blocks]
    dec_lines = bullets(section(text, "Decisions I need"))
    decisions = []
    for i, line in enumerate(dec_lines):
        q = re.sub(r"^\s*[-*]\s+", "", line).strip()
        if is_empty_decision(q):
            continue
        decisions.append({"question": q, "held": i if i < len(held) else None})
    covered = {d["held"] for d in decisions if d.get("held") is not None}
    for i, h in enumerate(held):
        if i not in covered:
            decisions.append({"question": f"File or investigate: {h['title']}?", "held": i})
    return {"held": held, "decisions": decisions, "filed": []}


# ---------------------------------------------------------------- ledger
def load_ledger() -> dict:
    if LEDGER.exists():
        try:
            data = json.loads(LEDGER.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                data.setdefault("synced", [])
                data.setdefault("items", [])
                return data
        except Exception:
            pass
    return {"synced": [], "items": []}


def save_ledger(data: dict) -> None:
    LEDGER.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def next_id(items: list[dict]) -> str:
    top = 0
    for it in items:
        m = re.match(r"dec_(\d+)$", it.get("id", ""))
        if m:
            top = max(top, int(m.group(1)))
    return f"dec_{top + 1}"


def sync_decisions() -> list[dict]:
    data = load_ledger()
    seen = set(data["synced"])
    items = data["items"]
    added: list[dict] = []
    for n in SLOTS:
        for s in sessions(SLOTS[n], 40):
            sid = s.get("id")
            title = s.get("title") or ""
            if not sid or sid in seen or " — manual QA" not in title:
                continue
            if s.get("outcome") is None:
                continue
            scenario = title.split(" — ")[0]
            text = last_text(sid)
            has_sections = bool(re.search(
                r"(?:\*\*|#+\s*)\s*(?:\d+\.\s*)?(Filed|Found but not filed|Decisions I need)\s*(?:\*\*)?",
                text, re.I,
            ))
            parsed = parse_report(text)
            if not parsed["held"] and not parsed["decisions"]:
                if not has_sections and text.strip():
                    item = {
                        "id": next_id(items), "session": sid, "env": n, "scenario": scenario,
                        "question": f"{scenario} finished without the required end-of-session report — inspect the session or re-run it?",
                        "title": "", "severity": "medium", "areas": [],
                        "why": "the final message lacks the Filed / Found but not filed / Decisions sections",
                        "body": text[-1500:], "screenshots": body_screenshots(text),
                        "status": "pending", "action": None,
                        "issue": None, "spawned": None, "spawned_env": None,
                        "created": int(time.time() * 1000),
                    }
                    items.append(item)
                    added.append(item)
                seen.add(sid)
                continue
            for i, h in enumerate(parsed["held"]):
                question = ""
                if i < len(parsed["decisions"]) and parsed["decisions"][i].get("question"):
                    question = parsed["decisions"][i]["question"]
                elif parsed["decisions"]:
                    question = parsed["decisions"][i]["question"] if i < len(parsed["decisions"]) else ""
                if not question:
                    question = f"File or investigate: {h['title']}?"
                item = {
                    "id": next_id(items),
                    "session": sid,
                    "env": n,
                    "scenario": scenario,
                    "question": question,
                    "title": h["title"],
                    "severity": h["severity"],
                    "areas": h["areas"],
                    "why": h["why"],
                    "body": h["body"],
                    "screenshots": body_screenshots(h["body"], question, h["title"]),
                    "status": "pending",
                    "action": None,
                    "issue": None,
                    "spawned": None,
                    "spawned_env": None,
                    "created": int(time.time() * 1000),
                }
                items.append(item)
                added.append(item)
            # decisions that are not tied to a held finding
            for dec in parsed["decisions"]:
                if dec.get("held") is not None:
                    continue
                if not dec.get("question") or is_empty_decision(dec.get("question", "")):
                    continue
                item = {
                    "id": next_id(items), "session": sid, "env": n, "scenario": scenario,
                    "question": dec["question"], "title": "", "severity": "medium",
                    "areas": [], "why": "", "body": "", "screenshots": body_screenshots(dec["question"]),
                    "status": "pending",
                    "action": None, "issue": None, "spawned": None, "spawned_env": None,
                    "created": int(time.time() * 1000),
                }
                items.append(item)
                added.append(item)
            seen.add(sid)
    data["synced"] = sorted(seen)
    save_ledger(data)
    return added


def find_item(dec_id: str) -> dict:
    for it in load_ledger()["items"]:
        if it.get("id") == dec_id:
            return it
    raise SystemExit(f"unknown decision {dec_id!r}")


def update_item(dec_id: str, **fields) -> dict:
    data = load_ledger()
    for it in data["items"]:
        if it.get("id") == dec_id:
            it.update(fields)
            save_ledger(data)
            return it
    raise SystemExit(f"unknown decision {dec_id!r}")


def describe(it: dict) -> str:
    head = f"[{it['id']}] {it['status']:<12} qa-env-{it['env']} / {it['scenario']}"
    lines = [head, f"  Q: {it['question']}"]
    if it.get("title"):
        sev = it.get("severity") or "medium"
        areas = ", ".join(it.get("areas") or [])
        lines.append(f"  Proposed: {it['title']}  [{sev}" + (f"; {areas}]" if areas else "]"))
    if it.get("issue"):
        lines.append(f"  Issue: #{it['issue']}")
    if it.get("spawned"):
        lines.append(f"  Investigating: {it['spawned']} (qa-env-{it.get('spawned_env')})")
    return "\n".join(lines)


# ---------------------------------------------------------------- actions
def cmd_status(_args) -> None:
    act = active_map()
    busy = busy_slots()
    print(f"{'slot':<7} {'state':<8} {'msgs':>4} {'age':>5}  {'web/admin':<9} scenario / session")
    for n in SLOTS:
        s = latest(n)
        state = "running" if s and s.get("id") in act else (s.get("outcome") or "idle") if s else "empty"
        if s:
            msgs = messages(s["id"])
            ts = msg_ts(msgs[0]) if msgs else None
            text = ""
            for m in msgs:
                if m.get("type") == "assistant" and msg_text(m).strip():
                    text = msg_text(m)
                    break
            snippet = re.sub(r"\s+", " ", text)[-110:]
            title = (s.get("title") or "").split(" — ")[0]
            print(f"{'qa-env-'+str(n):<7} {state:<8} {len(msgs):>4} {age(ts):>5}  "
                  f"{http_code(f'http://localhost:{APP_PORT[n]}/login')}/{http_code(f'http://localhost:{ADMIN_PORT[n]}/'):<4} "
                  f"{title:<14} {s['id']}")
            if snippet:
                print(f"        last: {snippet}")
        else:
            print(f"{'qa-env-'+str(n):<7} {state:<8} {'-':>4} {'-':>5}  "
                  f"{http_code(f'http://localhost:{APP_PORT[n]}/login')}/{http_code(f'http://localhost:{ADMIN_PORT[n]}/'):<4} (no session)")
    pend = [i for i in load_ledger()["items"] if i.get("status") == "pending"]
    print(f"\nfree slots: {', '.join('qa-env-'+str(n) for n in sorted(set(SLOTS) - busy)) or 'none'}")
    print(f"pending decisions: {len(pend)}  (qa-manager.py decisions pending)")
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
    sid = create_session(slot, f"{scenario} — manual QA", prompt_for(scenario))
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
        sid = create_session(slot, f"{scenario} — manual QA", prompt_for(scenario))
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
        state = "running" if s.get("id") in act else (s.get("outcome") or "idle")
        text = last_text(s["id"])
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


# ------------------------------------------------------------- decisions
def cmd_decisions(args) -> None:
    action = args.daction or "pending"
    if action == "sync":
        added = sync_decisions()
        print(f"synced: {len(added)} new decision(s)")
        for it in added:
            print(describe(it))
        return
    if action in ("pending", "all"):
        items = load_ledger()["items"]
        if action == "pending":
            items = [i for i in items if i.get("status") == "pending"]
        if not items:
            print("no " + ("pending " if action == "pending" else "") + "decisions")
            return
        for it in items:
            print(describe(it))
            print()
        return
    if action == "show":
        it = find_item(args.dec_id)
        print(json.dumps(it, indent=2, ensure_ascii=False))
        return
    if action == "answer":
        status = "skipped" if args.value == "skip" else "approved"
        it = update_item(args.dec_id, status=status, action=args.value,
                         answer_note=args.note or "")
        print(f"{it['id']}: {args.value} recorded ({status})")
        return
    if action == "file":
        file_decision(args)
        return
    if action == "attach":
        attach_decision(args)
        return
    if action == "spawn":
        spawn_decision(args)
        return
    raise SystemExit(f"unknown decisions action {action!r}")


SHOT_RE = re.compile(r"[\w][\w./-]*\.png", re.I)


def resolve_shot(value: str) -> Path | None:
    """Resolve a screenshot reference to an existing PNG under dashboard/shots."""
    base = SHOTS.resolve()
    candidate = Path(value.strip())
    if not candidate.is_absolute():
        candidate = base / candidate.name
    try:
        resolved = candidate.resolve()
        resolved.relative_to(base)
    except (OSError, ValueError):
        return None
    if resolved.suffix.lower() != ".png" or not resolved.is_file():
        return None
    return resolved


def referenced_screenshots(it: dict, extra: list[str] | None = None) -> list[Path]:
    """Screenshots to attach: explicit field, then any PNG named in the item text."""
    names: list[str] = []
    if isinstance(it.get("screenshots"), list):
        names += [str(x) for x in it["screenshots"]]
    blob = " ".join(str(it.get(key) or "") for key in ("body", "question", "title"))
    names += SHOT_RE.findall(blob)
    names += list(extra or [])
    shots: list[Path] = []
    for name in names:
        resolved = resolve_shot(name)
        if resolved is not None and resolved not in shots:
            shots.append(resolved)
    return shots[:6]


def body_screenshots(*texts: str) -> list[str]:
    """Names of existing shots cited in a report body, recorded on new ledger items."""
    names: list[str] = []
    for text in texts:
        for ref in SHOT_RE.findall(text or ""):
            shot = resolve_shot(ref)
            if shot is not None and shot.name not in names:
                names.append(shot.name)
    return names[:6]


def session_screenshots(it: dict, limit: int = 2) -> list[Path]:
    """Fallback: the last screenshots this session actually captured.

    Used when the report did not name a file, so a forgotten citation cannot
    produce an evidence-free issue. Newest tool results win, and only shots
    named for this decision's slot are considered.
    """
    session = it.get("session")
    if not session:
        return []
    try:
        body = api("GET", f"/api/session/{session}/message?limit=100&order=desc&type=assistant")
    except Exception:
        return []
    prefix = f"qa-env-{it.get('env')}-"
    found: list[Path] = []
    messages = (body or {}).get("data") or []
    for message in messages:
        for part in message.get("content") or []:
            if part.get("type") not in ("tool", "file"):
                continue
            for ref in SHOT_RE.findall(json.dumps(part)):
                shot = resolve_shot(ref)
                if shot is not None and shot.name.startswith(prefix) and shot not in found:
                    found.append(shot)
        if len(found) >= limit:
            break
    return found[:limit]


MAX_SHOT_BYTES = 9_500_000


def attachable(shots: list[Path]) -> list[Path]:
    kept: list[Path] = []
    for shot in shots:
        try:
            size = shot.stat().st_size
        except OSError:
            continue
        if size > MAX_SHOT_BYTES:
            print(f"warning: skipping {shot.name} ({size / 1e6:.1f} MB exceeds GitHub's limit)", file=sys.stderr)
            continue
        kept.append(shot)
    return kept


def filed_has_attachment(number: int) -> bool:
    try:
        proc = subprocess.run(
            ["gh", "issue", "view", str(number), "--repo", "logyQT/studiq", "--json", "body"],
            capture_output=True, text=True,
        )
    except OSError:
        return True
    return proc.returncode != 0 or "user-attachments" in (proc.stdout or "")


def file_decision(args) -> None:
    it = find_item(args.dec_id)
    if not it.get("title"):
        raise SystemExit("this decision has no proposed title; open it with `decisions show` and file manually")
    if not args.yes and not args.dry_run:
        raise SystemExit("refusing to file without --yes (the manager must have explicit user approval)")
    labels = ["bug", it.get("severity") or "medium"] + (it.get("areas") or [])[:2] + ["manual-testing"]
    seen, clean = set(), []
    for lab in labels:
        if lab and lab not in seen:
            seen.add(lab)
            clean.append(lab)
    body = it.get("body") or it.get("question") or ""

    cited = attachable(referenced_screenshots(it, getattr(args, "attach", None)))
    auto = False
    shots = cited
    if not shots and not args.no_screenshot:
        shots = attachable(session_screenshots(it))
        auto = bool(shots)
    if not shots and not args.no_screenshot:
        raise SystemExit(
            f"no screenshot found for {it['id']} ({it['scenario']}).\n"
            f"  Named shots must exist in {SHOTS} and be cited in the finding body, "
            f"or pass --attach {SHOTS}/<file>.png.\n"
            "  Use --no-screenshot only for a genuinely non-visual finding."
        )

    if shots:
        note = "latest session screenshots, attached" if auto else "attached"
        evidence = "**Evidence:** " + ", ".join(f"`{p.name}`" for p in shots) + f" ({note})."
    else:
        evidence = "**Evidence:** no screenshot attached (explicitly waived with --no-screenshot)."
    text = (
        f"**Scenario:** {it['scenario']}\n"
        f"**Severity:** {it.get('severity') or 'medium'}\n"
        f"**Environment:** qa-env-{it['env']} (isolated slot)\n"
        f"**Finding:** {it['title']}\n\n"
        f"{body}\n\n"
        f"{evidence}\n"
    )
    argv = ["gh", "issue", "create", "--repo", "logyQT/studiq",
            "--title", it["title"], "--body", text]
    for lab in clean:
        argv += ["--label", lab]
    for shot in shots:
        argv += ["--attach", f"{shot}#{it['scenario']} screenshot"]
    if args.dry_run:
        print(shlex.join(argv))
        return
    if not shutil.which("gh"):
        raise SystemExit("gh not found")
    proc = subprocess.run(argv, capture_output=True, text=True)
    stdout = proc.stdout or ""
    url = stdout.strip().splitlines()[-1] if stdout.strip() else ""
    m = re.search(r"/issues/(\d+)", url)
    if proc.returncode != 0 and not m:
        raise SystemExit(f"gh failed: {proc.stderr.strip()[:500]}")
    if proc.returncode != 0:
        print(
            "warning: some attachments failed, issue was still created: "
            f"{(proc.stderr or '').strip()[:300]}",
            file=sys.stderr,
        )
    number = int(m.group(1)) if m else None
    update_item(it["id"], status="filed", action="file", issue=number,
                issue_url=url, screenshots=[p.name for p in shots])
    print(f"filed {it['id']}: #{number} {url}")
    if shots:
        print(f"attached: {', '.join(p.name for p in shots)}")
        if number and not filed_has_attachment(number):
            print(
                f"warning: #{number} body has no attachment URL — check it manually",
                file=sys.stderr,
            )


def attach_decision(args) -> None:
    it = find_item(args.dec_id)
    number = it.get("issue")
    if not number:
        raise SystemExit(f"{it['id']} is not filed yet; use `decisions file`")
    cited = attachable(referenced_screenshots(it, getattr(args, "attach", None)))
    shots = cited or attachable(session_screenshots(it))
    if not shots:
        raise SystemExit(
            f"no screenshot found for {it['id']} ({it['scenario']}); "
            f"pass --attach {SHOTS}/<file>.png"
        )
    argv = ["gh", "issue", "edit", str(number), "--repo", "logyQT/studiq"]
    for shot in shots:
        argv += ["--attach", f"{shot}#{it['scenario']} screenshot"]
    if args.dry_run:
        print(shlex.join(argv))
        return
    if not shutil.which("gh"):
        raise SystemExit("gh not found")
    proc = subprocess.run(argv, capture_output=True, text=True)
    if proc.returncode != 0:
        raise SystemExit(f"gh failed: {(proc.stderr or '').strip()[:500]}")
    known = list(it.get("screenshots") or [])
    for shot in shots:
        if shot.name not in known:
            known.append(shot.name)
    update_item(it["id"], screenshots=known[:12])
    print(f"attached to #{number}: {', '.join(p.name for p in shots)}")


def spawn_decision(args) -> None:
    it = find_item(args.dec_id)
    busy = busy_slots()
    if args.env:
        if args.env in busy:
            raise SystemExit(f"qa-env-{args.env} is busy; free: {sorted(set(SLOTS) - busy) or 'none'}")
        slot = args.env
    else:
        free = sorted(set(SLOTS) - busy)
        if not free:
            raise SystemExit("no free slot; try again when one finishes")
        slot = free[0]
    title = f"Investigate: {it['scenario']} — {it.get('title') or it['question']}"[:100]
    prompt = f"""You are investigating a QA finding, not running a test scenario.

Scenario: {it['scenario']}
Finding: {it.get('title') or it['question']}
Proposed severity/areas: {it.get('severity') or 'medium'} / {', '.join(it.get('areas') or [])}
Why it was held: {it.get('why') or 'n/a'}
Question: {it['question']}

Evidence from the QA run:
{it.get('body') or '(see the original session report)'}

This checkout is an isolated QA slot; read qa/env.json for appUrl/adminUrl.
Reproduce the finding with the qa_browser_* tools (NOT browser.*).
Determine whether it is a real product defect and its root cause (trace/log).
Do NOT change code, commit, file issues, or reset the environment.
End with: verdict (real / not real / needs human), evidence, and a proposed
issue body (title, severity, area labels) in at most 4 sentences.
"""
    sid = create_session(slot, title, prompt)
    update_item(it["id"], status="investigating", action="investigate",
                spawned=sid, spawned_env=slot)
    print(f"qa-env-{slot}\t{title}\t{sid}")
    print(f"dashboard: {DASHBOARD}  (Refresh all)")


def cmd_spawn(args) -> None:
    busy = busy_slots()
    if args.env:
        if args.env in busy:
            raise SystemExit(f"qa-env-{args.env} is busy; free: {sorted(set(SLOTS) - busy) or 'none'}")
        slot = args.env
    else:
        free = sorted(set(SLOTS) - busy)
        if not free:
            raise SystemExit("no free slot")
        slot = free[0]
    sid = create_session(slot, args.title, args.prompt)
    print(f"qa-env-{slot}\t{args.title}\t{sid}")
    print(f"dashboard: {DASHBOARD}  (Refresh all)")


# ------------------------------------------------------------------------- main
def main() -> None:
    p = argparse.ArgumentParser(description="Dispatch/monitor QA scenarios on qa-env-1..4")
    sub = p.add_subparsers(dest="cmd")

    sub.add_parser("status", help="slot, state, messages, age, health").set_defaults(fn=cmd_status)
    sub.add_parser("free", help="print free slot numbers").set_defaults(fn=cmd_free)

    d = sub.add_parser("dispatch", help="start one scenario")
    d.add_argument("scenario")
    d.add_argument("--env", type=int, choices=list(SLOTS))
    d.add_argument("--dry-run", action="store_true")
    d.set_defaults(fn=cmd_dispatch)

    q = sub.add_parser("queue", help="fill free slots from a scenario list")
    q.add_argument("scenarios", nargs="+")
    q.add_argument("--dry-run", action="store_true")
    q.set_defaults(fn=cmd_queue)

    r = sub.add_parser("report", help="show the last assistant report")
    r.add_argument("--env", type=int, choices=list(SLOTS))
    r.add_argument("--session")
    r.add_argument("--full", action="store_true")
    r.set_defaults(fn=cmd_report)

    i = sub.add_parser("interrupt", help="interrupt the current session in a slot")
    i.add_argument("env", type=int, choices=list(SLOTS))
    i.add_argument("--dry-run", action="store_true")
    i.set_defaults(fn=cmd_interrupt)

    dec = sub.add_parser("decisions", help="decisions inbox from finished QA runs")
    dsub = dec.add_subparsers(dest="daction")
    dsub.add_parser("sync", help="scan finished sessions and ingest reports").set_defaults(fn=cmd_decisions)
    dsub.add_parser("pending", help="pending decisions").set_defaults(fn=cmd_decisions)
    dsub.add_parser("all", help="all decisions").set_defaults(fn=cmd_decisions)
    s = dsub.add_parser("show"); s.add_argument("dec_id"); s.set_defaults(fn=cmd_decisions)
    a = dsub.add_parser("answer"); a.add_argument("dec_id"); a.add_argument("value", choices=["file", "investigate", "skip"]); a.add_argument("--note"); a.set_defaults(fn=cmd_decisions)
    f = dsub.add_parser("file"); f.add_argument("dec_id"); f.add_argument("--yes", action="store_true"); f.add_argument("--dry-run", action="store_true"); f.add_argument("--attach", action="append", default=[], metavar="PNG", help="extra screenshot to attach (repeatable)"); f.add_argument("--no-screenshot", action="store_true", help="file without evidence (non-visual findings only)"); f.set_defaults(fn=cmd_decisions)
    at = dsub.add_parser("attach"); at.add_argument("dec_id"); at.add_argument("--dry-run", action="store_true"); at.add_argument("--attach", action="append", default=[], metavar="PNG", help="extra screenshot to attach (repeatable)"); at.set_defaults(fn=cmd_decisions)
    sp = dsub.add_parser("spawn"); sp.add_argument("dec_id"); sp.add_argument("--env", type=int, choices=list(SLOTS)); sp.set_defaults(fn=cmd_decisions)

    spw = sub.add_parser("spawn", help="start an arbitrary agent session in a free slot")
    spw.add_argument("--env", type=int, choices=list(SLOTS))
    spw.add_argument("--title", required=True)
    spw.add_argument("--prompt", required=True)
    spw.set_defaults(fn=cmd_spawn)

    args = p.parse_args()
    if not getattr(args, "fn", None):
        args = p.parse_args(["status"])
    args.fn(args)


if __name__ == "__main__":
    main()
