#!/usr/bin/env python3
"""Convert the StudiQ manual test plan (.docx) into an agent-readable corpus.

Usage:
    python3 convert_docx.py <input.docx> <output_dir>

Output layout:
    <output_dir>/context.md        global rules, accounts, seed data, report template
    <output_dir>/index.md          one row per scenario: ID | prio | module | title | prereqs
    <output_dir>/cases/<ID>.md     one file per scenario, verbatim PL + embedded prereq context

No third-party deps. Structure/metadata in English, scenario text verbatim Polish.
"""
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
CASE_ID = re.compile(r"\b[A-Z]{2,5}(?:-[A-Z]+)?-\d+\b")
HEADING = re.compile(r"^\s*(\d+)\.\s*([A-Z]{2,5})\b")


def text_of(el):
    return "".join(t.text or "" for t in el.iter(W + "t"))


def paragraphs(tc):
    return [text_of(p).strip() for p in tc.findall(W + "p")]


def pstyle(p):
    pPr = p.find(W + "pPr")
    if pPr is None:
        return None
    s = pPr.find(W + "pStyle")
    return s.get(W + "val") if s is not None else None


def walk(el):
    """Yield (kind, element) in document order; tables/paragraphs are units."""
    for child in el:
        tag = child.tag
        if tag == W + "p":
            yield ("p", child)
        elif tag == W + "tbl":
            yield ("tbl", child)
        else:
            yield from walk(child)


def table_rows(tbl):
    rows = []
    for tr in tbl.findall(W + "tr"):
        rows.append([paragraphs(tc) for tc in tr.findall(W + "tc")])
    return rows


def cell_lines(cell):
    """Flatten a cell's paragraphs to non-empty stripped lines."""
    return [ln for ln in (ln.strip() for ln in cell) if ln]


def row_text(row):
    """Join every cell (and its paragraphs) of a table row into one line."""
    return " ".join(" ".join(cell_lines(c)) for c in row)


def render_table(rows):
    if not rows:
        return ""
    width = max(len(r) for r in rows)
    norm = [r + [""] * (width - len(r)) for r in rows]
    flat = [[" ".join(c).replace("|", "\\|") for c in r] for r in norm]
    out = ["| " + " | ".join(flat[0]) + " |", "|" + "---|" * width]
    out += ["| " + " | ".join(r) + " |" for r in flat[1:]]
    return "\n".join(out)


