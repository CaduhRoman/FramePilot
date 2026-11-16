"""Render plan.json -> final 1080x1920 MP4 (picture from 4K originals, VO from original takes, burned captions/callouts).
Run from the workdir:  ./venv/bin/python <skill>/scripts/render.py [plan.json]
Requires clips.json (prep.py) and edl.json (build_vo.py). Refuses to render if validate_plan.py fails.
Also writes qa/final_sheet.jpg (1 frame/sec) and qa/cuts.jpg (a frame either side of every cut)."""
import json, subprocess, os, sys, re
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
PLAN = sys.argv[1] if len(sys.argv) > 1 else "plan.json"
if subprocess.run([sys.executable, f"{HERE}/validate_plan.py", PLAN]).returncode:
    sys.exit("Fix plan.json before rendering.")

plan, edl, clips = json.load(open(PLAN)), json.load(open("edl.json")), json.load(open("clips.json"))
FF, W, H, FPS = "./venv/bin/ffmpeg", 1080, 1920, 30
SP, END = edl["speed"], edl["end"]
LB = {l["line"]: l for l in edl["lines"]}
GRADE = plan.get("grade", "eq=contrast=1.04:saturation=1.07")
MIN_SHOT = plan.get("min_shot", 0.30)   # shortest piece of picture allowed on screen
SAFE = dict(x0=65, x1=1015, y0=270, y1=1248)   # Meta 9:16 safe zone at 1080x1920

# ---------- picture ----------
def base_vf(zoom=1.0, speed=1.0, push=False, n=0):
    z = f",crop=iw/{zoom}:ih/{zoom},scale={W}:{H}" if zoom != 1.0 else ""
    pts = f"setpts=PTS/{speed}" if speed != 1.0 else "setpts=PTS-STARTPTS"
    p = (f",scale={int(W*1.5)}:{int(H*1.5)},zoompan=z='1+0.07*on/{max(n,1)}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s={W}x{H}:fps={FPS}"
         if push else "")
    return f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H}{z},{pts},fps={FPS}{p},{GRADE},format=yuv420p"

def aroll_pieces(line, a, b):
    """Map output range [a,b) inside one line to (take, src_in, out_dur), following the VO pause-trims."""
    segs = [s for s in edl["segments"] if s["line"] == line]
    out, last = [], None
    for s in segs:
        t0 = s["T0"]
        if s["src"]:
            t1 = t0 + (s["out"] - s["in"]) / SP; src, sin = s["src"], s["in"]; last = (src, s["out"], t1)
        else:
            t1 = t0 + s["dur"] / SP; src, sin = last[0], last[1]
        lo, hi = max(a, t0), min(b, t1)
        if hi - lo > 1e-3: out.append((src, sin + (lo - t0) * SP, hi - lo))
    lo_first = segs[0]["T0"]
    if a < lo_first - 1e-3:   # first line's lead-in before speech (cut_in=0): run picture before the first word
        src, sin = segs[0]["src"], segs[0]["in"]
        out.insert(0, (src, max(0, sin - (lo_first - a) * SP), lo_first - a))
    got = sum(p[2] for p in out)
    if b - a - got > 1e-3:    # tail after last word
        src, sout, t1 = last; out.append((src, sout + max(0, a - t1) * SP, b - a - got))
    # fold slivers into the neighbouring piece: a few-frame piece (with the alternating punch-in) reads as a glitch
    merged = []
    for p in out:
        if merged and p[2] < MIN_SHOT: s0, i0, d0 = merged[-1]; merged[-1] = (s0, i0, d0 + p[2])
        else: merged.append(p)
    if len(merged) > 1 and merged[0][2] < MIN_SHOT:
        s1, i1, d1 = merged[1]; merged[1] = (s1, i1 - merged[0][2] * SP, d1 + merged[0][2]); merged.pop(0)
    return merged

clock = [0.0]
def frames(d):
    a = clock[0]; clock[0] += d
    return round(clock[0] * FPS) - round(a * FPS)

