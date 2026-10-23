#!/usr/bin/env python3
"""Issue-fixing pipeline for the StudiQ agent crew.

Roles:
    env-1,2,7,8  QA/review pool (two review pairs, or demand-driven QA)
    env-3, env-4 designers       (read code, write implementation design)
    env-5, env-6 writers         (branch, implement, test, open PR)
    manager                      (orchestrates only; never edits code)

The manager owns `state.json`. Each role writes only its own artifact under
`/workspaces/studiq/.qa-fix/issues/<number>/`. Agents never share a mutable
document; stage hand-off is through the manager and those artifacts.

Commands are intentionally small; the manager prompt drives the state machine.
"""
from __future__ import annotations

import argparse
import base64
import collections
import datetime as dt
import fcntl
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path("/workspaces/studiq/.worktrees/qa-env")
FIX = Path("/workspaces/studiq/.qa-fix")
ISSUES = FIX / "issues"
STATE_PATH = FIX / "state.json"
MAP_PATH = FIX / "issue-map.json"
QUEUE_PATH = FIX / "queue.txt"
MIG_RESERVATIONS = FIX / "migration-reservations.json"
MIG_LOCK = FIX / "migration.lock"
MIGRATION_RE = re.compile(r"^(\d{14,})_.+\.sql$")
BASE = "http://127.0.0.1:4096"
AUTH = "Basic " + base64.b64encode(b"opencode:studiq-local-dev").decode()
MODEL = {"providerID": "opencode-go", "id": "deepseek-v4.1-flash", "variant": "high"}
SLOTS = {n: f"/workspaces/studiq/.worktrees/qa-env-{n}" for n in range(1, 9)}
ROLES = {1: "qa_review", 2: "qa_review", 3: "designer", 4: "designer",
         5: "writer", 6: "writer", 7: "qa_review", 8: "qa_review"}
POOL_SLOTS = [7, 8, 1, 2]          # review preference; QA prefers 1,2 first
QA_SLOTS = [1, 2, 7, 8]
ROLE_SLOTS = collections.defaultdict(list)
for _n, _r in ROLES.items():
    ROLE_SLOTS[_r].append(_n)
PRIORITY = {"critical": 0, "high": 1, "medium": 2, "low": 3, "none": 4}
AREAS = ("frontend", "backend", "database", "i18n", "security", "accessibility",
         "performance", "payments", "visual", "admin", "docs", "email")
PROMPTS = ROOT / "qa" / "fixing"


def fail(msg: str, **payload) -> None:
    print(json.dumps({"ok": False, "error": msg, **payload}, ensure_ascii=False))
    sys.exit(1)


def ok(**payload) -> None:
    print(json.dumps({"ok": True, **payload}, ensure_ascii=False))


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def slug(text: str, limit: int = 42) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return (s[:limit].rstrip("-") or "issue")


# --------------------------------------------------------------------- opencode
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
        detail = exc.read()[:500].decode("utf-8", "replace")
        raise RuntimeError(f"{method} {path} -> {exc.code}: {detail}") from exc


def sessions(directory: str, limit: int = 20) -> list[dict]:
    q = f"/api/session?limit={limit}&order=desc&directory={urllib.parse.quote(directory)}"
    data = api("GET", q)
    return data.get("data", data) if isinstance(data, dict) else data


def session_info(sid: str) -> dict:
    data = api("GET", f"/api/session/{sid}")
    return data.get("data", data) if isinstance(data, dict) else data


def active_map() -> dict:
    data = api("GET", "/api/session/active")
    return data.get("data", data) if isinstance(data, dict) else data


def create_session(env: int, title: str, text: str) -> str:
    created = api("POST", "/api/session", {
        "title": title,
        "location": {"directory": SLOTS[env]},
        "model": MODEL,
    })
    session = created.get("data", created) if isinstance(created, dict) else created
    sid = session.get("id")
    if not sid:
        fail("session create failed", response=str(created)[:400])
    api("POST", f"/api/session/{sid}/prompt", {"text": text})
    return sid


def messages(sid: str, limit: int = 100) -> list[dict]:
    data = api("GET", f"/api/session/{sid}/message?limit={limit}&order=desc")
    return data.get("data", data) if isinstance(data, dict) else data


def msg_text(m: dict) -> str:
    parts = []
    for p in (m.get("content") or m.get("parts") or []):
        if p.get("type") == "text" and p.get("text"):
            parts.append(p["text"])
    return "\n".join(parts)


