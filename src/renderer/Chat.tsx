import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {API, Asset, ChatMessage, ClaudeOptions, Project, Settings} from '../shared/types';
import {Button, Card, Icon, IconButton, Menu, MenuItem, StatusBadge, MiddleTruncate} from './ui';
import {Markdown, headingOf} from './Markdown';
import {labels} from './Assets';

type Act = (action: () => Promise<unknown>) => Promise<void>;

const SUGGESTIONS = ['Sincronizar legendas com o áudio', 'Ajustar o ritmo dos cortes', 'Adicionar música de fundo', 'Criar uma abertura com título'];
const MODEL_HINTS: Record<string, string> = {
  '': 'Usa o modelo padrão da sua conta.',
  opus: 'Mais capaz; ideal para edições complexas.',
  sonnet: 'Equilíbrio entre qualidade e velocidade.',
  haiku: 'Mais rápido; bom para ajustes simples.'
};
const EFFORTS: Record<string, [string, string]> = {
  '': ['Padrão', 'Deixa a IA decidir quanto analisar.'],
  low: ['Baixo', 'Respostas rápidas, com pouca análise.'],
  medium: ['Médio', 'Equilíbrio entre tempo e cuidado.'],
  high: ['Alto', 'Analisa mais antes de editar.'],
  xhigh: ['Muito alto', 'Análise extra para pedidos difíceis.'],
  max: ['Máximo', 'Cuidado máximo; é o mais lento.']
};
const time = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'});
const LONG = 600;

function Expandable({text}: {text: string}) {
  const [open, setOpen] = useState(false);
  const long = text.length > LONG || text.split('\n').length > 12;
  return <>
    <div className={`card-body ${long && !open ? 'collapsed' : ''}`}><Markdown text={text} /></div>
    {long && <Button variant="ghost" className="more" aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? 'Ver menos' : 'Ver detalhes'}</Button>}
  </>;
}

function Request({message}: {message: ChatMessage}) {
  const context = message.context;
  return <Card className="card-request">
    <header className="card-head"><span className="card-kind">Pedido</span><time dateTime={message.at}>{time(message.at)}</time></header>
    <p className="card-text">{message.text}</p>
    {context && context.assets.length > 0 && <details className={`sent-context ${context.status}`}>
      <summary><StatusBadge tone={context.status === 'shared' ? 'success' : context.status === 'failed' ? 'error' : 'working'}>
        {context.status === 'shared' ? 'Referências enviadas' : context.status === 'failed' ? 'Falha no envio · pendentes' : 'Enviando referências'} · {context.assets.length}</StatusBadge></summary>
      <p>Caminhos e metadados enviados à IA. A leitura dos arquivos não é confirmada.</p>
      <ul>{context.assets.map(a => <li key={a.id}><strong><MiddleTruncate text={a.name} /></strong><small>{labels[a.kind]}{a.note ? ` · ${a.note}` : ''}</small></li>)}</ul>
    </details>}
  </Card>;
}

