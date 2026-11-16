"""Fine frame strips for choosing exact in-points.
Run from the workdir:  ./venv/bin/python <skill>/scripts/strips.py qa/s1.jpg CLIP:start:end:step [CLIP:start:end:step ...]"""
import subprocess, sys, os
from PIL import Image, ImageDraw, ImageFont

FF = "./venv/bin/ffmpeg"
font_path = next((f"fonts/{f}" for f in sorted(os.listdir("fonts"))), None)
font = ImageFont.truetype(font_path, 14) if font_path else ImageFont.load_default()
os.makedirs("qa/fr", exist_ok=True)

def strip(name, a, b, step):
    ims, t = [], a
    while t <= b + 1e-6:
        p = f"qa/fr/{name}_{t:.2f}.jpg"
        subprocess.run([FF, "-loglevel", "quiet", "-y", "-ss", str(t), "-i", f"proxy/{name}.mp4", "-frames:v", "1", "-vf", "scale=108:192", p])
        if os.path.exists(p):
            im = Image.open(p).convert("RGB"); d = ImageDraw.Draw(im)
            d.rectangle([0, 0, 50, 16], fill=(0, 0, 0)); d.text((2, 0), f"{t:.1f}", fill=(255, 255, 0), font=font)
            ims.append(im)
        t += step
    return ims

rows = []
for spec in sys.argv[2:]:
    n, a, b, s = spec.split(":"); r = strip(n, float(a), float(b), float(s))
    row = Image.new("RGB", (130 + 108 * max(1, len(r)), 192), (30, 30, 30))
    ImageDraw.Draw(row).text((4, 80), n, fill=(255, 255, 255), font=font)
    for i, im in enumerate(r): row.paste(im, (130 + 108 * i, 0))
    rows.append(row)
W = max(r.width for r in rows); out = Image.new("RGB", (W, 192 * len(rows)))
for i, r in enumerate(rows): out.paste(r, (0, 192 * i))
out.save(sys.argv[1]); print(sys.argv[1])
