#!/bin/bash
# Usage: setup.sh <workdir>   — creates venv (ffmpeg, whisper, PIL), folders and fonts in the workdir.
set -e
W="${1:-.}"; mkdir -p "$W"; cd "$W"
[ -d venv ] || python3 -m venv venv
./venv/bin/pip install -q --upgrade pip
./venv/bin/pip install -q imageio-ffmpeg mlx-whisper pillow numpy
FF=$(./venv/bin/python -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())")
ln -sf "$FF" venv/bin/ffmpeg
mkdir -p raw proxy audio tx sheets qa parts fonts
for d in "$HOME/Library/Fonts" /Library/Fonts; do
  cp "$d"/Montserrat-Black.otf "$d"/Montserrat-ExtraBold.otf fonts/ 2>/dev/null || true
done
[ -n "$(ls fonts)" ] || cp "/System/Library/Fonts/Supplemental/Arial Black.ttf" fonts/
./venv/bin/ffmpeg -version | head -1
echo "fonts: $(ls fonts | tr '\n' ' ')"
