# FramePilot

**Edite vídeos conversando com uma IA.** Você junta seus arquivos, descreve o vídeo que quer, e a IA faz os cortes, legendas, títulos, trilha e animações. Você assiste ao resultado na hora, pede ajustes e exporta em MP4.

Tudo roda no seu computador: seus vídeos não são enviados para nenhum servidor do FramePilot.

---

## Instalar

1. Baixe o instalador mais recente em **[Releases](https://github.com/CaduhRoman/FramePilot/releases/latest)** (`FramePilot-Setup-x.y.z.exe`).
2. Execute o instalador.
   > O Windows pode mostrar o aviso **"O Windows protegeu o computador"**. Clique em **Mais informações** e depois em **Executar assim mesmo**.
3. Instale também o **[Node.js](https://nodejs.org)** (versão LTS), se ainda não tiver. O FramePilot usa o Node para montar e exportar seus vídeos.

---

## Conecte sua IA

Na primeira vez que você abre o FramePilot, aparece uma janela para escolher quem vai editar seus vídeos.

| Opção | Para quem |
|---|---|
| **Claude** | Quem assina o Claude Pro, Max ou Team. É a opção com melhor qualidade de edição. |
| **ChatGPT** | Quem assina o ChatGPT Plus ou Pro (Codex). |
| **GitHub Copilot** | Quem tem o Copilot Pro, Pro+ ou Business. |
| **Outro provedor** | Gemini, OpenRouter, chave de API e outros. |
| **Começar grátis** | Quem quer experimentar sem conta e sem cartão (modelo DeepSeek V4.1 Flash). |

Ao escolher uma assinatura, o login abre no navegador, na página oficial do serviço. Você não precisa copiar nenhuma chave.

O modo grátis tem limites de uso e funciona melhor em pedidos simples. Para edições mais elaboradas, uma assinatura dá resultados bem melhores.

Você pode trocar de IA quando quiser em **Configurações → Trocar IA**.

---

## Criando seu primeiro vídeo

### 1. Crie um projeto
Clique em **Novo projeto** e preencha:
- **Nome** do vídeo
- **Briefing**: o que é o vídeo, para quem é, qual a mensagem
- **Formato**: horizontal (YouTube), vertical (Reels/TikTok/Shorts) ou quadrado
- **Duração**, **estilo visual** e observações

O primeiro projeto demora alguns minutos para ficar pronto, porque o app baixa o que precisa da internet.

### 2. Adicione seus arquivos
Arraste para a janela ou clique em **Adicionar arquivos**. Você pode usar:
- **Vídeo principal**: a gravação base do seu vídeo
- **Outros vídeos**, **imagens**, **logos**, **áudios e músicas**, **fontes**
- **Referências e documentos**: roteiros, exemplos de estilo, identidade visual

Para cada arquivo, escreva rapidamente como ele deve ser usado ("logo no final", "música de fundo baixinha"…). Isso ajuda muito a IA.

Nos vídeos, você pode **cortar trechos** antes de enviar: abra o vídeo e marque só as partes que interessam.

### 3. Peça no chat
Descreva o que você quer, como faria com um editor humano:

> *"Corte as pausas, coloque legendas grandes e amarelas sincronizadas com a fala, e termine com o logo animado."*

A IA assiste ao material, lê as falas transcritas e edita o vídeo. O preview atualiza sozinho.

### 4. Ajuste e exporte
Assista no preview, peça mudanças ("deixa a abertura mais rápida", "troca a cor da legenda") e, quando estiver bom, clique em **Renderizar MP4**.

---

## Dicas

- **Seja específico.** "Legendas brancas com contorno, no terço inferior" funciona melhor que "coloca legenda".
- **Marque arquivos importantes com a estrela.** Eles são reapresentados à IA sempre que uma nova conversa começa.
- **Nova sessão** recomeça a conversa sem perder o que já foi editado. É útil quando a IA se perde ou o projeto mudou muito.
- **Interromper** para a IA na hora. O que ela já tinha editado continua salvo.
- **Permissões**: se a IA precisar executar algo sensível (apagar arquivos, mexer fora do projeto), o FramePilot pergunta antes. Na dúvida, clique em **Negar**.

---

## Transcrição e análise visual

Antes de cada pedido, o FramePilot pode:
- **Transcrever as falas** dos seus vídeos, para a IA sincronizar legendas e cortes com o que é dito
- **Extrair quadros** dos vídeos, para a IA "ver" o conteúdo

Na primeira vez, a transcrição baixa cerca de 2,3 GB. Em **Configurações → Salvar e verificar** você pode fazer esse download antes. As duas opções podem ser desligadas em Configurações.

---

## Onde ficam meus projetos?

Na pasta **Vídeos → FramePilot** do seu computador. Cada projeto tem sua própria pasta, com seus arquivos originais e os vídeos exportados (em `renders`). Seus arquivos originais nunca são alterados: o app trabalha com cópias.

---

## Algo deu errado?

- **A IA não responde ou dá erro de login:** vá em **Configurações → Trocar IA** e entre de novo.
- **O preview não aparece:** clique em **Diagnóstico → Reiniciar preview**. Se não resolver, use **Instalar dependências**.
- **Quer ver o que está acontecendo por trás:** o botão **Diagnóstico** mostra os registros, a sessão atual e um terminal.
- **"A sessão não existe mais":** clique em **Nova sessão**. Isso acontece, por exemplo, ao abrir o projeto em outro computador.

---

## Bom saber

- O FramePilot faz uma tarefa por vez: enquanto a IA edita ou o vídeo exporta, aguarde ou clique em **Interromper**.
- Vídeos longos e arquivos pesados deixam a exportação mais demorada e usam mais memória.
- O uso da IA conta no limite da sua própria assinatura (ou no limite do modo grátis).
- Abra apenas projetos de fontes confiáveis: um projeto contém código que roda no seu computador para gerar o vídeo.

<details>
<summary>Para desenvolvedores</summary>

```sh
npm install
npm run dev        # app em modo de desenvolvimento
npm run dist       # gera o instalador
npm run test:smoke # testes
```

</details>
