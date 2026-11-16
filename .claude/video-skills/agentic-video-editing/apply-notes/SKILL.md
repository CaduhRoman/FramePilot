---
name: apply-notes
description: Review loop for agentic video edits. Opens the local review app (every edit's versions and hooks, notes pinned to the playhead with the words spoken there, per-hook approval), then applies the reviewer's open notes to an edit, renders the next version and replies on each note with what changed. Use when the user says "apply notes on ACM08", "do my notes", "action the review notes", "open the review page", "review my edits", "v2 from my notes", or asks what notes are open. Works with edits made by /ve-video-edit-general or any project folder in the review app's projects folder.
---

# Apply notes

The reviewer watches cuts in a local web app and leaves notes at exact timestamps. This skill closes the loop: read the notes, change the edit, render the next version, and answer every note so they can see what was done before they rewatch.

`$AN` = this skill's folder (e.g. `~/.claude/skills/apply-notes`). `$SK` = the `ve-video-edit-general` skill beside it. Projects live in `~/Video Edits/<CODE>/` (set `REVIEW_ROOT` to use another folder).

## The review app

- Start: run `python3 $AN/scripts/review_server.py` (port 8765, `--root DIR` for another projects folder), then open http://localhost:8765.
- It scans each project for finished cuts in `Exports/*.mp4` (plus any top-level mp4s). The file name sets the hook and version: `<CODE>_HookA_v2.mp4`, `_VarB_`, `_H-C_`, `<CODE>_A_v1`. A file with no hook letter is "Main".
- New renders appear on their own (the page polls every 4s). A hook's status is "approved" only when its latest version is approved, so a new version goes back to review.
- Notes are stored in `<CODE>/review-notes.json`: `{title, notes:[{id, file, hook, version, t, words, text, author, status, reply}], approvals:{file: timestamp}}`. `words` = what was being said around `t` (from the export's transcript). `status` is open / done / dismissed.
- Transcripts of every export are made in the background with mlx_whisper (large-v3-turbo) and cached in `<ROOT>/_review/transcripts/`.

## The Apply notes button

The review app has an **Apply notes (N)** button per ad. It starts Claude Code headless (`claude -p "/apply-notes <CODE>" …`), so this skill runs with nobody watching. Runs are fully unattended: the run may use Bash, Read, Edit, Write, Glob, Grep and Skill without asking; WebFetch, WebSearch and every MCP connector are disallowed. Progress shows in a strip above the player (last step, elapsed time, Stop); the full stream-json log is in `<ROOT>/_review/apply-logs/`. One run per ad at a time.
- The CLI must be signed in once (run `claude` in a terminal). The server finds the CLI on PATH (or `CLAUDE_BIN`), or the newest copy bundled with the desktop app. It starts the run in the projects folder; if you installed the skills in a project's `.claude/skills` rather than `~/.claude/skills`, set `APPLY_NOTES_CWD` to that project.
- In a headless run, don't ask questions: reply on an unclear note with `--keep-open` and carry on.

## Applying notes

1. **Read the notes.** `python3 $AN/scripts/notes.py list <CODE>` (add `--hook A` to narrow). Each note gives the file, version, timestamp, the words spoken there and the note. A note on an older version still applies to the latest one unless it's been answered.
2. **Find what the timestamp points at.** Notes are in *output* time on that export. Map them to the edit's source: match `words` against the plan's line texts (or the export's transcript in `_review/transcripts/`) to find the script line, shot or callout. Check the frame with ffmpeg if the note is visual ("logo here", "caption covers face").
3. **Change the edit, not the export.** Edit the project's own source of truth and re-render:
   - Projects made with `/ve-video-edit-general`: change `plan.json` (lines, drops, shots, callouts, speed), then run `build_vo.py`, `validate_plan.py`, `render.py` from that skill. Both of its editing rules still apply: cut only on line boundaries, b-roll must show what the line says.
   - Projects built another way (their own build or render script): read that script first, change its cut spec, and re-run it.
   - Follow `$SK/references/video-editing-standards.md` for anything the note leaves open.
   - **Variation A first (standards 11.1).** While A isn't approved, work on A only: render A's next version and nothing else, even if the project already has other hooks. Once A is approved, a note on B, C or D changes that hook only. If such a note touches the shared body, don't change the approved A: reply asking whether A should get the same fix, with `--keep-open`. If every hook was already built before review started, a body fix goes on every hook (rule 11.2).
4. **Render the next version; never overwrite.** Get the path from `python3 $AN/scripts/notes.py next <CODE> <HOOK>` (gives `Exports/<CODE>_Hook<X>_v<N+1>.mp4`).
5. **Run `/video-qa`** on the new version's hooks with `--post` (copy `plan.json` / `captions.ass` beside each export as `<stem>.plan.json` / `<stem>.captions.ass` first, when the project has them). Fix any FAIL before replying; QA notes on the old version stay where they are.
6. **Check the change landed.** Re-transcribe the new export (the app does it within a minute, or run mlx_whisper yourself) and confirm the words around each changed spot. Look at frames either side of any changed cut. Run the safe-zone check if text moved.
7. **Reply on every note.** `python3 $AN/scripts/notes.py reply <CODE> <ID> "<what changed, with the new timestamp>"`. One concrete sentence, e.g. "Cut the 0.3s pause before 'and honestly'; line now starts at 0:07.1 in v2." If you couldn't do it or the note is ambiguous, reply with the question and add `--keep-open`.
8. **Tell the user** in chat: which versions were rendered, how many notes were done vs left open, and anything to check by ear. Point them at the review page rather than attaching files.
9. **Learn.** If a note states a general rule (not just this ad), add it to `$SK/references/video-editing-standards.md` (and log it in its section 12) rather than to a skill; every skill points at that file, so the next edit starts from the corrected default. A note that only applies to this ad stays out of the standards. A brand-name or spelling fix goes in `$SK/references/brand-house-style.md`.

## Build the variations (after A is approved)

Triggered by "build variations on <CODE>", "/apply-notes <CODE> build variations", or the review app's **Build variations** button once A's latest version is approved.

1. Confirm A's latest version is approved (`notes.py status`). If not, stop and say so.
2. Treat the approved A cut as fixed: its body, b-roll, captions, pacing and ending don't change.
3. Take the hooks from `hooks-planned.md` in the project folder, or the brief, or the plan. Default to B, C and D. Each differs from A only in the opening: a different first line or moment (scan the whole take, standards 5.4), a different opening visual (standards 11.1: Meta groups look-alike openings), and its own hook overlay. Where a new hook is longer or shorter than A's, join it to A's body on a line boundary.
4. Render v1 of each into `Exports/<CODE>_Hook<X>_v1.mp4`.
5. Run `/video-qa` on all hooks together (A included, so the cross-variation checks run) with `--post`. Fix FAILs on the new hooks only.
6. Tell the user what each hook does differently, one line each. They review them in the app like A.

## QA flags

`/video-qa` posts into the same notes file with `python3 $AN/scripts/notes.py add <CODE> <file> <seconds> "<issue>" --author QA`. They show with a blue edge and a Dismiss button. Treat QA notes the reviewer hasn't dismissed like their own notes.

## Approval

Approving is per hook, on the latest version. An approved master stays in `Exports/` (`notes.py status` lists what's approved). Delivery elsewhere (Drive, Frame) is not automated yet; ask the user before uploading anything.
