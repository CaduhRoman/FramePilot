import React, {useEffect, useRef, useState} from 'react';
import {Terminal as XTerm} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type {API, CommandOutput, CommandRecord} from '../shared/types';

const statusLabels: Record<CommandRecord['status'], string> = {pending: 'aguardando confirmação', running: 'em execução', done: 'concluído',
  failed: 'falhou', stopped: 'interrompido', denied: 'negado'};

/** The user's own interactive shell, running in the project folder. */
function Shell({api}: {api: API}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const term = new XTerm({fontSize: 13, fontFamily: 'Consolas, "Cascadia Mono", Menlo, monospace', cursorBlink: true, scrollback: 5000,
      theme: {background: '#0b0c0f', foreground: '#e6e6e6'}});
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current!);
    fit.fit();
    // Output emitted before the start reply is already part of the returned scrollback.
    let ready = false;
    const off = api.onEvent(event => {if (event.type === 'pty' && ready) term.write(event.data);});
    api.ptyStart(term.cols, term.rows).then(scrollback => {term.write(scrollback); ready = true;}, error => term.write(`\r\nNão foi possível abrir o terminal: ${error.message}\r\n`));
    const input = term.onData(data => void api.ptyWrite(data));
    const observer = new ResizeObserver(() => {
      try {fit.fit(); void api.ptyResize(term.cols, term.rows);} catch {}
    });
    observer.observe(host.current!);
    return () => {observer.disconnect(); input.dispose(); off(); term.dispose();};
  }, [api]);
  return <div className="terminal-shell" ref={host} />;
}

/** Commands the agents ran through run_command, with live output. */
function History({api, commands}: {api: API; commands: CommandRecord[]}) {
  const [selected, setSelected] = useState<string>();
  const [output, setOutput] = useState<CommandOutput>({stdout: '', stderr: ''});
  const view = useRef<HTMLPreElement>(null);
  const current = commands.find(c => c.id === selected) ?? commands.at(-1);
  useEffect(() => {
    if (!current) return;
    let live = true;
    let loaded = false;
    const off = api.onEvent(event => {
      if (event.type !== 'command-output' || event.id !== current.id) return;
      if (loaded) setOutput(o => ({...o, [event.stream]: o[event.stream] + event.text}));
    });
    api.commandOutput(current.id).then(value => {
      if (!live) return;
      // Chunks that arrived during the fetch may already be in the snapshot; the snapshot wins.
      loaded = true;
      setOutput(value);
    }, () => {});
    return () => {live = false; off();};
  }, [api, current?.id]);
  useEffect(() => {view.current?.scrollTo({top: view.current.scrollHeight});}, [output]);
  if (!commands.length) return <p className="hint">Nenhum comando executado pelos agentes neste projeto ainda.</p>;
  return <div className="terminal-history">
    <ul>{[...commands].reverse().map(c => <li key={c.id}><button className={c.id === current?.id ? 'selected' : ''} onClick={() => setSelected(c.id)} title={c.command}>
      <code>{c.command}</code>
      <small className={`command-status ${c.status}`}>{statusLabels[c.status]}{c.exitCode !== null ? ` · exit ${c.exitCode}` : ''} · {new Date(c.startedAt).toLocaleTimeString('pt-BR')}</small>
    </button></li>)}</ul>
    {current && <div className="terminal-output">
      <div className="toolbar"><small className="path">{current.cwd}</small>
        {current.status === 'running' && <button className="danger" onClick={() => void api.stopCommand(current.id)}>Interromper</button>}
        <button onClick={() => void api.clearCommands()}>Limpar histórico</button></div>
      {current.reasons.length > 0 && <small>Exigiu confirmação: {current.reasons.join('; ')}</small>}
      <pre ref={view}>{output.stdout}{output.stderr && <span className="stderr">{output.stderr}</span>}{!output.stdout && !output.stderr && '(sem saída)'}</pre>
    </div>}
  </div>;
}

export function TerminalPanel({api, commands, root}: {api: API; commands: CommandRecord[]; root: string}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'shell' | 'agent'>('shell');
  const [generation, setGeneration] = useState(0);
  const running = commands.filter(c => c.status === 'running' || c.status === 'pending').length;
  return <details className="logs terminal" open={open} onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}>
    <summary>Mostrar terminal{running ? ` · ${running} comando(s) do agente ativo(s)` : ''}</summary>
    {open && <>
      <div className="toolbar">
        <button className="btn btn-ghost" aria-pressed={tab === 'shell'} onClick={() => setTab('shell')}>Seu terminal</button>
        <button className="btn btn-ghost" aria-pressed={tab === 'agent'} onClick={() => setTab('agent')}>Comandos dos agentes ({commands.length})</button>
        {tab === 'shell' && <button onClick={() => void api.ptyRestart().then(() => setGeneration(g => g + 1))}>Reiniciar</button>}
      </div>
      {tab === 'shell' ? <Shell key={`${root}:${generation}`} api={api} /> : <History api={api} commands={commands} />}
    </>}
  </details>;
}