function Result({message}: {message: ChatMessage}) {
  const failed = message.text.trimEnd().endsWith('[Resposta incompleta]');
  const text = failed ? message.text.trimEnd().replace(/\[Resposta incompleta\]$/, '').trimEnd() : message.text;
  const title = headingOf(text);
  const body = title ? text.replace(/^\s*#{1,6}\s+.+$/m, '').trim() : text;
  return <Card className={`card-result ${failed ? 'is-error' : ''}`}>
    <header className="card-head"><strong className="card-title">{title ?? (failed ? 'Edição interrompida' : 'Edição concluída')}</strong>
      <StatusBadge tone={failed ? 'error' : 'success'}>{failed ? 'Erro' : 'Concluído'}</StatusBadge><time dateTime={message.at}>{time(message.at)}</time></header>
    <Expandable text={body || 'Concluído.'} />
  </Card>;
}

function Notice({message, onDiagnostics}: {message: ChatMessage; onDiagnostics: () => void}) {
  if (message.text.startsWith('Nova sessão')) return <div className="divider" role="note"><span>Nova conversa · a IA recebe o briefing de novo no próximo pedido</span></div>;
  return <Card className="card-result is-error" role="alert">
    <header className="card-head"><strong className="card-title">Não foi possível concluir</strong><StatusBadge tone="error">Erro</StatusBadge><time dateTime={message.at}>{time(message.at)}</time></header>
    <Expandable text={message.text} />
    <div className="row"><Button variant="ghost" icon="pulse" onClick={onDiagnostics}>Ver detalhes no Diagnóstico</Button></div>
  </Card>;
}

function OptionsMenu({settings, choices, busy, act, api}: {settings: Settings; choices?: ClaudeOptions; busy: boolean; act: Act; api: API}) {
  const models = choices?.models ?? [{value: settings.model, label: 'Carregando…'}];
  const efforts = choices?.efforts ?? [settings.effort];
  const disabled = busy || !choices;
  const set = (model: string, effort: string) => void act(() => api.claudePreference(model, effort));
  return <Menu placement="above" align="start" className="options-popover" trigger={props => <Button {...props} variant="ghost" icon="sliders" aria-label="Opções da IA: modelo e esforço" title="Modelo e esforço">Opções</Button>}>
    {() => <div role="dialog" aria-label="Opções da IA">
      <fieldset className="option-group" disabled={disabled}><legend>Modelo</legend>
        {!models.some(m => m.value === settings.model) && <Radio checked label={`${settings.model} (indisponível)`} hint="Salvo anteriormente; não anunciado pelo CLI." onSelect={() => {}} />}
        {models.map(m => <Radio key={m.value} checked={m.value === settings.model} label={m.label} hint={MODEL_HINTS[m.value] ?? 'Modelo anunciado pela instalação local.'} onSelect={() => set(m.value, settings.effort)} />)}
      </fieldset>
      <fieldset className="option-group" disabled={disabled}><legend>Esforço</legend>
        {efforts.map(e => <Radio key={e} checked={e === settings.effort} label={EFFORTS[e]?.[0] ?? e} hint={EFFORTS[e]?.[1] ?? ''} onSelect={() => set(settings.model, e)} />)}
      </fieldset>
      <p className="help">Seus arquivos são enviados como caminhos locais, sem anexar vídeos completos.{choices?.notice ? ` ${choices.notice}` : ''}</p>
    </div>}
  </Menu>;
}

function Radio({checked, label, hint, onSelect}: {checked: boolean; label: string; hint: string; onSelect: () => void}) {
  return <label className={`radio ${checked ? 'checked' : ''}`}><input type="radio" checked={checked} onChange={onSelect} />
    <span><span className="menu-label">{label}</span>{hint && <small>{hint}</small>}</span></label>;
}

export function ChatPanel({project, settings, choices, stream, claudeBusy, busy, sending, api, act, onSend, promptRef, error, onRetry, onDismissError, onDiagnostics}: {
  project: Project; settings: Settings; choices?: ClaudeOptions; stream: string; claudeBusy: boolean; busy: boolean; sending: boolean;
  api: API; act: Act; onSend: (text: string) => void; promptRef: React.RefObject<HTMLTextAreaElement | null>;
  error: string; onRetry?: () => void; onDismissError: () => void; onDiagnostics: () => void;
}) {
  const [request, setRequest] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [behind, setBehind] = useState(false);
  const pending: Asset[] = project.assets.filter(a => project.pendingAssetIds?.includes(a.id));
  const working = claudeBusy || sending;
  const empty = project.messages.length === 0 && !working;

  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    if (pinned.current) el.scrollTop = el.scrollHeight; else setBehind(true);
  }, [project.messages.length, stream, working, error]);
  useLayoutEffect(() => {
    const el = promptRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, 240)}px`;
  }, [request]);
  useEffect(() => {pinned.current = true; setBehind(false);}, [project.id]);

  const reason = busy ? 'Aguarde a operação atual terminar' : !request.trim() ? 'Escreva um pedido para enviar' : '';
  function submit() {
    if (reason) return;
    onSend(request);
    setRequest('');
    pinned.current = true;
    setBehind(false);
  }
  function fill(text: string) {
    setRequest(text);
    requestAnimationFrame(() => {promptRef.current?.focus(); promptRef.current?.setSelectionRange(text.length, text.length);});
  }

  return <section className="chat" aria-label="Conversa com a IA">
    <header className="panel-toolbar">
      <h2>Chat de edição</h2>
      <Menu trigger={props => <IconButton {...props} label="Mais opções da conversa" icon="more" />}>
        {close => <div role="menu" aria-label="Opções da conversa">
          <MenuItem role="menuitem" icon="chat" disabled={busy} hint="O histórico continua visível" onClick={() => {close(); void act(api.resetSession);}}>Nova conversa</MenuItem>
          {Boolean(project.essentialAssetIds?.length) && <MenuItem role="menuitem" icon="resend" disabled={busy} hint="Coloca os favoritos na fila do próximo pedido" onClick={() => {close(); void act(async () => {
            for (const id of project.essentialAssetIds ?? []) await api.queueAsset(id, true);
          });}}>Reenviar favoritos</MenuItem>}
        </div>}
      </Menu>
    </header>

    <div className="messages" ref={list} onScroll={e => {
      const el = e.currentTarget;
      pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      if (pinned.current) setBehind(false);
    }}>
      {empty && <div className="chat-empty">
        <span className="chat-mark large"><Icon name="spark" size={24} /></span>
        <h2>O que vamos editar?</h2>
        <p>Descreva o vídeo ou o ajuste que você quer. A IA edita o projeto e o preview atualiza.</p>
        <div className="suggestions" role="list" aria-label="Sugestões de pedido">{SUGGESTIONS.map(s => <button role="listitem" type="button" key={s} className="suggestion" onClick={() => fill(s)}>{s}</button>)}</div>
      </div>}
      <ol className="chat-timeline" aria-live="polite" aria-relevant="additions">
        {project.messages.map(m => <li key={m.id}>{m.role === 'user' ? <Request message={m} /> : m.role === 'assistant' ? <Result message={m} /> : <Notice message={m} onDiagnostics={onDiagnostics} />}</li>)}
        {working && <li><Card className="card-result is-working" aria-busy="true">
          <header className="card-head"><strong className="card-title">Editando o vídeo</strong><StatusBadge tone="working">Trabalhando</StatusBadge></header>
          {stream ? <div className="card-body stream"><Markdown text={stream} /></div> : <p className="card-text muted">Analisando o projeto e preparando as mudanças…</p>}
        </Card></li>}
        {error && <li><Card className="card-result is-error" role="alert">
          <header className="card-head"><strong className="card-title">Algo deu errado</strong><StatusBadge tone="error">Erro</StatusBadge></header>
          <p className="card-text">{error}</p>
          <div className="row">{onRetry && <Button icon="restart" onClick={onRetry}>Tentar novamente</Button>}
            <Button variant="ghost" icon="pulse" onClick={onDiagnostics}>Ver detalhes no Diagnóstico</Button>
            <Button variant="ghost" onClick={onDismissError}>Fechar</Button></div>
        </Card></li>}
      </ol>
      {behind && <Button className="jump" icon="down" onClick={() => {const el = list.current!; el.scrollTop = el.scrollHeight; pinned.current = true; setBehind(false);}}>Novas mensagens</Button>}
    </div>

    {working && <div className="activity" role="status"><span className="spinner" aria-hidden="true" /><span>{settings.engine === 'opencode' ? 'OpenCode' : 'Claude'} está editando…</span>
      <Button variant="danger" icon="stop" onClick={() => void act(api.stop)}>Interromper</Button></div>}

    <form className="composer" onSubmit={e => {e.preventDefault(); submit();}}>
      {pending.length > 0 && <div className="pending-context" aria-label="Arquivos que entram no próximo pedido">
        {pending.map(a => <span className="chip" key={a.id} title={`${labels[a.kind]} · ${a.path}${a.note ? `\n${a.note}` : ''}`}>
          <MiddleTruncate text={a.name} />
          <IconButton className="chip-remove" label={`Retirar ${a.name} do próximo pedido`} tooltip="Retirar da fila (o arquivo continua no projeto)" icon="close" disabled={busy} onClick={() => void act(() => api.queueAsset(a.id, false))} />
        </span>)}
      </div>}
      <textarea ref={promptRef} aria-label="Pedido para a IA" value={request} rows={3} placeholder="Descreva a edição ou o próximo ajuste… (Enter envia, Shift+Enter quebra linha)"
        onChange={e => setRequest(e.target.value)}
        onKeyDown={e => {if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {e.preventDefault(); submit();}}} />
      <div className="composer-row">
        <OptionsMenu settings={settings} choices={choices} busy={busy} act={act} api={api} />
        <span className="spacer" />
        <Button type="submit" variant="primary" icon="send" aria-disabled={Boolean(reason)} title={reason || 'Enviar pedido (Enter)'}>Enviar</Button>
      </div>
    </form>
  </section>;
}