raw = lambda name: clips[name]["path"]
jobs = []
for i, s in enumerate(plan["shots"]):
    a, b = LB[s["lines"][0]]["cut_in"], LB[s["lines"][-1]]["cut_out"]
    if s["type"] == "aroll":
        k = 0
        for lid in s["lines"]:
            la, lb = LB[lid]["cut_in"], LB[lid]["cut_out"]
            for src, sin, d in aroll_pieces(lid, la, lb):
                z = s.get("zoom", 1.0) * (1.08 if (s.get("jump_zoom", plan.get("jump_zoom", True)) and k % 2) else 1.0)
                jobs.append((f"{i:03d}_{k:02d}", raw(src), sin, d * SP, frames(d), base_vf(z, SP))); k += 1
    elif s["type"] == "broll":
        n = frames(b - a)
        jobs.append((f"{i:03d}_00", raw(s["clip"]), s.get("in", 0), b - a, n, base_vf(s.get("zoom", 1.0), 1.0, s.get("push", False), n)))
    else:  # still
        n = frames(b - a)
        jobs.append((f"{i:03d}_00", raw(s["clip"]), None, b - a, n,
            f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},scale={int(W*1.5)}:{int(H*1.5)},"
            f"zoompan=z='1+0.07*on/{n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s={W}x{H}:fps={FPS},{GRADE},format=yuv420p"))

def run(j):
    name, src, sin, sdur, nf, vf = j
    if sin is None: cmd = [FF, "-loglevel", "error", "-y", "-loop", "1", "-i", src]
    else: cmd = [FF, "-loglevel", "error", "-y", "-hwaccel", "videotoolbox", "-ss", f"{sin:.3f}", "-t", f"{sdur + 0.25:.3f}", "-i", src, "-an"]
    subprocess.run(cmd + ["-vf", vf, "-frames:v", str(nf), "-c:v", "libx264", "-preset", "fast", "-crf", "14", f"parts/{name}.mp4"], check=True)
    return name

os.makedirs("parts", exist_ok=True)
for f in os.listdir("parts"): os.remove(f"parts/{f}")
with ThreadPoolExecutor(6) as ex: names = list(ex.map(run, jobs))
open("parts/list.txt", "w").write("".join(f"file '{n}.mp4'\n" for n in names))
subprocess.run([FF, "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", "parts/list.txt", "-c", "copy", "picture.mp4"], check=True)
print(f"picture: {sum(j[4] for j in jobs)} frames (expected {round(END * FPS)})")

# ---------- audio (from original takes, full quality) ----------
segs = edl["segments"][:-1]
ins, fc, k = [], "", 0
tail = END - edl["total"]
for i, s in enumerate(segs):
    if s["src"]:
        d = s["out"] - s["in"] + (tail * SP if i == len(segs) - 1 else 0)
        ins += ["-ss", f'{s["in"]:.3f}', "-t", f"{d:.3f}", "-i", raw(s["src"])]
    else:
        d = s["dur"]; ins += ["-f", "lavfi", "-t", f"{d:.3f}", "-i", "anullsrc=r=48000:cl=mono"]
    fc += f"[{k}:a]aformat=sample_rates=48000:channel_layouts=mono,afade=t=in:d=0.012,afade=t=out:st={max(0, d - 0.02):.3f}:d=0.02[a{k}];"; k += 1
fc += "".join(f"[a{i}]" for i in range(k)) + (f"concat=n={k}:v=0:a=1,atempo={SP},highpass=f=80,"
      "acompressor=threshold=-20dB:ratio=3:attack=5:release=80:makeup=2,loudnorm=I=-14:TP=-1.5:LRA=7,aresample=48000[o]")
subprocess.run([FF, "-loglevel", "error", "-y", *ins, "-filter_complex", fc, "-map", "[o]", "-ac", "2", "vo_final.wav"], check=True)

