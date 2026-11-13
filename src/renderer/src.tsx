import React, {useCallback, useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {API, Asset, Brief, ClaudeOptions, Settings, State} from '../shared/types';
import {DEFAULT_SETTINGS} from '../shared/types';
import {ConnectDialog} from './Connect';
import {ApprovalDialog} from './Approval';
import './style.css';
import {Select} from './Select';
import {AssetsPanel, NoteEditor} from './Assets';
import {Trimmer} from './Trimmer';
import {PreviewPanel} from './Preview';
import {ChatPanel} from './Chat';
import {Diagnostics} from './Diagnostics';
import {appStatus} from './status';
import {Button, Icon as UIIcon, StatusBadge} from './ui';
const appLogo = new URL('../../favicon.png', import.meta.url).href;
declare global {interface Window {framepilot: API}}
const api = window.framepilot;
const defaults: Brief = {name: '', briefing: '', width: 1920, height: 1080, fps: 30, duration: 30, style: '', notes: ''};

function Icon({name}: {name: 'create' | 'settings' | 'brand'}) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'create' ? <><rect x="3" y="4" width="18" height="16" rx="5" /><path d="m10 9 5 3-5 3Z" /></> : name === 'settings' ? <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" fill="currentColor" stroke="none" /><circle cx="15" cy="17" r="3" fill="currentColor" stroke="none" /></> : <><path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3" /><path d="m10 8 6 4-6 4Z" /></>}
  </svg>;
}

/** Guided first steps, shown in the preview area until the first request. */
function Onboarding({hasAssets, onAdd, onDescribe, onSkip}: {hasAssets: boolean; onAdd: () => void; onDescribe: () => void; onSkip: () => void}) {
  return <div className="onboarding">
    <h2>Vamos montar seu vídeo</h2>
    <ol className="steps">
      <li className={hasAssets ? 'done' : ''}><span className="step-number" aria-hidden="true">{hasAssets ? <UIIcon name="check" /> : 1}</span>
        <div><strong>Adicione seus arquivos</strong><small>Vídeos, áudios, imagens e referências.</small></div>
        <Button variant={hasAssets ? 'ghost' : 'secondary'} icon="upload" onClick={onAdd}>{hasAssets ? 'Adicionar mais' : 'Adicionar arquivos'}</Button></li>
      <li><span className="step-number" aria-hidden="true">2</span>
        <div><strong>Descreva o vídeo que quer</strong><small>Escreva no chat ao lado; a IA faz a edição.</small></div>
        <Button icon="chat" onClick={onDescribe}>Escrever pedido</Button></li>
      <li><span className="step-number" aria-hidden="true">3</span>
        <div><strong>Revise e renderize</strong><small>Assista no preview, peça ajustes e exporte em MP4.</small></div></li>
    </ol>
    <Button variant="ghost" onClick={onSkip}>Ver preview agora</Button>
  </div>;
}