def main():
    if len(sys.argv) < 3:
        print("usage: convert_docx.py <input.docx> <output_dir> [source_label]")
        sys.exit(2)
    src, outdir = sys.argv[1], sys.argv[2]
    source_label = (sys.argv[3] if len(sys.argv) > 3
                    else os.path.splitext(os.path.basename(src))[0].replace("_", " "))
    root = ET.fromstring(zipfile.ZipFile(src).read("word/document.xml"))
    body = root.find(W + "body")

    blocks = []          # (kind, payload) in order
    h1 = h2 = ""
    case_tables = []     # (module, section, rows)

    for kind, el in walk(body):
        if kind == "p":
            st = pstyle(el) or ""
            txt = text_of(el).strip()
            if not txt:
                continue
            lvl = 0
            if st.lower().startswith("heading"):
                digits = re.sub(r"\D", "", st) or "1"
                lvl = int(digits)
            if lvl == 1:
                h1, h2 = txt, ""
            elif lvl == 2:
                h2 = txt
            blocks.append(("h%d" % lvl if lvl else "p", txt))
        else:
            rows = table_rows(el)
            header = row_text(rows[0]) if rows else ""
            blocks.append(("tbl", rows))
            if "Scenariusz i kroki" in header:
                case_tables.append((h1, h2, rows))

    # ---- pass 1: collect every known case id -------------------------------
    known = set()
    for _m, _s, rows in case_tables:
        for r in rows[1:]:
            if not r:
                continue
            m = CASE_ID.search(" ".join(cell_lines(r[0])))
            if m:
                known.add(m.group(0))

    # ---- pass 2: build cases ----------------------------------------------
    cases = []  # dicts
    order = 0
    for module, section, rows in case_tables:
        for r in rows[1:]:
            if not r or not " ".join(cell_lines(r[0])):
                continue
            idcell = cell_lines(r[0]) if len(r) > 0 else []
            if not idcell:
                continue
            m = CASE_ID.search(idcell[0])
            if not m:
                continue
            cid = m.group(0)
            priority = idcell[1] if len(idcell) > 1 else ""
            scen = cell_lines(r[1]) if len(r) > 1 else []
            expected = cell_lines(r[2]) if len(r) > 2 else []
            notes = cell_lines(r[4]) if len(r) > 4 else []

            title = scen[0] if scen else ""
            prereq_text, steps = "", []
            for line in scen[1:]:
                if line.lower().startswith("warunek wst"):
                    prereq_text = re.sub(r"^warunek wst[^:]*:\s*", "", line, flags=re.I)
                else:
                    steps.append(line)
            prereqs = [x for x in CASE_ID.findall(prereq_text) if x in known]
            order += 1
            cases.append({
                "id": cid, "priority": priority, "module": module,
                "section": section, "title": title, "prereq_text": prereq_text,
                "prereqs": prereqs, "steps": steps, "expected": expected,
                "notes": notes, "order": order,
            })

    by_id = {c["id"]: c for c in cases}
    os.makedirs(os.path.join(outdir, "cases"), exist_ok=True)
    # Drop generated cases first so renamed/removed scenarios don't leave orphans.
    cases_dir = os.path.join(outdir, "cases")
    for name in os.listdir(cases_dir):
        if name.endswith(".md"):
            os.remove(os.path.join(cases_dir, name))

    # ---- context.md (everything before the first numbered module + report) --
    ctx_lines = []
    for kind, payload in blocks:
        if kind == "h1" and HEADING.match(payload):
            num = HEADING.match(payload).group(1)
            if int(num) >= 5:
                break
        if kind == "tbl":
            ctx_lines.append(render_table(payload))
        elif kind.startswith("h"):
            ctx_lines.append(("#" * int(kind[1])) + " " + payload)
        else:
            ctx_lines.append(payload)
        ctx_lines.append("")
    # report template section
    cap = False
    for kind, payload in blocks:
        if kind == "h1":
            cap = "szablon zg" in payload.lower()
        elif cap:
            ctx_lines.append(render_table(payload) if kind == "tbl" else payload)
            ctx_lines.append("")
    with open(os.path.join(outdir, "context.md"), "w", encoding="utf-8") as f:
        f.write("# Global context — StudiQ manual test plan\n\n")
        f.write("_Verbatim extract of sections 1-4 and the defect-template section "
                "of the source document (Polish). Read this once per session._\n\n")
        f.write("\n".join(ctx_lines).rstrip() + "\n")

    # ---- index.md ----------------------------------------------------------
    modules = []
    for c in cases:
        if c["module"] not in modules:
            modules.append(c["module"])
    idx = ["# Scenario index — %d cases" % len(cases), "",
           "Prerequisite ids are greppable: `grep -n \"EDU-DECK-03\" index.md`.",
           "Full steps live in `cases/<ID>.md` (Polish, verbatim). Read the case **and** every id in its Prereqs column.", "",
           "| ID | Prio | Title | Prereqs | Module |", "|---|---|---|---|---|"]
    for c in cases:
        idx.append("| %s | %s | %s | %s | %s |" % (
            c["id"], c["priority"], c["title"].replace("|", "\\|"),
            ", ".join(c["prereqs"]) or "—",
            re.sub(r"^\d+\.\s*", "", c["module"])))
    idx += ["", "## Modules", ""]
    for m in modules:
        n = sum(1 for c in cases if c["module"] == m)
        idx.append("- %s — %d cases" % (re.sub(r"^\d+\.\s*", "", m) or "(none)", n))
    with open(os.path.join(outdir, "index.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(idx).rstrip() + "\n")

    # ---- cases/<ID>.md -----------------------------------------------------
    for c in cases:
        L = ["# %s — %s" % (c["id"], c["title"]), ""]
        L.append("- id: %s" % c["id"])
        L.append("- priority: %s" % c["priority"])
        L.append("- module: %s" % re.sub(r"^\d+\.\s*", "", c["module"]))
        L.append("- section: %s" % c["section"])
        L.append("- prereqs: %s" % (", ".join(c["prereqs"]) or "none"))
        L.append("- source: %s" % source_label)
        L.append("")
        L.append("## Prerequisite (verbatim)")
        L.append("")
        L.append(c["prereq_text"] or "Brak warunku wstępnego.")
        L.append("")
        if c["prereqs"]:
            L.append("## Prerequisite context")
            L.append("")
            for pid in c["prereqs"]:
                p = by_id[pid]
                L.append("### %s — %s" % (pid, p["title"]))
                if p["prereq_text"]:
                    L.append("_Warunek wstępny: %s_" % p["prereq_text"])
                for i, s in enumerate(p["steps"], 1):
                    L.append("%d. %s" % (i, s))
                L.append("")
                L.append("Expected:")
                for e in p["expected"]:
                    L.append("- %s" % e)
                L.append("")
        L.append("## Steps")
        L.append("")
        if c["steps"]:
            for i, s in enumerate(c["steps"], 1):
                L.append("%d. %s" % (i, s))
        else:
            L.append("_Brak kroków w dokumencie._")
        L.append("")
        L.append("## Expected result")
        L.append("")
        if c["expected"]:
            for e in c["expected"]:
                L.append("- %s" % e)
        else:
            L.append("_Brak oczekiwanego rezultatu w dokumencie._")
        if c["notes"]:
            L += ["", "## Notes", ""] + ["- %s" % n for n in c["notes"]]
        with open(os.path.join(outdir, "cases", c["id"] + ".md"), "w", encoding="utf-8") as f:
            f.write("\n".join(L).rstrip() + "\n")

    print("cases: %d  modules: %d" % (len(cases), len(modules)))
    print("missing prereq ids: %s" % sorted(
        {x for c in cases for x in CASE_ID.findall(c["prereq_text"]) if x not in known}))


if __name__ == "__main__":
    main()
