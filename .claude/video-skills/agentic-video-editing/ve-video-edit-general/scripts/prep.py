"""Make 540x960 proxies, 16k mono wavs and timestamped contact sheets for everything in raw/.
Run from the workdir:  ./venv/bin/python <skill>/scripts/prep.py
Outputs: proxy/<name>.mp4, audio/<name>.wav, sheets/<name>.jpg, clips.json (durations/resolution)."""
import os, subprocess, json, re
from concurrent.futures import ThreadPoolExecutor

FF = "./venv/bin/ffmpeg"
VID = (".mov", ".mp4", ".m4v")
IMG = (".jpg", ".jpeg", ".png", ".heic")

def probe(path):
    r = subprocess.run([FF, "-hide_banner", "-i", path], capture_output=True, text=True).stderr
    d = re.search(r"Duration: (\d+):(\d+):([\d.]+)", r)
    dur = int(d[1]) * 3600 + int(d[2]) * 60 + float(d[3]) if d else 0
    v = re.search(r"Video: .*?, (\d{3,5})x(\d{3,5})", r)
    rot = "rotation of -90" in r or "rotation of 90" in r
    w, h = (int(v[1]), int(v[2])) if v else (0, 0)
    if rot: w, h = h, w
    return {"duration": round(dur, 3), "w": w, "h": h, "audio": "Audio:" in r}

def work(path):
    name = os.path.splitext(os.path.basename(path))[0]
    info = probe(path); info["path"] = path
    ext = os.path.splitext(path)[1].lower()
    if ext in VID:
        if not os.path.exists(f"proxy/{name}.mp4"):
            subprocess.run([FF, "-nostdin", "-loglevel", "error", "-y", "-hwaccel", "videotoolbox", "-i", path,
                "-vf", "scale=540:960:force_original_aspect_ratio=decrease,pad=540:960:(ow-iw)/2:(oh-ih)/2,fps=30",
                "-c:v", "h264_videotoolbox", "-b:v", "2M", "-c:a", "aac", "-b:a", "128k", f"proxy/{name}.mp4"])
        if info["audio"] and not os.path.exists(f"audio/{name}.wav"):
            subprocess.run([FF, "-nostdin", "-loglevel", "error", "-y", "-i", path, "-vn", "-ac", "1", "-ar", "16000", f"audio/{name}.wav"])
        iv = max(info["duration"] / 12, 0.25)
        subprocess.run([FF, "-nostdin", "-loglevel", "error", "-y", "-i", f"proxy/{name}.mp4", "-vf",
            f"fps=1/{iv},scale=180:320,drawtext=fontfile={FONT}:text='%{{pts\\:hms}}':x=4:y=4:fontsize=16:fontcolor=yellow:box=1:boxcolor=black@0.6,tile=6x2",
            "-frames:v", "1", f"sheets/{name}.jpg"])
        info["kind"] = "video"
    elif ext in IMG:
        subprocess.run([FF, "-nostdin", "-loglevel", "error", "-y", "-i", path, "-vf", "scale=480:-1", "-frames:v", "1", f"sheets/{name}.jpg"])
        info["kind"] = "image"
    else:
        return name, None
    return name, info

FONT = next((f"fonts/{f}" for f in sorted(os.listdir("fonts"))), "")
paths = [os.path.join(dp, f) for dp, _, fs in os.walk("raw") for f in fs if not f.startswith(".")]
with ThreadPoolExecutor(6) as ex:
    res = dict(r for r in ex.map(work, paths) if r[1])
json.dump(res, open("clips.json", "w"), indent=1)
for n, i in sorted(res.items()):
    print(f'{n:28s} {i["kind"]:5s} {i["duration"]:7.2f}s {i["w"]}x{i["h"]}  {i["path"]}')
