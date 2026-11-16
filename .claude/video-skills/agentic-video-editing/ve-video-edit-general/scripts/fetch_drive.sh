#!/bin/bash
# Usage: fetch_drive.sh <workdir> <list.txt>
# list.txt lines: "<subdir> <drive_file_id> <local_name.ext>"  (subdir e.g. broll / product / script)
# Uses the drive.usercontent endpoint: gdown and drive.google.com/uc hit "too many downloads" quota on big files.
W="$1"; L="$2"; cd "$W" || exit 1
fetch() {
  sub="$1"; id="$2"; name="$3"; mkdir -p "raw/$sub"; out="raw/$sub/$name"
  [ -s "$out" ] && return 0
  for try in 1 2 3; do
    curl -sL --fail -o "$out.part" "https://drive.usercontent.google.com/download?id=$id&export=download&confirm=t" \
      && ! head -c 200 "$out.part" | grep -qi "<html" && mv "$out.part" "$out" && return 0
    sleep 5
  done
  rm -f "$out.part"; echo "FAIL $sub/$name ($id)"
}
export -f fetch
cat "$L" | xargs -P 6 -L 1 bash -c 'fetch "$0" "$1" "$2"'
du -sh raw; find raw -type f | wc -l
