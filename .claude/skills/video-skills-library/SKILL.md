---
name: video-skills-library
description: Índice da biblioteca de skills de edição de vídeo da comunidade (cortes de silêncio e erros, talking head, Reels/TikTok/Shorts, retenção, legendas animadas, lower thirds, B-roll, zooms, som, roteiro, viralidade, QA, estilos de nicho). Consultar ao planejar ou executar qualquer edição para achar a técnica certa; as skills ficam em .claude/video-skills/.
---

# Biblioteca de skills de vídeo

As skills ficam em `.claude/video-skills/<fonte>/<skill>/SKILL.md` (caminho relativo à raiz do projeto). Leia só as que servem ao pedido atual, e as referências que elas indicarem.

## Regras do FramePilot (prevalecem sobre qualquer skill da biblioteca)

1. O pedido da pessoa e o briefing vêm primeiro; depois `video-craft`; depois a biblioteca.
2. **O projeto é Remotion** (`remotion/src`, composição `Main`). Não crie projetos HyperFrames, Python ou Node paralelos, nem uma pasta `video-agent/`. Quando uma skill descrever HTML/GSAP, `hyperframes`, um "render engine" próprio ou um pipeline ffmpeg que gera o MP4 final, use as **decisões** dela (tempos, cortes, estilo, ritmo, tamanhos) e implemente em Remotion: `Sequence`/`Series`, `interpolate`/`spring`, `Video`/`Audio` de `@remotion/media` com recorte.
3. Não renderize, não inicie servidores nem instale ferramentas: o FramePilot faz preview e export. Ignore passos de setup (`pip install`, `brew`, `npx skills`, `curl | sh`).
4. Comandos reais (ffprobe, ffmpeg para analisar ou extrair trechos, scripts das skills) só pelo terminal do FramePilot, quando ele estiver disponível; a pessoa pode negar. Nunca envie arquivos a serviços externos nem use chaves de API sem a pessoa pedir.
5. A transcrição palavra a palavra e os quadros que o FramePilot fornece substituem os passos de "transcrever" e "extrair frames" das skills.
6. Música, efeitos e imagens só dos assets da pessoa, a menos que ela peça para gerar (ex.: narração com ElevenLabs).

## Onde procurar

| Preciso de | Skill |
| --- | --- |
| Visão geral de uma edição completa de talking head | `claude-video-editing-god-mode/video-editing-god-mode`, `claude-video-editing-god-mode/edit-video` |
| Cortar silêncios / pausas | `claude-video-editing-god-mode/cut-silences` |
| Cortar erros, gaguejos, retakes | `claude-video-editing-god-mode/cut-mistakes`, `claude-video-editing-god-mode/ghost-editor` |
| Reel/Short a partir de talking head | `claude-video-editing-god-mode/short-form-edit`, `claude-video-editing-god-mode/ghost-editor`, `video-agent-skills/short-editing` |
| Retenção, gancho dos 3 primeiros segundos, loops | `claude-video-editing-god-mode/short-form-retention`, `tiktok-video-skills/short-form-video`, `master-skills/virality` |
| Edição de anúncio UGC / VO + B-roll | `agentic-video-editing/ve-video-edit-general` |
| Edição completa com cortes, legendas, B-roll, looks e música | `ai-video-editing-skills/ask-editor`, `master-skills/edit` |
| Legendas animadas / karaokê | `tiktok-video-skills/caption-animation` (Remotion) |
| Lower thirds / nome na tela | `tiktok-video-skills/lower-thirds` (Remotion) |
| Contagem regressiva | `tiktok-video-skills/countdown-video` (Remotion) |
| Zooms de ênfase, Ken Burns | `claude-video-editing-god-mode/add-zooms` |
| Motion graphics sobre talking head longo | `claude-video-editing-god-mode/video-storytelling`, `claude-video-editing-god-mode/hyperframes-video-beats` |
| Filme de motion / lançamento / promo | `claude-video-editing-god-mode/motionmaxxing`, `claude-video-editing-god-mode/business-motion-film`, `claude-video-editing-god-mode/motion-showreel` |
| Sound design | `claude-video-editing-god-mode/real-sfx` |
| Easing e timelines (conceitos de animação) | `claude-video-editing-god-mode/gsap` |
| Colagem estilo Vox | `claude-video-editing-god-mode/collage`, `video-agent-skills/vox` |
| Formatos: ranking/top 10, tier list | `claude-video-editing-god-mode/ranked-list`, `claude-video-editing-god-mode/tier-list` |
| Nichos: imóveis, construção, makeover de negócio | `claude-video-editing-god-mode/real-estate-styles`, `claude-video-editing-god-mode/contractor-styles`, `claude-video-editing-god-mode/business-makeover` |
| Copiar o estilo de um vídeo de referência | `claude-video-editing-god-mode/trend-style-copy`, `video-agent-skills/steal`, `claude-video-editing-god-mode/video-structure-analyzer` |
| Estilos de filme em código (pintura, aquarela…) | `claude-video-editing-god-mode/lemo-opuscar`, `claude-video-editing-god-mode/style-library` |
| B-roll da própria pessoa | `video-agent-skills/broll` |
| Vídeo longo em vários cortes curtos | `video-agent-skills/clips` |
| Roteiro e ganchos | `video-agent-skills/studio-script` |
| Tradução/dublagem | `video-agent-skills/short-translate` (só se a pessoa pedir; tem custo na ElevenLabs) |
| Título, thumbnail e descrição do YouTube | `claude-video-editing-god-mode/youtube-packaging` |
| Revisão antes de entregar | `agentic-video-editing/video-qa`, `agentic-video-editing/apply-notes` |
| Site como assunto do vídeo | `claude-video-editing-god-mode/website-to-hyperframes` (só as ideias) |

Skills Remotion oficiais: `.claude/skills/remotion-best-practices/SKILL.md`. Direção e presets: `.claude/skills/hyperframes-craft/SKILL.md`.

Licenças e origem: [NOTICE.md](NOTICE.md).
