"""Enforce the edit rules on plan.json before anything is rendered.
Run from the workdir:  ./venv/bin/python <skill>/scripts/validate_plan.py [plan.json]
Exit code 1 (and render.py refuses to run) when any rule is broken.

Rules enforced
  R1  Cuts only on line boundaries. Every shot covers one or more WHOLE script lines; the shots, in order,
      cover every line exactly once. There is no way to express a mid-line cut in a valid plan.
  R2  B-roll must be relevant. Every b-roll/still shot needs:
        "illustrates": words copied verbatim from the line(s) it covers that the footage literally depicts
        "shows":       what is actually on screen in that range (from looking at the frames)
      "illustrates" must appear in the covered line text, and must not be a filler word.
  R3  B-roll has enough footage: in + shot duration <= clip duration (needs edl.json from build_vo.py).
  R4  A-roll lines need a take with picture (the VO take must be a video file).
  R5  A hook text overlay (callout with "hook": true) covers the first line.
Full rulebook: ../references/video-editing-standards.md (relative to this script)"""
import json, sys, os, re

plan = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "plan.json"))
clips = json.load(open("clips.json")) if os.path.exists("clips.json") else {}
edl = json.load(open("edl.json")) if os.path.exists("edl.json") else None
errs, warns = [], []
FILLER = {"so", "and", "the", "a", "it", "this", "that", "i", "you", "my", "just", "literally", "honestly", "okay", "then", "is", "of", "to"}

L = {l["id"]: l for l in plan["lines"]}
order = [l["id"] for l in plan["lines"]]
if len(order) != len(set(order)): errs.append("duplicate line ids")

covered = [lid for s in plan["shots"] for lid in s["lines"]]
if covered != order:
    errs.append(f"R1: shots must cover every line once, in order.\n     lines:  {order}\n     shots:  {covered}")

bounds = {l["line"]: (l["cut_in"], l["cut_out"]) for l in edl["lines"]} if edl else {}
used = []
rows = []
for i, s in enumerate(plan["shots"]):
    tag = f"shot {i + 1} ({'+'.join(s['lines'])})"
    text = " ".join(L[x]["text"] for x in s["lines"] if x in L)
    t0 = bounds.get(s["lines"][0], (None,))[0]; t1 = bounds.get(s["lines"][-1], (None, None))[1]
    dur = (t1 - t0) if t0 is not None and t1 is not None else None
    typ = s.get("type")
    if typ in ("broll", "still"):
        ill, shows = (s.get("illustrates") or "").strip(), (s.get("shows") or "").strip()
        if not ill or not shows:
            errs.append(f"R2: {tag} b-roll needs 'illustrates' (verbatim words from the line) and 'shows' (what is on screen)")
        elif ill.lower() not in text.lower():
            errs.append(f"R2: {tag} 'illustrates' text \"{ill}\" is not in the line(s): \"{text}\"")
        elif set(re.findall(r"[a-z']+", ill.lower())) <= FILLER:
            errs.append(f"R2: {tag} 'illustrates' \"{ill}\" is filler, not something footage can depict")
        c = clips.get(s.get("clip"))
        if not c: errs.append(f"{tag}: clip '{s.get('clip')}' not found in clips.json")
        elif typ == "broll":
            if c["kind"] != "video": errs.append(f"{tag}: '{s['clip']}' is not a video (use type 'still')")
            elif dur is not None and s.get("in", 0) + dur > c["duration"] + 0.01:
                errs.append(f"R3: {tag} needs {dur:.2f}s from {s['clip']}@{s.get('in', 0)} but clip is {c['duration']:.2f}s")
            if dur is not None:
                for (cl, a, b, who) in used:
                    if cl == s["clip"] and a < s.get("in", 0) + dur and s.get("in", 0) < b:
                        warns.append(f"{tag} reuses {cl} {a:.1f}-{b:.1f}s already used in {who}")
                used.append((s["clip"], s.get("in", 0), s.get("in", 0) + dur, tag))
        rows.append((tag, t0, t1, f"{typ}:{s.get('clip')}@{s.get('in', 0)}", text, f"illustrates \"{ill}\" | shows: {shows}"))
    elif typ == "aroll":
        for x in s["lines"]:
            c = clips.get(L[x]["take"]) if x in L else None
            if c and c["kind"] != "video": errs.append(f"R4: {tag} line {x} take '{L[x]['take']}' has no picture — use b-roll")
        rows.append((tag, t0, t1, "aroll", text, ""))
    else:
        errs.append(f"{tag}: unknown type '{typ}' (aroll | broll | still)")
    if dur is not None and dur > 4.0 and typ != "aroll":
        warns.append(f"{tag} holds one b-roll shot for {dur:.1f}s (standards: about 4s max) — split across lines, go back to A-roll, or at least 'push': true")

# R5 every video gets a hook text overlay that isn't the captions (standards 3.1)
hooks = [c for c in plan.get("callouts", []) if c.get("hook")]
if not hooks:
    errs.append("R5: no hook overlay - add a callout with \"hook\": true on the first line (the premise, category, tension or POV, not the spoken words)")
elif order and not any(order[0] in c["lines"] for c in hooks):
    errs.append(f"R5: the hook overlay must cover the first line ({order[0]})")

for c in plan.get("callouts", []):
    if c.get("pos") and not (270 <= c["pos"][1] <= 1150 and 65 <= c["pos"][0] <= 1015):
        errs.append(f"SAFE: callout \"{c['text'][:30]}\" pos {c['pos']} is outside Meta's safe zone (top y >= 270, text must end above y 1248)")
    if c.get("style") != "image" and max(len(x) for x in c["text"].split("\n")) > 26:   # image hooks size themselves (hook_overlay.py)
        warns.append(f"callout \"{c['text'][:30]}\" has a line over 26 characters - break it onto two lines so it doesn't span the frame")

for tag, t0, t1, what, text, why in rows:
    tr = f"{t0:6.2f}-{t1:6.2f}" if t0 is not None else "   (run build_vo.py for times)"
    print(f"{tag:22s} {tr}  {what:28s} \"{text}\"\n{'':24s}{why}" if why else f"{tag:22s} {tr}  {what:28s} \"{text}\"")
for w in warns: print("WARN ", w)
for e in errs: print("ERROR", e)
print("PLAN OK" if not errs else f"PLAN INVALID ({len(errs)} error(s))")
sys.exit(1 if errs else 0)
