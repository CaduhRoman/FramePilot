import React, {useEffect, useRef} from 'react';
import type {API, State} from '../shared/types';
import {Button, IconButton, Section} from './ui';
import {TerminalPanel} from './Terminal';

type Act = (action: () => Promise<unknown>) => Promise<void>;

/** Technical details kept off the main screen: session, logs, terminal and preview maintenance. */
export function Diagnostics({state, api, act, busy, error, onClose}: {state: State; api: API; act: Act; busy: boolean; error: string; onClose: () => void}) {
  const panel = useRef<HTMLElement>(null);
  const logs = useRef<HTMLPreElement>(null);
  const p = state.project;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>('button')?.focus();
    const key = (event: KeyboardEvent) => {if (event.key === 'Escape') onClose();};
    document.addEventListener('keydown', key);
    return () => {document.removeEventListener('keydown', key); previous?.focus();};
  }, []);
  useEffect(() => {logs.current?.scrollTo({top: logs.current.scrollHeight});}, [state.logs.length]);
  return <div className="overlay drawer-overlay" onPointerDown={e => {if (e.target === e.currentTarget) onClose();}}>
    <aside ref={panel} className="drawer" role="dialog" aria-modal="true" aria-labelledby="diagnostics-title">
      <header className="drawer-head"><h2 id="diagnostics-title">Diagnóstico</h2><IconButton label="Fechar diagnóstico" icon="close" onClick={onClose} /></header>
      <div className="drawer-body">
        {error && <Section title="Último erro"><pre className="log error-log">{error}</pre></Section>}
        {p && <Section title="Sessão da IA">
          <dl className="meta-list">
            <dt>Sessão</dt><dd><code>{p.session.id ?? 'Será criada no próximo pedido'}</code></dd>
            <dt>Continuidade</dt><dd>{p.session.id ? 'Retomada automaticamente a cada pedido' : 'Nova conversa'}</dd>
            <dt>Pasta</dt><dd><code>{state.root}</code></dd>
          </dl>
        </Section>}
        {p && <Section title="Preview">
          <div className="row"><Button icon="restart" disabled={busy} onClick={() => void act(api.preview)}>Reiniciar preview</Button>
            <Button icon="package" disabled={busy} onClick={() => void act(api.install)}>Instalar dependências</Button></div>
          {state.previewUrl && <p className="help">Servidor do Studio: <code>{state.previewUrl}</code></p>}
        </Section>}
        <Section title="Status e logs" count={state.logs.length}>
          <pre ref={logs} className="log" tabIndex={0} aria-label="Logs">{state.logs.join('\n') || 'Nenhum log ainda.'}</pre>
        </Section>
        {p && state.root && <Section title="Terminal"><TerminalPanel api={api} commands={state.commands} root={state.root} /></Section>}
      </div>
    </aside>
  </div>;
}
