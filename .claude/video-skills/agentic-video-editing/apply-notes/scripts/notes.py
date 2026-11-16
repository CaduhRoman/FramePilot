#!/usr/bin/env python3
"""Read and answer review notes from the command line (used by apply-notes and video-qa).

  notes.py list CODE [--hook A] [--all]          open notes (or all) as a table + JSON on --json
  notes.py reply CODE ID "what changed" [--keep-open]   reply on a note; marks it done unless --keep-open
  notes.py add CODE FILE SECONDS "text" [--author QA]  add a note (QA flags use --author QA)
  notes.py next CODE HOOK                        path for the next version of a hook (never overwrites)
  notes.py status                                one line per ad: status, open notes, latest versions

ROOT defaults to ~/Video Edits; override with REVIEW_ROOT.
Writes go to <ROOT>/<CODE>/review-notes.json, the same file the review app reads.
"""
import json, os, sys, time, uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import review_server as rs  # noqa: E402

ROOT = Path(os.environ.get("REVIEW_ROOT", rs.DEFAULT_ROOT)).expanduser().resolve()
rs.ROOT = ROOT
rs.TX_DIR = ROOT / "_review" / "transcripts"


def fmt(t):
    return f"{int(t // 60)}:{t % 60:04.1f}"


def proj(code):
    p = ROOT / code
    if not p.is_dir():
        sys.exit(f"No project folder {p}")
    return p


def cmd_list(code, hook=None, everything=False, as_json=False):
    p = proj(code)
    d = rs.load_notes(p)
    ns = [n for n in d["notes"] if (everything or n["status"] == "open") and (not hook or n["hook"] == hook)]
    ns.sort(key=lambda n: (n["hook"], n["version"], n["t"]))
    if as_json:
        print(json.dumps(ns, indent=2, ensure_ascii=False))
        return
    if not ns:
        print("No open notes.")
        return
    for n in ns:
        print(f"[{n['id']}] {n['hook']} v{n['version']} @ {fmt(n['t'])} ({n['t']:.2f}s) {n['author']} · {n['status']}")
        print(f"    file:  {n['file']}")
        if n.get("words"):
            print(f"    words: \"{n['words']}\"")
        print(f"    note:  {n['text']}")
        if n.get("reply"):
            print(f"    reply: {n['reply']}")


def cmd_reply(code, nid, text, keep_open=False):
    p = proj(code)
    d = rs.load_notes(p)
    for n in d["notes"]:
        if n["id"] == nid:
            n["reply"] = text
            if not keep_open:
                n["status"] = "done"
            n["updated"] = time.strftime("%Y-%m-%dT%H:%M:%S")
            rs.save_notes(p, d)
            print(f"Replied to {nid} ({n['status']}).")
            return
    sys.exit(f"No note {nid} in {code}")


def cmd_add(code, rel, t, text, author="QA"):
    p = proj(code)
    if not (p / rel).exists():
        sys.exit(f"No file {p / rel}")
    hook, version = rs.parse_name(Path(rel).stem)
    d = rs.load_notes(p)
    n = {"id": uuid.uuid4().hex[:8], "file": rel, "hook": hook, "version": version, "t": round(float(t), 2),
         "words": rs.words_at(code, rel, float(t)), "text": text, "author": author, "status": "open",
         "reply": "", "created": time.strftime("%Y-%m-%dT%H:%M:%S")}
    d["notes"].append(n)
    rs.save_notes(p, d)
    print(n["id"])


def cmd_next(code, hook):
    p = proj(code)
    vids = [v for v in rs.scan_videos(p) if v["hook"] == hook]
    nv = max([v["version"] for v in vids] or [0]) + 1
    tag = "Main" if hook == "Main" else f"Hook{hook}"
    print(p / "Exports" / f"{code}_{tag}_v{nv}.mp4")


def cmd_status():
    for p in rs.project_dirs():
        s = rs.project_summary(p)
        hooks = ", ".join(f"{h}:{i['latest'].split('/')[-1]}({i['status']})" for h, i in sorted(s["hooks"].items()))
        print(f"{s['code']:8} {s['status']:9} open={s['open']:<3} {hooks}")


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    c = a[0]
    flags = {x for x in a if x.startswith("--")}
    pos = [x for x in a[1:] if not x.startswith("--")]
    if c == "list":
        hook = a[a.index("--hook") + 1] if "--hook" in a else None
        if hook in pos:
            pos.remove(hook)
        cmd_list(pos[0], hook, "--all" in flags, "--json" in flags)
    elif c == "reply":
        cmd_reply(pos[0], pos[1], pos[2], "--keep-open" in flags)
    elif c == "add":
        author = a[a.index("--author") + 1] if "--author" in a else "QA"
        if author in pos:
            pos.remove(author)
        cmd_add(pos[0], pos[1], pos[2], pos[3], author)
    elif c == "next":
        cmd_next(pos[0], pos[1])
    elif c == "status":
        cmd_status()
    else:
        sys.exit(__doc__)