function App() {
  const [state, setState] = useState<State>();
  const [section, setSection] = useState<'create' | 'settings'>('create');
  const [error, setError] = useState('');
  const [modal, setModal] = useState<'new' | 'brief' | null>(null);
  const [brief, setBrief] = useState<Brief>(defaults);
  const [tools, setTools] = useState<Settings>({...DEFAULT_SETTINGS});
  const [connecting, setConnecting] = useState(false);
  const [claudeChoices, setClaudeChoices] = useState<ClaudeOptions>();
  const [stream, setStream] = useState('');
  const [checking, setChecking] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [diagnostics, setDiagnostics] = useState(false);
  const [previewBuilding, setPreviewBuilding] = useState(false);
  const [importFiles, setImportFiles] = useState<string[] | null>(null);
  const [skipOnboarding, setSkipOnboarding] = useState<string | null>(null);
  const retry = useRef<(() => Promise<unknown>) | null>(null);
  const prompt = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const off = api.onEvent(event => {
      if (event.type === 'state') {setState(event.state); if (!event.state.claudeBusy) setStream('');}
      if (event.type === 'log') setState(s => s ? {...s, logs: [...s.logs, event.text].slice(-300)} : s);
      if (event.type === 'delta') setStream(s => s + event.text);
    });
    api.state().then(setState).catch(e => setError(e.message));
    return off;
  }, []);
  useEffect(() => {
    if (state) setTools({...state.settings});
  }, [state?.settings.claudePath, state?.settings.nodePath, state?.settings.npmPath, state?.settings.transcribe, state?.settings.frames, state?.settings.model, state?.settings.effort, state?.settings.opencodePath]);
  useEffect(() => {
    if (!state?.project || section !== 'create') return;
    let alive = true;
    setClaudeChoices(undefined);
    void api.claudeOptions().then(options => {if (alive) setClaudeChoices(options);})
      .catch(error => {if (alive) setClaudeChoices({models: [{value: '', label: 'Padrão'}], efforts: [''], notice: (error as Error).message});});
    return () => {alive = false;};
  }, [Boolean(state?.project), state?.settings.claudePath, state?.settings.engine, state?.settings.opencodePath, section]);
  useEffect(() => {setImportFiles(null);}, [state?.root]);
  // Dropping a file anywhere else must not navigate the window.
  useEffect(() => {
    const stop = (event: DragEvent) => event.preventDefault();
    window.addEventListener('dragover', stop);
    window.addEventListener('drop', stop);
    return () => {window.removeEventListener('dragover', stop); window.removeEventListener('drop', stop);};
  }, []);
  async function act(action: () => Promise<unknown>) {
    setError('');
    retry.current = null;
    try {await action();} catch (e) {
      retry.current = action;
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''));
    }
  }
  const onBuilding = useCallback((building: boolean) => setPreviewBuilding(building), []);
  if (!state) return <main className="loading">{error || 'Carregando FramePilot…'}</main>;
  const p = state.project;
  const busy = Boolean(state.task) || state.claudeBusy || submitting;
  const status = appStatus(state, {error, submitting, previewBuilding});
  const openBrief = (create: boolean) => {setBrief(create ? {...defaults} : {...p!.brief}); setModal(create ? 'new' : 'brief');};
  const pick = () => void act(async () => {const paths = await api.pickFiles(); if (paths.length) setImportFiles(paths);});
  const send = (text: string) => {setStream(''); setSubmitting(true); void act(() => api.send(text)).finally(() => setSubmitting(false));};
  const onboarding = p && p.messages.length === 0 && !submitting && !state.claudeBusy && skipOnboarding !== state.root;
  const engineLabel = state.settings.engine === 'opencode' ? `OpenCode · ${state.settings.opencodeModel}` : 'Claude Code';
  return <div className="app">
    <header className="app-header">
      <div className="brand"><span className="brand-mark"><img src={appLogo} alt="" /></span><div><strong>FramePilot</strong><small>Seu estúdio de vídeo</small></div></div>
      <nav className="glass-nav" role="tablist" aria-label="Seções do aplicativo" onKeyDown={event => {
        const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
        if (!keys.includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 'create' : event.key === 'End' ? 'settings' : section === 'create' ? 'settings' : 'create';
        setSection(next);
        document.getElementById(`tab-${next}`)?.focus();
      }}>
        <span className={`glass-selection ${section === 'settings' ? 'to-settings' : ''}`} aria-hidden="true" />
        {(['create', 'settings'] as const).map(tab => <button key={tab} id={`tab-${tab}`} role="tab" aria-selected={section === tab} aria-controls={`panel-${tab}`} tabIndex={section === tab ? 0 : -1} className={`nav-tab ${section === tab ? 'selected' : ''}`} onClick={() => setSection(tab)}><Icon name={tab} /><span>{tab === 'create' ? 'Criação' : 'Configurações'}</span></button>)}
      </nav>
      <div className="header-status" role="status" aria-live="polite">
        <StatusBadge tone={status.tone} title={status.detail}>{status.label}</StatusBadge>
        {busy && <Button variant="danger" icon="stop" onClick={() => void act(api.stop)}>Interromper</Button>}
        <Button variant="ghost" icon="pulse" onClick={() => setDiagnostics(true)}>Diagnóstico</Button>
      </div>
    </header>
    {error && !(p && section === 'create') && <div className="banner-error" role="alert"><UIIcon name="error" /><span>{error}</span>
      {retry.current && <Button onClick={() => void act(retry.current!)}>Tentar novamente</Button>}<Button variant="ghost" onClick={() => setError('')}>Fechar</Button></div>}
    <div className="page-stack">
    <section id="panel-create" role="tabpanel" aria-labelledby="tab-create" className={`page creation-page ${section === 'create' ? 'is-active' : ''}`} inert={section !== 'create'}>
      <div className="section-heading"><h1>Criação</h1><div className="row">{p && <Button icon="back" disabled={busy} onClick={() => void act(api.close)}>Projetos</Button>}<Button variant="ghost" disabled={busy} onClick={() => void act(() => api.open())}>Abrir outra pasta</Button><Button icon="plus" disabled={busy} onClick={() => openBrief(true)}>Novo projeto</Button></div></div>
    {!p ? state.projects.length ? <main className="library">
      <div className="library-head"><div><h2>Seus projetos</h2><small className="path">{state.library}</small></div><Button variant="ghost" icon="folder" disabled={busy} onClick={() => void act(api.showLibrary)}>Abrir pasta</Button></div>
      <ul className="project-grid">{state.projects.map(s => <li key={s.root}><button className="project-card" disabled={busy} title={s.root} onClick={() => void act(() => api.open(s.root))}>
        <strong>{s.name}</strong>
        <small>{s.width} × {s.height} · {s.duration}s</small>
        <small>{s.messages ? `${s.messages} mensagem(ns)${s.hasSession ? ' · conversa ativa' : ''}` : 'Sem pedidos ainda'}</small>
        <small>Editado {new Date(s.updatedAt).toLocaleString('pt-BR', {dateStyle: 'short', timeStyle: 'short'})}</small>
      </button></li>)}</ul>
    </main> : <main className="welcome"><span className="welcome-symbol"><Icon name="create" /></span><h2>Do material bruto ao vídeo final.</h2><p>Crie um projeto, adicione seus arquivos e descreva a edição no chat.</p>
      <p>É preciso ter Node.js instalado. Os projetos ficam em {state.library}.</p>
      <Button variant="primary" disabled={busy} onClick={() => openBrief(true)}>Criar projeto de vídeo</Button></main> : <main className="workspace">
      <AssetsPanel project={p} root={state.root!} busy={busy} api={api} act={act} onEdit={setEditing} onSettings={() => openBrief(false)}
        importFiles={importFiles} setImportFiles={setImportFiles} onPick={pick} />
      <PreviewPanel state={state} api={api} act={act} busy={busy} status={status} fallbackFps={p.brief.fps} fallbackDuration={p.brief.duration} onBuilding={onBuilding}
        overlay={onboarding ? <Onboarding hasAssets={p.assets.length > 0} onAdd={pick} onDescribe={() => prompt.current?.focus()} onSkip={() => setSkipOnboarding(state.root)} /> : undefined} />
      <ChatPanel project={p} settings={state.settings} choices={claudeChoices} stream={stream} claudeBusy={state.claudeBusy} busy={busy} sending={submitting}
        api={api} act={act} onSend={send} promptRef={prompt} error={error} onRetry={retry.current ? () => void act(retry.current!) : undefined}
        onDismissError={() => setError('')} onDiagnostics={() => setDiagnostics(true)} />
    </main>}
    </section>
    <section id="panel-settings" role="tabpanel" aria-labelledby="tab-settings" className={`page settings-page ${section === 'settings' ? 'is-active' : ''}`} inert={section !== 'settings'}>
      <div className="section-heading"><h1>Configurações</h1><span className="local-badge">No seu computador</span></div>
      <main className="settings-content"><div className="settings-intro"><span className="welcome-symbol"><Icon name="settings" /></span><h2>Seu ambiente de criação.</h2><p>Conecte suas ferramentas locais. O FramePilot cuida do workflow.</p></div>
      <section className="settings-card"><h2>Inteligência artificial</h2>
        <p>Quem faz as edições dos seus vídeos. Troque quando quiser; a conversa de cada projeto recomeça com o briefing ao trocar de provedor.</p>
        <code className="path">{engineLabel}</code>
        <div className="row"><Button icon="spark" disabled={busy} onClick={() => setConnecting(true)}>Trocar IA</Button></div>
      </section>
      <section className="settings-card"><h2>Ferramentas locais</h2>
        <p>Deixe em branco para detectar pelo PATH. Use o caminho do executável, sem argumentos.</p>
        {(['claudePath', 'opencodePath', 'nodePath', 'npmPath'] as const).map(key => <label className="field" key={key}>{key === 'claudePath' ? 'Claude Code (claude.exe / claude)' : key === 'opencodePath' ? 'OpenCode (opencode.exe / opencode)' : key === 'nodePath' ? 'Node.js (node.exe / node)' : 'npm (npm.cmd / npm)'}<input value={tools[key]} onChange={e => setTools({...tools, [key]: e.target.value})} /></label>)}
        <label className="check"><input type="checkbox" checked={tools.transcribe} onChange={e => setTools({...tools, transcribe: e.target.checked})} />Transcrever falas com Whisper antes de cada pedido (GPU NVIDIA quando disponível)</label>
        <label className="check"><input type="checkbox" checked={tools.frames} onChange={e => setTools({...tools, frames: e.target.checked})} />Extrair frames dos vídeos com FFmpeg para a análise visual da IA</label>
        <p>Na primeira vez são baixados o Whisper e o modelo large-v3-turbo (~2,3 GB). "Salvar e verificar" já faz esse download.</p>
        <p>Login ausente ou expirado? Use "Trocar IA" acima para entrar de novo. Depois todas as sessões são controladas aqui.</p>
        {checking && <pre className="log">{checking}</pre>}<div className="row"><Button variant="primary" disabled={busy} onClick={() => void act(async () => {await api.settings(tools); setChecking(await api.check());})}>Salvar e verificar</Button>
          <Button disabled={busy} onClick={() => void act(async () => {await api.settings(tools); setChecking('Configurações salvas.');})}>Salvar</Button></div>
      </section>
      <section className="settings-card"><h2>Pasta de projetos</h2>
        <p>Novos projetos são criados automaticamente aqui e aparecem na tela inicial.</p>
        <code className="path">{state.library}</code>
        <div className="row"><Button icon="folder" onClick={() => void act(api.showLibrary)}>Abrir pasta</Button></div>
      </section></main>
    </section>
    </div>
    {editing && p && (() => {
      const asset = p.assets.find(a => a.id === editing.id);
      if (!asset) return null;
      const save = (patch: Parameters<API['updateAsset']>[1]) => void act(async () => {await api.updateAsset(asset.id, patch); setEditing(null);});
      return asset.kind === 'main' || asset.kind === 'video'
        ? <Trimmer asset={asset} fps={p.brief.fps} busy={busy} onSave={async patch => save(patch)} onClose={() => setEditing(null)} />
        : <NoteEditor asset={asset} busy={busy} onSave={save} onClose={() => setEditing(null)} />;
    })()}
    {/* First run (no provider chosen yet) or "Trocar IA" in Configurações: sign-in popup over the app. */}
    {(!state.settings.engine || connecting) && <ConnectDialog api={api} act={act} settings={state.settings} busy={busy}
      onClose={state.settings.engine ? () => setConnecting(false) : undefined} onDone={() => setConnecting(false)} />}
    {diagnostics && <Diagnostics state={state} api={api} act={act} busy={busy} error={error} onClose={() => setDiagnostics(false)} />}
    {modal && <div className="overlay"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="brief-title">
      <h2 id="brief-title">{modal === 'new' ? 'Novo projeto de vídeo' : 'Configurações do projeto'}</h2>
      <form onSubmit={e => {e.preventDefault(); const create = modal === 'new'; void act(async () => {await (create ? api.create(brief) : api.save(brief)); setModal(null);}); setModal(null);}}>
        <label className="field">Nome<input required maxLength={200} value={brief.name} onChange={e => setBrief({...brief, name: e.target.value})} autoFocus /></label>
        <label className="field">Briefing / objetivo<textarea rows={3} value={brief.briefing} onChange={e => setBrief({...brief, briefing: e.target.value})} placeholder="Tipo de vídeo, público, mensagem, estrutura e resultado esperado" /></label>
        <label className="field">Formato<Select label="Formato do vídeo" value={["1920x1080", "1080x1920", "1080x1080"].includes(`${brief.width}x${brief.height}`) ? `${brief.width}x${brief.height}` : ""} placeholder="Escolher proporção (ou editar abaixo)" onChange={value => {const [width, height] = value.split("x").map(Number); setBrief({...brief, width, height});}} options={[{value: "1920x1080", label: "Horizontal 16:9"}, {value: "1080x1920", label: "Vertical 9:16"}, {value: "1080x1080", label: "Quadrado 1:1"}]} /></label>
        <div className="numbers">{(['width', 'height', 'fps', 'duration'] as const).map((key, i) => <label className="field" key={key}>{['Largura', 'Altura', 'FPS', 'Duração (s)'][i]}<input type="number" required min={key === 'duration' ? 0.1 : key === 'fps' ? 1 : 2} step={key === 'duration' || key === 'fps' ? 'any' : 2} value={brief[key]} onChange={e => setBrief({...brief, [key]: Number(e.target.value)})} /></label>)}</div>
        <label className="field">Estilo / direção visual<textarea rows={3} value={brief.style} onChange={e => setBrief({...brief, style: e.target.value})} /></label>
        <label className="field">Observações<textarea rows={3} value={brief.notes} onChange={e => setBrief({...brief, notes: e.target.value})} /></label>
        <div className="row"><Button type="submit" variant="primary" disabled={busy}>{modal === 'new' ? 'Criar projeto' : 'Salvar alterações'}</Button><Button variant="ghost" onClick={() => setModal(null)}>Fechar</Button></div>
      </form>
    </section></div>}
    {/* Agent permission requests stay on top of everything else. */}
    {state.approvals[0] && <ApprovalDialog api={api} record={state.approvals[0]} queued={state.approvals.length}
      agent={state.settings.engine === 'opencode' ? 'OpenCode' : 'Claude'} />}
  </div>;
}
createRoot(document.getElementById('root')!).render(<App />);
