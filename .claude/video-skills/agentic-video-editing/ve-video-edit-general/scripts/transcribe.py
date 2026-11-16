"""Word-timestamped transcripts with mlx-whisper.
Run from the workdir:  PATH=$PWD/venv/bin:$PATH ./venv/bin/python <skill>/scripts/transcribe.py audio/vo_*.wav [--words]
Writes tx/<name>.json and prints segments (and per-word timings with --words)."""
import sys, os, json
import mlx_whisper

MODEL = "mlx-community/whisper-large-v3-turbo"
args = [a for a in sys.argv[1:] if not a.startswith("--")]
words = "--words" in sys.argv
for wav in args:
    name = os.path.splitext(os.path.basename(wav))[0]
    out = f"tx/{name}.json"
    if os.path.exists(out):
        r = json.load(open(out))
    else:
        r = mlx_whisper.transcribe(wav, path_or_hf_repo=MODEL, word_timestamps=True, language="en")
        json.dump(r, open(out, "w"))
    print("==", name)
    for s in r["segments"]:
        if words:
            print("  " + " ".join(f'{w["word"].strip()}[{w["start"]:.2f}-{w["end"]:.2f}]' for w in s["words"]))
        else:
            print(f'  {s["start"]:6.2f}-{s["end"]:6.2f} {s["text"].strip()}')
