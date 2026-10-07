# FramePilot

MVP desktop local para edição de vídeo com **Electron + React + Claude Code CLI + Remotion**.
Cortes, montagem, trilhas, legendas, títulos e motion são descritos pelo chat e implementados pelo Claude no código do vídeo.

## Iniciar

Requisitos: Node.js 22 LTS com npm; Claude Code instalado e autenticado. Execute `claude` uma vez para concluir o login, se ainda não fez isso.

```sh
npm install
npm run dev
```

Build local: `npm run build` e `npm start`. Instalador para o sistema atual: `npm run dist` (sem assinatura de distribuição).

1. Crie um projeto selecionando uma pasta vazia e preencha o briefing.
2. O app instala o Remotion e inicia seu Studio. Internet é necessária para baixar dependências e, no primeiro render, o navegador de renderização.
3. Adicione vídeos, imagens, logos, áudio, fontes e documentos; informe como devem ser usados.
4. Envie o primeiro pedido no chat. Claude edita `remotion/src`; o Studio recarrega as mudanças.
5. Faça novos pedidos e clique em **Renderizar MP4** para exportar a composição `Main` em H.264.

**Configurações → Ferramentas locais** permite verificar/configurar caminhos de Claude, Node e npm. No Windows, prefira o Claude nativo (`claude.exe`); a instalação do Claude também pode exigir Git for Windows. Não use caminhos/CLI de WSL dentro do app Windows.

A seção **Criação** reúne projeto, assets, preview e chat. **Configurações** reúne as ferramentas locais. O header usa uma cápsula translúcida com transições suaves; alternar seções preserva o preview e o chat. A navegação funciona por teclado e respeita a preferência do sistema por movimento reduzido.

## Persistência e contexto

Cada pasta contém `project.json`, `CONTEXT.md`, `assets/`, `references/`, `remotion/` e `renders/`.
Assets de mídia são copiados para `remotion/public/assets/`, sem modificar os originais importados.
O contexto completo é enviado no primeiro pedido de uma sessão. Alterações de configuração e novos assets relevantes geram apenas deltas no pedido seguinte. A opção de relevância serve para arquivar um material sem anunciá-lo na conversa atual.

O app usa `claude -p --output-format stream-json` e `--resume <session-id>`: **a conversa persiste, o processo é iniciado a cada pedido**. O ID e o chat ficam no projeto; o transcript oficial continua na pasta de dados do Claude. Reabrir o projeto na mesma máquina retoma a sessão. Se o transcript foi removido ou o projeto mudou de máquina, use **Nova sessão**. Interromper mantém edições já realizadas.

## Limites do MVP

- Sem timeline visual própria, transcrição automática, geração de mídia ou garantia de qualidade editorial. A edição depende dos pedidos, assets e capacidades do Claude/Remotion.
- Claude recebe ferramentas de leitura/edição, sem Bash. O app instala dependências e renderiza. Se Claude alterar `package.json`, clique em **Instalar dependências**.
- Uma operação por vez; render em H.264, composição `Main`, concorrência 1 para reduzir memória. Projetos longos e mídia pesada exigem mais RAM/tempo.
- Autenticação inicial do Claude é externa; não requer terminal para os pedidos posteriores. Consumo segue a conta/configuração local do Claude.
- Abra apenas projetos confiáveis: o preview executa código React e instalar dependências executa scripts npm.
- UI do harness isolada do Studio: sem Node no renderer; IPC restrito ao frame principal.

Verificações rápidas: `npm run build` e `npm run test:smoke`. O teste do transporte usa um CLI simulado e não consome Claude.

Validação desta implementação: TypeScript/build do app, testes de persistência/contexto/transporte e TypeScript/bundle do template Remotion passaram. O Studio não pôde iniciar neste ambiente de nuvem (`os.networkInterfaces` bloqueado); preview/hot reload, exportação MP4 e o Claude autenticado ainda precisam de validação no desktop.