# ---------- captions + callouts (ASS) ----------
def bgr(hexc): h = hexc.lstrip("#"); return f"&H{h[4:6]}{h[2:4]}{h[0:2]}&".upper()
ACC = bgr(plan.get("accent", "#FF3355"))
F1, F2 = plan.get("font", "Montserrat Black"), plan.get("font_alt", "Montserrat ExtraBold")
def ts(t): t = max(0, t); return f"{int(t // 3600)}:{int(t % 3600 // 60):02d}:{t % 60:05.2f}"
ass = [f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,{F1},78,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,7,2,2,90,90,720,1
Style: Box,{F2},72,&H00111111,&H00FFFFFF,&H00FFFFFF,&H00FFFFFF,0,0,0,0,100,100,0,0,3,18,0,8,160,160,320,1
Style: Big,{F1},104,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,1,0,1,9,3,8,110,110,330,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"""]
def add(a, b, style, text): ass.append(f"Dialogue: 0,{ts(a)},{ts(b)},{style},,0,0,0,,{text}")

# callout timings first: captions stay hidden while a hook overlay is on screen (standards 3.2)
CALLOUTS = []
for c in plan.get("callouts", []):
    a, b = LB[c["lines"][0]]["cut_in"], LB[c["lines"][-1]]["cut_out"]
    find = lambda word: [w for w in edl["words"] if w["line"] in c["lines"] and re.sub(r"\W", "", w["w"].lower()) == re.sub(r"\W", "", word.lower())]
    if c.get("at_word"):
        hit = find(c["at_word"])
        if hit: a = hit[0]["S"]
        else: print(f"WARN callout '{c['text']}': at_word '{c['at_word']}' not found")
    if c.get("until_word"):
        hit = [w for w in find(c["until_word"]) if w["S"] > a]
        if hit: b = hit[0]["S"]
        else: print(f"WARN callout '{c['text']}': until_word '{c['until_word']}' not found")
    CALLOUTS.append((c, a, b))
HOOK_END = max([b for c, a, b in CALLOUTS if c.get("hook")] or [0])

# caption casing (standards 7.5): "sentence" (default) follows the sentence, not the cut;
# "lower" for all-lowercase organic; "upper" for the old ALL CAPS look.
CASE = plan.get("caption_case", "sentence")
PROTECT = set(plan.get("fix_words", {}).values())
def protected(t):
    core = re.sub(r"^\W+|\W+$", "", t)
    return core in PROTECT or re.match(r"^I('|$)", core) or (len(core) > 1 and any(ch.isupper() for ch in core[1:]))
def recase(words):
    out, prev = [], None
    for w in words:
        t = w["w"]
        if CASE == "upper": t = t.upper()
        elif not protected(t):
            new_sentence = prev is None or re.search(r"[.?!]$", prev["w"])
            if CASE == "lower": t = t.lower()
            elif new_sentence: t = t[:1].upper() + t[1:]
            elif prev["line"] != w["line"]: t = t[:1].lower() + t[1:]   # line joined mid-sentence after a cut
        out.append(dict(w, t=t)); prev = w
    return out

if plan.get("captions", True):
    # captions never appear before their line's picture cut (whisper starts run early), nor under a hook overlay
    words = [dict(w, S=max(w["S"], LB[w["line"]]["cut_in"])) for w in recase(edl["words"])]
    words = [w for w in words if w["S"] >= HOOK_END - 0.02]
    chunks, cur = [], []
    for w in words:
        if w["t"].startswith("-") and cur: cur[-1]["t"] += w["t"]; cur[-1]["E"] = w["E"]; continue
        if cur and (len(cur) == 3 or sum(len(x["t"]) + 1 for x in cur) + len(w["t"]) > 17
                    or re.search(r"[,.?!]$", cur[-1]["t"]) or w["line"] != cur[-1]["line"]):
            chunks.append(cur); cur = []
        cur.append(w)
    chunks.append(cur)
    for ci, ch in enumerate(chunks):
        nxt = chunks[ci + 1][0]["S"] if ci + 1 < len(chunks) else END
        end = nxt if nxt - ch[-1]["E"] < 0.7 else ch[-1]["E"] + 0.3
        for wi, w in enumerate(ch):
            st = w["S"] if wi else max(w["S"], chunks[ci - 1][-1]["E"] if ci else 0)
            en = ch[wi + 1]["S"] if wi + 1 < len(ch) else end
            if en - st < 0.02: continue
            txt = " ".join(f"{{\\c{ACC}}}{x['t']}{{\\c&HFFFFFF&}}" if x is w else x["t"] for x in ch)
            add(st, en, "Cap", ("{\\fscx92\\fscy92\\t(0,80,\\fscx100\\fscy100)}" if wi == 0 else "") + txt)

HOOK_IMG = next(((c, a, b) for c, a, b in CALLOUTS if c.get("style") == "image"), None)
for c, a, b in CALLOUTS:
    if c.get("style") == "image": continue   # drawn from hook.png (ugly-organic style), see below
    tags = "\\fad(90,90)"
    if c.get("pos"): tags += f"\\an8\\pos({c['pos'][0]},{c['pos'][1]})"
    if c.get("color"): tags += f"\\c{bgr(c['color'])}"
    add(a, b, "Big" if c.get("style") == "big" else "Box", "{" + tags + "}" + c["text"].replace("\n", "\\N"))
open("captions.ass", "w").write("\n".join(ass) + "\n")

# ---------- safe-zone check: every caption/callout inside Meta's 9:16 safe zone, or no export ----------
import shutil, glob
from PIL import Image
import numpy as np
shutil.rmtree("qa/ov", ignore_errors=True); os.makedirs("qa/ov")
subprocess.run([FF, "-loglevel", "error", "-y", "-f", "lavfi", "-i", f"color=black:s={W}x{H}:r=5:d={END}", "-vf",
                "subtitles=captions.ass:fontsdir=fonts", "qa/ov/%05d.png"], check=True)
bad = []
for f in sorted(glob.glob("qa/ov/*.png")):
    m = np.asarray(Image.open(f).convert("L")) > 40
    if not m.any(): continue
    ys, xs = np.where(m)
    if xs.min() < SAFE["x0"] or xs.max() > SAFE["x1"] or ys.min() < SAFE["y0"] or ys.max() > SAFE["y1"]:
        bad.append(f"{(int(os.path.basename(f)[:5]) - 1) / 5:.1f}s x{xs.min()}-{xs.max()} y{ys.min()}-{ys.max()}")
shutil.rmtree("qa/ov", ignore_errors=True)
if HOOK_IMG:
    if not os.path.exists("hook.png"): sys.exit("callout style 'image' needs hook.png: run hook_overlay.py first")
    hb = Image.open("hook.png").getbbox()
    if hb and (hb[0] < SAFE["x0"] or hb[2] > SAFE["x1"] or hb[1] < SAFE["y0"] or hb[3] > SAFE["y1"]):
        bad.append(f"hook.png x{hb[0]}-{hb[2]} y{hb[1]}-{hb[3]}")
if bad:
    sys.exit("SAFE ZONE FAIL (text must sit inside x 65-1015, y 270-1248; wrap long callouts onto two lines):\n  " + "\n  ".join(bad[:12]))
print("safe zone: OK")

out = plan.get("output", "edit_v1.mp4")
enc_in = ["-i", "picture.mp4", "-i", "vo_final.wav"]
if HOOK_IMG:
    _, ha, hb_ = HOOK_IMG
    enc_in += ["-i", "hook.png"]
    enc_vf = ["-filter_complex", f"[0:v]subtitles=captions.ass:fontsdir=fonts[v0];[v0][2:v]overlay=0:0:enable='between(t,{ha:.3f},{hb_:.3f})'[v]", "-map", "[v]"]
else:
    enc_vf = ["-vf", "subtitles=captions.ass:fontsdir=fonts", "-map", "0:v"]
subprocess.run([FF, "-loglevel", "error", "-y", *enc_in, *enc_vf,
    "-map", "1:a", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-t", str(END), out], check=True)

# ---------- QA sheets ----------
subprocess.run([FF, "-loglevel", "error", "-y", "-i", out, "-vf",
    "fps=1,scale=180:320,drawtext=fontfile=" + next(f"fonts/{f}" for f in sorted(os.listdir("fonts"))) +
    ":text='%{pts\\:hms}':x=3:y=3:fontsize=14:fontcolor=yellow:box=1:boxcolor=black,tile=10x7", "-frames:v", "1", "qa/final_sheet.jpg"])
cuts = sorted({round(LB[s["lines"][0]]["cut_in"], 3) for s in plan["shots"]} - {0.0})
sel = "+".join(f"eq(n\\,{max(0, round(t * FPS) - 3)})+eq(n\\,{round(t * FPS) + 3})" for t in cuts)
if cuts:
    subprocess.run([FF, "-loglevel", "error", "-y", "-i", out, "-vf", f"select='{sel}',scale=150:266,tile=8x{(2 * len(cuts) + 7) // 8}",
                    "-vsync", "0", "-frames:v", "1", "qa/cuts.jpg"])
# ---------- flash-cut check: no shot on screen for less than MIN_SHOT ----------
pr = subprocess.run([FF, "-loglevel", "error", "-i", "picture.mp4", "-vf", "scale=64:114,format=gray", "-f", "rawvideo", "-"], capture_output=True)
fr = np.frombuffer(pr.stdout, dtype=np.uint8).reshape(-1, 114, 64).astype(np.float32)
cut_t = [(i + 1) / FPS for i in np.where(np.abs(np.diff(fr, axis=0)).mean(axis=(1, 2)) > 18)[0]]
short = [f"{b:.2f}s ({b - a:.2f}s shot)" for a, b in zip([0.0] + cut_t, cut_t) if b - a < MIN_SHOT]
print("flash cuts: none" if not short else "CHECK FLASH CUTS frame by frame (fast motion inside b-roll can also trigger this): " + ", ".join(short))
print(f"done: {out}  ({END:.2f}s, {len(plan['shots'])} shots, cuts at {', '.join(f'{c:.2f}' for c in cuts)})")