def busy_slots() -> set[int]:
    act = active_map()
    out: set[int] = set()
    for n in SLOTS:
        for s in sessions(SLOTS[n], 10):
            if s.get("id") in act:
                out.add(n)
                break
    return out


# ----------------------------------------------------------------------- github
def gh(args: list[str], timeout: int = 90) -> str:
    env = {**os.environ}
    p = subprocess.run(["gh", *args], capture_output=True, text=True, timeout=timeout, env=env)
    if p.returncode != 0:
        fail("gh failed", cmd="gh " + " ".join(args), stderr=p.stderr[-800:])
    return p.stdout


def fetch_issues() -> list[dict]:
    raw = json.loads(gh(["issue", "list", "--state", "open", "--limit", "400",
                         "--json", "number,title,labels,url,createdAt,updatedAt,body"]))
    return raw


def migration_timestamp(path: str) -> int | None:
    m = MIGRATION_RE.match(path.rsplit("/", 1)[-1])
    return int(m.group(1)) if m else None


def main_migration_set() -> set[int]:
    try:
        subprocess.run(
            ["git", "-C", str(ROOT), "fetch", "origin", "main", "--quiet"],
            capture_output=True, text=True, timeout=30,
        )
    except Exception:
        pass
    try:
        out = subprocess.run(
            ["git", "-C", str(ROOT), "ls-tree", "-r", "--name-only",
             "origin/main", "supabase/migrations"],
            capture_output=True, text=True, timeout=30,
        ).stdout
    except Exception:
        return set()
    vals = [migration_timestamp(line) for line in out.splitlines()]
    return {v for v in vals if v}


def main_migration_ts() -> int:
    return max(main_migration_set() or {0})


def open_pr_migration_set(exclude_pr: int | None = None) -> set[int]:
    try:
        prs = json.loads(gh(["pr", "list", "--state", "open", "--limit", "200",
                             "--json", "number,files"]))
    except SystemExit:
        return set()
    vals: set[int] = set()
    for pr in prs:
        if exclude_pr and pr.get("number") == exclude_pr:
            continue
        for f in pr.get("files") or []:
            v = migration_timestamp(f.get("path", ""))
            if v:
                vals.add(v)
    return vals


def open_pr_migration_ts(exclude_pr: int | None = None) -> int:
    return max(open_pr_migration_set(exclude_pr) or {0})


def load_reservations() -> dict:
    if MIG_RESERVATIONS.exists():
        try:
            return json.load(open(MIG_RESERVATIONS))
        except Exception:
            pass
    return {"reservations": {}}


def save_reservations(data: dict) -> None:
    tmp = MIG_RESERVATIONS.with_suffix(".tmp")
    json.dump(data, open(tmp, "w"), indent=1)
    os.replace(tmp, MIG_RESERVATIONS)


