import React, {useEffect, useRef, useState} from 'react';
import type {API, CommandRecord} from '../shared/types';
import {Button, Icon} from './ui';

/** In-app popup for agent commands that need the user's permission (replaces the native dialog). */
export function ApprovalDialog({api, record, agent, queued}: {api: API; record: CommandRecord; agent: string; queued: number}) {
  const deny = useRef<HTMLButtonElement>(null);
  const [answering, setAnswering] = useState(false);
  const answer = (allow: boolean) => {
    if (answering) return;
    setAnswering(true);
    void api.approveCommand(record.id, allow).catch(() => {}).finally(() => setAnswering(false));
  };
  useEffect(() => {
    setAnswering(false);
    // Deny is the safe default: Enter or Escape right after the popup appears never runs the command.
    deny.current?.focus();
    const key = (event: KeyboardEvent) => {if (event.key === 'Escape') {event.preventDefault(); answer(false);}};
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [record.id]);
  return <div className="overlay approval-overlay">
    <section className="approval-dialog" role="alertdialog" aria-modal="true" aria-labelledby="approval-title" aria-describedby="approval-command">
      <header className="approval-head">
        <span className="approval-icon"><Icon name="warning" size={20} /></span>
        <div>
          <h2 id="approval-title">Permitir este comando?</h2>
          <p>{agent} quer executar um comando que precisa da sua confirmação.</p>
        </div>
      </header>
      <pre id="approval-command" className="approval-command">{record.command.slice(0, 4000)}</pre>
      <dl className="approval-meta">
        <dt>Pasta</dt><dd><code>{record.cwd}</code></dd>
        <dt>Motivo</dt><dd><ul>{record.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></dd>
      </dl>
      <footer className="approval-actions">
        {queued > 1 && <small>Mais {queued - 1} aguardando</small>}
        <Button ref={deny} variant="secondary" disabled={answering} onClick={() => answer(false)}>Negar</Button>
        <Button variant="primary" disabled={answering} onClick={() => answer(true)}>Permitir uma vez</Button>
      </footer>
    </section>
  </div>;
}
