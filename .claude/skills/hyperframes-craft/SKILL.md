---
name: hyperframes-craft
description: Referências de direção do HyperFrames (história, movimento, look, legendas, overlays, som, revisão, tipos de vídeo) e 13 presets visuais, adaptadas para projetos Remotion do FramePilot. Consultar ao planejar ou executar vídeos de lançamento, explicativos, clipes verticais, dados, música, legendas ou quando o pedido citar um estilo visual.
---

# HyperFrames craft (adaptado para Remotion)

Material de direção extraído do HyperFrames, da HeyGen, sob licença Apache-2.0 (ver [NOTICE.md](NOTICE.md)). **Este projeto é Remotion.** Use estes arquivos como guia de decisões editoriais e visuais. Não crie projeto, HTML de composição nem arquivos HyperFrames.

## Prioridade

1. Pedido da pessoa e briefing do projeto.
2. `video-craft` (SKILL.md e craft.md): prevalece em qualquer conflito.
3. Esta skill.

## Como ler as referências

As referências foram escritas para o HyperFrames. Ao aplicá-las aqui:

- **Ignore os comandos** `npx hyperframes …`, o catálogo/registry, `/media-use`, HeyGen, Framey, o desktop app e os "usage beacons". Não estão disponíveis neste projeto; não tente instalá-los nem executá-los. Use os assets enviados pela pessoa, a transcrição e os quadros extraídos que o FramePilot fornece.
- **Traduza o vocabulário para Remotion:**

| HyperFrames | Remotion |
| --- | --- |
| `data-start` / `data-duration` em segundos | `<Sequence from durationInFrames>` em frames (`segundos * fps`) |
| Timeline GSAP pausada, eases | `useCurrentFrame()` com `interpolate()` (`Easing`) ou `spring()` |
| Sub-composição / cena | Componente de cena dentro de `<Sequence>` ou `<Series>` |
| `<video>` / `<audio>` com volume | `Video` / `Audio` de `@remotion/media` com `volume` e recorte, conforme o contrato do projeto |
| `z-index` e trilhas | Ordem dos elementos e `AbsoluteFill` |
| Determinismo (sem `Math.random`, timers) | Igual: use `random(seed)` do Remotion e só o frame atual |

- Onde a referência mandar rodar `check`/`snapshot`, revise com o julgamento editorial e os quadros disponíveis, conforme o `video-craft`; não renderize só para revisar.
- Onde mandar "mostrar três storylines e esperar a escolha", faça isso só para um vídeo novo e longo quando o briefing não decidir; em ajustes, execute.

## O que ler

| Pedido | Arquivo |
| --- | --- |
| Vídeo novo com narrativa (mais de ~15 s) | [references/story.md](references/story.md), depois [references/spec.md](references/spec.md) |
| Lançamento, promo, feature | [references/types/launch.md](references/types/launch.md) |
| Explicativo, tutorial | [references/types/explainer.md](references/types/explainer.md) |
| Clipe vertical / social | [references/types/vertical.md](references/types/vertical.md) |
| Gráficos, números | [references/types/data.md](references/types/data.md) |
| Videoclipe | [references/types/music.md](references/types/music.md) |
| Personagem, mascote | [references/types/character.md](references/types/character.md) |
| 3D, generativo | [references/types/3d.md](references/types/3d.md) |
| Site, mapa, roteiro, tipografia cinética | [references/film.md](references/film.md) |
| Eases, títulos, cortes, punch-ins, ritmo | [references/motion.md](references/motion.md) |
| Legendas; cards sobre talking head | [references/captions.md](references/captions.md); [references/overlays.md](references/overlays.md) |
| Música, efeitos, mixagem | [references/sound.md](references/sound.md) |
| Estilo de outro filme / look | [references/look.md](references/look.md) |
| Revisão antes de entregar | [references/review.md](references/review.md) |

## Presets visuais

`presets/<nome>/FRAME.md` descreve um sistema visual completo (cores, tipografia, grid, composição) e `caption-skin.html` mostra o estilo de legenda em CSS. Presets: biennale-yellow, blockframe, blue-professional, bold-poster, broadside, capsule, cartesian, cobalt-grid, code-editorial, coral, creative-mode, daisy-days, editorial-forest.

Use um preset quando a pessoa pedir um deles ou quando o briefing não definir estilo e um preset combinar com ele. Identidade visual enviada pela pessoa sempre vence. Reproduza os valores em componentes React/CSS do Remotion; fontes que não estiverem nos assets do projeto devem ser carregadas (por exemplo `@remotion/google-fonts`) ou trocadas por uma equivalente, avisando a pessoa.