def cmd_migration_ts(args) -> None:
    FIX.mkdir(parents=True, exist_ok=True)
    with open(MIG_LOCK, "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        data = load_reservations()
        reserved = [int(v) for vals in data["reservations"].values() for v in vals]
        floor = max(
            int(dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d%H%M%S")),
            main_migration_ts() + 1,
            open_pr_migration_ts() + 1,
            (max(reserved) if reserved else 0) + 1,
        )
        stamps = [str(floor + i) for i in range(args.count)]
        data["reservations"].setdefault(str(args.issue), []).extend(stamps)
        save_reservations(data)
    ok(action="migration-ts", issue=args.issue, timestamps=stamps,
       next=stamps[0] if len(stamps) == 1 else stamps)


def pr_migrations(pr: int) -> list[str]:
    data = json.loads(gh(["pr", "view", str(pr), "--json", "files"]))
    return [f["path"] for f in data.get("files") or []
            if f.get("path", "").startswith("supabase/migrations/")]


def migration_collisions(n: int, pr: int) -> list[dict]:
    mine = pr_migrations(pr)
    if not mine:
        return []
    main_set = main_migration_set()
    other_set = open_pr_migration_set(pr)
    main_max = max(main_set or {0})
    out = []
    for path in mine:
        ts = migration_timestamp(path)
        if ts and (ts <= main_max or ts in other_set):
            out.append({"path": path, "timestamp": ts,
                        "main_max": main_max,
                        "other_open_max": max(other_set or {0})})
    return out


def cmd_migration_check(args) -> None:
    state = load_state()
    rec = get_rec(state, args.issue)
    pr = args.pr or rec.get("pr")
    if not pr:
        fail("no PR recorded for this issue")
    collisions = migration_collisions(args.issue, int(pr))
    if collisions:
        fail("migration timestamp collision", issue=args.issue, pr=pr,
             collisions=collisions,
             hint="allocate a fresh timestamp with `migration-ts` and rename the file(s)")
    ok(action="migration-check", issue=args.issue, pr=pr, collisions=[])


def cmd_migration_release(args) -> None:
    with open(MIG_LOCK, "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        data = load_reservations()
        data["reservations"].pop(str(args.issue), None)
        save_reservations(data)
    ok(action="migration-release", issue=args.issue)


def normalize_map(raw: list[dict]) -> dict:
    items = []
    for i in raw:
        labels = [l["name"] for l in i["labels"]]
        priority = next((p for p in ("critical", "high", "medium", "low") if p in labels), "none")
        items.append({
            "number": i["number"], "title": i["title"], "url": i["url"],
            "labels": labels, "priority": priority,
            "areas": [a for a in AREAS if a in labels],
            "needs_design": "needs-design" in labels,
            "created": i["createdAt"], "updated": i["updatedAt"],
            "body": i.get("body") or "",
        })
    eligible = sorted((i for i in items if not i["needs_design"]),
                      key=lambda i: (PRIORITY.get(i["priority"], 9), i["number"]))
    return {"generated": now(), "total_open": len(items),
            "eligible": len(eligible), "needs_design": len(items) - len(eligible),
            "issues": items, "queue": [i["number"] for i in eligible]}


def write_map(m: dict) -> None:
    FIX.mkdir(parents=True, exist_ok=True)
    json.dump(m, open(MAP_PATH, "w"), indent=1)
    open(QUEUE_PATH, "w").write("\n".join(str(n) for n in m["queue"]) + "\n")
    md = ISSUES.parent / "issue-map.md"
    c = collections.Counter(i["priority"] for i in m["issues"] if not i["needs_design"])
    with open(md, "w") as f:
        f.write("# StudiQ straightforward issue map\n\n")
        f.write(f"Generated {m['generated']}. Open: {m['total_open']} · "
                f"eligible (no needs-design): {m['eligible']} · needs-design: {m['needs_design']}.\n\n")
        f.write("Priority: " + ", ".join(f"{k}={c[k]}" for k in
                ("critical", "high", "medium", "low", "none")) + "\n\n")
        f.write("| # | P | Areas | Title |\n|---|---|---|---|\n")
        for i in m["issues"]:
            if i["needs_design"]:
                continue
            title = i["title"].replace("|", "\\|")
            f.write(f"| [#{i['number']}]({i['url']}) | {i['priority']} | "
                    f"{', '.join(i['areas'])} | {title} |\n")


# ------------------------------------------------------------------------ state
def empty_state() -> dict:
    return {"version": 1, "roles": {str(k): v for k, v in ROLES.items()},
            "issues": {}, "events": []}


def load_state() -> dict:
    if STATE_PATH.exists():
        try:
            return json.load(open(STATE_PATH))
        except Exception as exc:
            fail(f"state.json invalid: {exc}")
    return empty_state()


def save_state(state: dict) -> None:
    FIX.mkdir(parents=True, exist_ok=True)
    tmp = STATE_PATH.with_suffix(".tmp")
    json.dump(state, open(tmp, "w"), indent=1)
    os.replace(tmp, STATE_PATH)


def load_map() -> dict:
    if not MAP_PATH.exists():
        fail("issue map missing; run `qa-fix sync`")
    return json.load(open(MAP_PATH))


def issue_from_map(m: dict, n: int) -> dict:
    for i in m["issues"]:
        if i["number"] == n:
            return i
    fail(f"issue #{n} not in the eligible map")


def issue_dir(n: int) -> Path:
    return ISSUES / str(n)


def artifact(n: int, name: str) -> Path:
    return issue_dir(n) / name


def history(state: dict, n: int, event: dict) -> None:
    rec = state["issues"][str(n)]
    rec.setdefault("history", []).append({"at": now(), **event})
    rec["updated"] = now()
    state["events"].append({"at": now(), "issue": n, **event})
    state["events"] = state["events"][-500:]
    save_state(state)


def get_rec(state: dict, n: int) -> dict:
    rec = state["issues"].get(str(n))
    if not rec:
        fail(f"issue #{n} is not in the pipeline; start it with `qa-fix design {n}`")
    return rec


def attempt(rec: dict) -> int:
    return int(rec.get("attempt", 1))


def write_issue_snapshot(n: int, issue: dict) -> None:
    d = issue_dir(n)
    d.mkdir(parents=True, exist_ok=True)
    json.dump(issue, open(d / "issue.json", "w"), indent=1, ensure_ascii=False)


# ----------------------------------------------------------------------- prompts
def render(role: str, **kw) -> str:
    path = PROMPTS / f"{role}.md"
    if not path.exists():
        fail(f"prompt missing: {path}")
    text = path.read_text(encoding="utf-8")
    for key, value in kw.items():
        text = text.replace("{{" + key + "}}", str(value))
    return text


def dispatch_prompt(role: str, n: int, stage: str, env: int, rec: dict,
                    review_no: int = 0) -> str:
    issue = json.load(open(issue_dir(n) / "issue.json"))
    a = attempt(rec)
    common = {
        "ISSUE": n,
        "TITLE": issue["title"],
        "URL": issue["url"],
        "ISSUE_PATH": str(issue_dir(n) / "issue.json"),
        "DESIGN_PATH": str(issue_dir(n) / f"design-r{a}.md"),
        "DESIGN_JSON": str(issue_dir(n) / f"design-r{a}.json"),
        "IMPL_PATH": str(issue_dir(n) / f"impl-r{a}.md"),
        "IMPL_JSON": str(issue_dir(n) / f"impl-r{a}.json"),
        "REVIEW_PATH": str(issue_dir(n) / f"review-{review_no}-r{a}.md"),
        "REVIEW_JSON": str(issue_dir(n) / f"review-{review_no}-r{a}.json"),
        "QA_PATH": str(issue_dir(n) / f"qa-r{a}.md"),
        "QA_JSON": str(issue_dir(n) / f"qa-r{a}.json"),
        "ATTEMPT": a,
        "ENV": env,
        "APP_URL": f"http://localhost:{3009 + env}",
        "REVIEW_NO": review_no,
        "BRANCH": rec.get("branch") or f"fix/{n}-{slug(issue['title'])}",
        "PR": rec.get("pr") or "",
        "BASE_BRANCH": "main",
        "REVIEW_1": str(issue_dir(n) / f"review-1-r{a}.json"),
        "REVIEW_2": str(issue_dir(n) / f"review-2-r{a}.json"),
        "QA_RESULT": str(issue_dir(n) / f"qa-r{a}.json"),
        "IMPL_RESULT": str(issue_dir(n) / f"impl-r{a}.json"),
        "DESIGN_RESULT": str(issue_dir(n) / f"design-r{a}.json"),
    }
    # previous artifacts for the designer / writer on a retry
    prev = max(1, a - 1)
    for key, name in (("PREV_DESIGN", "design"), ("PREV_IMPL", "impl"),
                      ("PREV_REVIEW1", "review-1"), ("PREV_REVIEW2", "review-2"),
                      ("PREV_QA", "qa")):
        common[key] = str(issue_dir(n) / f"{name}-r{prev}.md")
    return render(role, **common)


# ------------------------------------------------------------------- operations
def cmd_sync(_args) -> None:
    raw = fetch_issues()
    m = normalize_map(raw)
    write_map(m)
    ok(action="sync", open=m["total_open"], eligible=m["eligible"],
       needs_design=m["needs_design"], queue=m["queue"][:12])


def cmd_map(args) -> None:
    m = load_map()
    if args.json:
        ok(action="map", total_open=m["total_open"], eligible=m["eligible"],
           needs_design=m["needs_design"], map=str(MAP_PATH), markdown=str(ISSUES.parent / "issue-map.md"))
        return
    c = collections.Counter(i["priority"] for i in m["issues"] if not i["needs_design"])
    print(f"straightforward: {m['eligible']}  (open {m['total_open']}, needs-design {m['needs_design']})")
    print("priority: " + " ".join(f"{k}={c[k]}" for k in ("critical", "high", "medium", "low", "none")))
    print(f"map: {MAP_PATH}")
    print(f"md:  {ISSUES.parent / 'issue-map.md'}")
    print("next:", " ".join(f"#{n}" for n in m["queue"][:12]))


def cmd_next(args) -> None:
    m = load_map()
    st = load_state()
    active = {int(n) for n, r in st["issues"].items()
              if r.get("stage") not in ("done", "needs_design", "blocked")}
    for n in m["queue"]:
        if n not in active:
            i = issue_from_map(m, n)
            ok(action="next", issue=i, remaining=len(m["queue"]))
            return
    ok(action="next", issue=None, message="queue exhausted")


def start_issue(state: dict, n: int, role: str, env: int) -> dict:
    m = load_map()
    issue = issue_from_map(m, n)
    if issue["needs_design"]:
        fail(f"issue #{n} is excluded (needs-design)")
    rec = state["issues"].get(str(n))
    if not rec:
        rec = {
            "number": n, "title": issue["title"], "priority": issue["priority"],
            "areas": issue["areas"], "stage": "queued", "attempt": 1,
            "designer": None, "writer": None, "reviewers": [],
            "branch": f"fix/{n}-{slug(issue['title'])}", "pr": None,
            "sessions": {}, "history": [], "created": now(),
        }
        state["issues"][str(n)] = rec
        write_issue_snapshot(n, issue)
    return rec


def role_for_stage(stage: str) -> str:
    return {"design": "designer", "implement": "writer",
            "review": "reviewer", "qa": "qa"}[stage]


def cmd_design(args) -> None:
    state = load_state()
    n = args.issue
    env = args.env or ROLE_SLOTS["designer"][0]
    if ROLES.get(env) != "designer":
        fail(f"slot {env} is {ROLES.get(env)}, not designer")
    rec = start_issue(state, n, "designer", env)
    if rec["stage"] not in ("queued", "design_ready", "changes_requested", "qa_failed", "designing"):
        fail(f"cannot start design from stage {rec['stage']}")
    if env in busy_slots():
        fail(f"designer slot {env} is busy")
    title = f"#{n} design r{attempt(rec)}"
    sid = create_session(env, title, dispatch_prompt("DESIGNER", n, "design", env, rec))
    rec["stage"] = "designing"
    rec["stage_started"] = int(time.time() * 1000)
    rec["designer"] = env
    rec["sessions"]["design"] = sid
    history(state, n, {"event": "design_dispatched", "env": env, "session": sid,
                       "attempt": attempt(rec)})
    ok(action="design", issue=n, env=env, session=sid, title=title,
       artifact=str(issue_dir(n) / f"design-r{attempt(rec)}.json"))


def cmd_implement(args) -> None:
    state = load_state()
    n = args.issue
    rec = get_rec(state, n)
    if rec["stage"] not in ("design_ready", "changes_requested", "qa_failed", "pr_open", "qa_passed"):
        fail(f"cannot implement from stage {rec['stage']}")
    rebase = rec["stage"] == "qa_passed"
    env = args.env or (ROLE_SLOTS["writer"][0] if rec.get("writer") is None
                       else rec["writer"])
    if ROLES.get(env) != "writer":
        fail(f"slot {env} is {ROLES.get(env)}, not writer")
    if env in busy_slots():
        fail(f"writer slot {env} is busy")
    title = f"#{n} {'rebase' if rebase else 'implement'} r{attempt(rec)}"
    sid = create_session(env, title, dispatch_prompt("WRITER", n, "implement", env, rec))
    rec["stage"] = "implementing"
    rec["stage_started"] = int(time.time() * 1000)
    rec["writer"] = env
    rec["sessions"]["implement"] = sid
    history(state, n, {"event": "rebase_requested" if rebase else "implement_dispatched",
                       "env": env, "session": sid, "attempt": attempt(rec)})
    ok(action="rebase" if rebase else "implement", issue=n, env=env, session=sid,
       title=title, artifact=str(issue_dir(n) / f"impl-r{attempt(rec)}.json"))


def cmd_review(args) -> None:
    state = load_state()
    n = args.issue
    rec = get_rec(state, n)
    if rec["stage"] not in ("pr_open", "changes_requested"):
        fail(f"cannot review from stage {rec['stage']}")
    busy = busy_slots()
    if getattr(args, "envs", None):
        try:
            pair = [int(x) for x in args.envs.split(",")]
        except ValueError:
            fail("--envs must be two comma-separated slot numbers")
        if len(pair) != 2 or len(set(pair)) != 2:
            fail("--envs must name exactly two distinct slots")
    else:
        free = [e for e in POOL_SLOTS if e not in busy]
        if len(free) < 2:
            fail("need two free QA/review slots", free=free, busy=sorted(busy))
        pair = free[:2]
    for env in pair:
        if ROLES.get(env) != "qa_review":
            fail(f"slot {env} is {ROLES.get(env)}, not QA/review")
        if env in busy:
            fail(f"QA/review slot {env} is busy")
    sessions_out = []
    for idx, env in enumerate(pair, start=1):
        title = f"#{n} review {idx} r{attempt(rec)}"
        sid = create_session(env, title,
                             dispatch_prompt("REVIEWER", n, "review", env, rec, review_no=idx))
        sessions_out.append({"env": env, "session": sid, "review": idx})
    rec["stage"] = "reviewing"
    rec["stage_started"] = int(time.time() * 1000)
    rec["reviewers"] = pair
    rec["sessions"]["review"] = [s["session"] for s in sessions_out]
    history(state, n, {"event": "review_dispatched", "sessions": sessions_out,
                       "attempt": attempt(rec)})
    ok(action="review", issue=n, sessions=sessions_out,
       artifacts=[str(issue_dir(n) / f"review-{i}-r{attempt(rec)}.json") for i in (1, 2)])


def cmd_qa(args) -> None:
    state = load_state()
    n = args.issue
    rec = get_rec(state, n)
    if rec["stage"] not in ("approved", "qa_failed"):
        fail(f"cannot QA from stage {rec['stage']}")
    busy = busy_slots()
    if args.env:
        env = args.env
        if ROLES.get(env) != "qa_review":
            fail(f"slot {env} is {ROLES.get(env)}, not QA/review")
        if env in busy:
            fail(f"QA/review slot {env} is busy")
    else:
        free = [e for e in QA_SLOTS if e not in busy]
        if not free:
            fail("no free QA/review slot", busy=sorted(busy))
        env = free[0]
    title = f"#{n} qa r{attempt(rec)}"
    sid = create_session(env, title, dispatch_prompt("QA", n, "qa", env, rec))
    rec["stage"] = "qa_testing"
    rec["stage_started"] = int(time.time() * 1000)
    rec["qa_env"] = env
    rec["sessions"]["qa"] = sid
    history(state, n, {"event": "qa_dispatched", "env": env, "session": sid,
                       "attempt": attempt(rec)})
    ok(action="qa", issue=n, env=env, session=sid, title=title,
       artifact=str(issue_dir(n) / f"qa-r{attempt(rec)}.json"))


def read_artifact(path: Path) -> dict:
    if not path.exists():
        fail(f"artifact missing: {path}", hint="read the agent report and ask it to write the JSON artifact")
    try:
        return json.load(open(path))
    except Exception as exc:
        fail(f"artifact invalid JSON: {path}: {exc}")


def stage_started_ms(rec: dict, stage: str) -> int:
    """Timestamp of the current dispatch, falling back to the session create time."""
    value = rec.get("stage_started")
    if isinstance(value, (int, float)) and value > 0:
        return int(value)
    sessions = rec.get("sessions", {})
    sids = sessions.get("review") if stage == "review" else [sessions.get(stage)]
    times = []
    for sid in sids or []:
        try:
            info = session_info(sid)
            times.append(int((info.get("time") or {}).get("created") or 0))
        except Exception:
            continue
    times = [t for t in times if t]
    return min(times) if times else 0


def require_fresh(path: Path, rec: dict, stage: str) -> None:
    started = stage_started_ms(rec, stage)
    if not started:
        return
    mtime = int(path.stat().st_mtime * 1000)
    if mtime < started - 1000:
        fail(
            f"stale artifact for {stage}: {path}",
            artifact_mtime=mtime,
            stage_started=started,
            hint="wait for the current session to write its artifact; do not reuse an earlier pass",
        )


def add_label(n: int, label: str) -> None:
    subprocess.run(["gh", "issue", "edit", str(n), "--add-label", label],
                   capture_output=True, text=True, timeout=60)


def bump_attempt(rec: dict) -> None:
    rec["attempt"] = attempt(rec) + 1


def cmd_collect(args) -> None:
    state = load_state()
    n = args.issue
    rec = get_rec(state, n)
    a = attempt(rec)
    stage = rec["stage"]
    d = issue_dir(n)

    if stage == "designing":
        p = d / f"design-r{a}.json"
        require_fresh(p, rec, "design")
        data = read_artifact(p)
        decision = data.get("decision")
        if decision == "ready":
            rec["stage"] = "design_ready"
            history(state, n, {"event": "design_ready", "decision": decision})
            ok(action="collect", issue=n, stage="design_ready", next="implement", data=data)
        elif decision == "needs_design":
            add_label(n, "needs-design")
            rec["stage"] = "needs_design"
            history(state, n, {"event": "needs_design", "question": data.get("question", "")})
            ok(action="collect", issue=n, stage="needs_design", next=None, data=data)
        else:
            rec["stage"] = "blocked"
            history(state, n, {"event": "design_blocked", "data": data})
            ok(action="collect", issue=n, stage="blocked", next=None, data=data)

    elif stage == "implementing":
        p = d / f"impl-r{a}.json"
        require_fresh(p, rec, "implement")
        data = read_artifact(p)
        if data.get("status") == "pr_open":
            rec["stage"] = "pr_open"
            rec["branch"] = data.get("branch") or rec.get("branch")
            rec["pr"] = data.get("pr")
            history(state, n, {"event": "pr_open", "pr": rec["pr"], "branch": rec["branch"]})
            ok(action="collect", issue=n, stage="pr_open", next="review", data=data)
        else:
            rec["stage"] = "blocked"
            history(state, n, {"event": "implementation_blocked", "data": data})
            ok(action="collect", issue=n, stage="blocked", next=None, data=data)

    elif stage == "reviewing":
        r1 = d / f"review-1-r{a}.json"
        r2 = d / f"review-2-r{a}.json"
        missing = [str(p) for p in (r1, r2) if not p.exists()]
        if missing:
            ok(action="collect", issue=n, stage="reviewing", pending=missing,
               message="waiting for both reviews")
            return
        require_fresh(r1, rec, "review")
        require_fresh(r2, rec, "review")
        d1, d2 = read_artifact(r1), read_artifact(r2)
        decisions = (d1.get("decision"), d2.get("decision"))
        if decisions == ("approve", "approve"):
            rec["stage"] = "approved"
            history(state, n, {"event": "reviews_approved", "reviews": [d1, d2]})
            ok(action="collect", issue=n, stage="approved", next="qa", reviews=[d1, d2])
        else:
            rec["stage"] = "changes_requested"
            bump_attempt(rec)
            history(state, n, {"event": "changes_requested", "reviews": [d1, d2],
                               "next_attempt": attempt(rec)})
            ok(action="collect", issue=n, stage="changes_requested",
               next="design", attempt=attempt(rec), reviews=[d1, d2])

    elif stage == "qa_testing":
        p = d / f"qa-r{a}.json"
        require_fresh(p, rec, "qa")
        data = read_artifact(p)
        if data.get("decision") == "pass":
            rec["stage"] = "qa_passed"
            history(state, n, {"event": "qa_passed", "data": data})
            ok(action="collect", issue=n, stage="qa_passed", next="merge", data=data)
        elif data.get("decision") == "fail":
            rec["stage"] = "qa_failed"
            bump_attempt(rec)
            history(state, n, {"event": "qa_failed", "data": data,
                               "next_attempt": attempt(rec)})
            ok(action="collect", issue=n, stage="qa_failed", next="design",
               attempt=attempt(rec), data=data)
        else:
            rec["stage"] = "blocked"
            history(state, n, {"event": "qa_blocked", "data": data})
            ok(action="collect", issue=n, stage="blocked", next=None, data=data)
    else:
        fail(f"nothing to collect from stage {stage}")


def cmd_merge(args) -> None:
    state = load_state()
    n = args.issue
    rec = get_rec(state, n)
    if rec["stage"] != "qa_passed":
        fail(f"cannot merge from stage {rec['stage']}")
    require_fresh(issue_dir(n) / f"qa-r{attempt(rec)}.json", rec, "qa")
    pr = rec.get("pr")
    if not pr:
        fail("no PR recorded on this issue")
    collisions = migration_collisions(n, int(pr))
    if collisions:
        fail("migration timestamp collision", issue=n, pr=pr,
             collisions=collisions,
             hint="send the writer back with a fresh `migration-ts` allocation, re-run the guard, then re-merge")
    # verify the PR is still open and reviews are recorded
    view = json.loads(gh(["pr", "view", str(pr), "--json", "number,state,isDraft,mergeable,url"]))
    if view.get("state") != "OPEN":
        fail(f"PR #{pr} is {view.get('state')}, not OPEN", pr=view)
    if view.get("isDraft"):
        fail(f"PR #{pr} is still a draft", pr=view)
    gh(["pr", "merge", str(pr), "--squash", "--delete-branch"])
    rec["stage"] = "done"
    rec["merged_at"] = now()
    history(state, n, {"event": "merged", "pr": pr, "url": view.get("url")})
    ok(action="merge", issue=n, pr=pr, stage="done", url=view.get("url"))


def cmd_block(args) -> None:
    state = load_state()
    n = args.issue
    rec = get_rec(state, n)
    rec["stage"] = "blocked"
    rec["blocked_reason"] = args.reason
    history(state, n, {"event": "blocked", "reason": args.reason})
    ok(action="block", issue=n, stage="blocked")


def env_issue(rec: dict, env: int) -> tuple[dict, str] | None:
    stage = rec.get("stage")
    if stage in ("designing", "design_ready") and rec.get("designer") == env:
        return rec, "design"
    if stage in ("implementing", "pr_open", "changes_requested") and rec.get("writer") == env:
        return rec, "implement"
    if stage in ("qa_testing", "qa_passed", "qa_failed") and rec.get("qa_env") == env:
        return rec, "qa"
    if stage in ("reviewing", "approved") and env in (rec.get("reviewers") or []):
        return rec, "review"
    return None


def cmd_status(args) -> None:
    state = load_state()
    active = {k: v for k, v in state["issues"].items()
              if v.get("stage") not in ("done", "needs_design")}
    busy = busy_slots()
    print("slot role      state   issue/stage")
    for env in sorted(SLOTS):
        role = ROLES[env].replace("_", "/")
        label = "-"
        if env in busy:
            latest = sessions(SLOTS[env], 1)
            label = latest[0].get("title", "-") if latest else "-"
        print(f"{env:<4} {role:<9} {'busy' if env in busy else 'free':<7} {label}")
    print("\nissues:")
    for n in sorted(active, key=lambda x: int(x)):
        r = active[n]
        print(f"#{n:<4} {r['stage']:<18} attempt={r.get('attempt',1)} "
              f"pr={r.get('pr') or '-'} {r['title'][:70]}")
    print(f"\nopen pipeline: {len(active)} · done: "
          f"{sum(1 for r in state['issues'].values() if r.get('stage') == 'done')}")


def cmd_roles(_args) -> None:
    ok(roles=ROLES, slots={str(k): v for k, v in SLOTS.items()})


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="StudiQ issue-fixing pipeline")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("sync").set_defaults(fn=cmd_sync)
    m = sub.add_parser("map"); m.add_argument("--json", action="store_true"); m.set_defaults(fn=cmd_map)
    sub.add_parser("next").set_defaults(fn=cmd_next)
    for name in ("design", "implement", "qa"):
        s = sub.add_parser(name); s.add_argument("issue", type=int)
        s.add_argument("--env", type=int); s.set_defaults(fn={"design": cmd_design,
                       "implement": cmd_implement, "qa": cmd_qa}[name])
    s = sub.add_parser("review"); s.add_argument("issue", type=int)
    s.add_argument("--envs", help="two comma-separated QA/review slots, e.g. 7,8")
    s.set_defaults(fn=cmd_review)
    s = sub.add_parser("rebase"); s.add_argument("issue", type=int)
    s.add_argument("--env", type=int); s.set_defaults(fn=cmd_implement)
    s = sub.add_parser("collect"); s.add_argument("issue", type=int); s.set_defaults(fn=cmd_collect)
    s = sub.add_parser("merge"); s.add_argument("issue", type=int); s.set_defaults(fn=cmd_merge)
    s = sub.add_parser("migration-ts"); s.add_argument("issue", type=int)
    s.add_argument("--count", type=int, default=1); s.set_defaults(fn=cmd_migration_ts)
    s = sub.add_parser("migration-check"); s.add_argument("issue", type=int)
    s.add_argument("--pr", type=int); s.set_defaults(fn=cmd_migration_check)
    s = sub.add_parser("migration-release"); s.add_argument("issue", type=int)
    s.set_defaults(fn=cmd_migration_release)
    s = sub.add_parser("block"); s.add_argument("issue", type=int); s.add_argument("--reason", required=True); s.set_defaults(fn=cmd_block)
    sub.add_parser("status").set_defaults(fn=cmd_status)
    sub.add_parser("roles").set_defaults(fn=cmd_roles)
    return p


if __name__ == "__main__":
    args = build_parser().parse_args()
    FIX.mkdir(parents=True, exist_ok=True)
    ISSUES.mkdir(parents=True, exist_ok=True)
    try:
        args.fn(args)
    except RuntimeError as exc:
        fail(str(exc))
