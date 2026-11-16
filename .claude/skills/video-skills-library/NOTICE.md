# Notice

`.claude/video-skills/` bundles text files (instructions, references and scripts) from these repositories. Media files (video, audio, images, fonts) and files over 1 MB were not copied. Each source folder keeps its LICENSE file.

| Folder | Source | Commit | License |
| --- | --- | --- | --- |
| claude-video-editing-god-mode | https://github.com/F0rger123/claude-video-editing-god-mode (`.claude/skills`) | a991104 | MIT (see also THIRD_PARTY_NOTICES.md) |
| video-agent-skills | https://github.com/Melvynx/video-agent-skills | f454292 | MIT |
| tiktok-video-skills | https://github.com/iart-ai/tiktok-video-skills | 88e7152 | MIT |
| master-skills | https://github.com/Jakeschincariol/master-skills | b5b43e4 | MIT |
| ai-video-editing-skills | https://github.com/AskEditor/ai-video-editing-skills | e20000b | MIT (see ask-editor/NOTICE.md) |
| agentic-video-editing | https://github.com/real-simple-labs/agentic-video-editing | b3ec5ec | MIT |

`.claude/skills/remotion-best-practices/` comes from https://github.com/remotion-dev/skills (commit 7e541aa, Remotion 4.0.543). That repository ships no license file; it is © Remotion.

Left out on purpose:
- The HyperFrames copies in claude-video-editing-god-mode (`hyperframes`, `hyperframes-cli`, `hyperframes-registry`). The `hyperframes-craft` skill covers them.
- From video-agent-skills: `insta-audit`, `outliers` and `publish`, which install Treg via `curl | sh` and act on social accounts, plus `studio-setup` (installs tools) and `codex-images` (starts Codex jobs).
- From master-skills: `build` (websites and apps, not video).
