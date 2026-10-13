import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {API, Asset, AssetKind, Brief, Settings, State} from '../shared/types';
import './style.css';
import {Select} from './Select';
import {AssetList, NoteEditor, labels} from './Assets';
import {Trimmer} from './Trimmer';
const appLogo = new URL('../../favicon.png', import.meta.url).href;
declare global {interface Window {framepilot: API}}
const api = window.framepilot;
const defaults: Brief = {name: '', briefing: '', width: 1920, height: 1080, fps: 30, duration: 30, style: '', notes: ''};

const MODELS = ['', 'opus', 'sonnet', 'haiku', 'fable'];

function Icon({name}: {name: 'create' | 'settings' | 'brand'}) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'create' ? <><rect x="3" y="4" width="18" height="16" rx="5" /><path d="m10 9 5 3-5 3Z" /></> : name === 'settings' ? <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" fill="currentColor" stroke="none" /><circle cx="15" cy="17" r="3" fill="currentColor" stroke="none" /></> : <><path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3" /><path d="m10 8 6 4-6 4Z" /></>}
  </svg>;
}

function ClaudeMascot() {
  return <svg className="claude-mascot" width="48" height="40" viewBox="0 0 24 20" fill="currentColor" shapeRendering="crispEdges" aria-hidden="true">
    <path d="M5 2h14v2h2v4h3v5h-3v-3h-2v5h-2v4h-3v-4h-4v4H7v-4H5v-5H3v3H0V8h3V4h2Z" />
    <path className="claude-mascot-eyes" d="M8 6h2v4H8zm6 0h2v4h-2z" />
  </svg>;
}

function App() {
  const [state, setState] = useState<State>();
  const [section, setSection] = useState<'create' | 'settings'>('create');
  const [error, setError] = useState('');
  const [modal, setModal] = useState<'new' | 'brief' | null>(null);
  const [brief, setBrief] = useState<Brief>(defaults);
  const [tools, setTools] = useState<Settings>({claudePath: '', nodePath: '', npmPath: '', transcribe: true, frames: true, model: ''});
  const [kind, setKind] = useState<AssetKind>('main');
  const [note, setNote] = useState('');
  const [relevant, setRelevant] = useState(true);
  const [request, setRequest] = useState('');
  const [stream, setStream] = useState('');
  const [checking, setChecking] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
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
    if (section === 'create') chatEnd.current?.scrollIntoView({block: 'end'});
  }, [stream, state?.project?.messages.length, section]);
  useEffect(() => {
    if (state) setTools({...state.settings});
  }, [state?.settings.claudePath, state?.settings.nodePath, state?.settings.npmPath, state?.settings.transcribe, state?.settings.frames, state?.settings.model]);
  async function act(action: () => Promise<unknown>) {
    setError('');
    try {await action();} catch (e) {setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''));}
  }
  if (!state) return <main className="loading">{error || 'Carregando FramePilot…'}</main>;
  const p = state.project;
  const busy = Boolean(state.task) || state.claudeBusy || submitting;
  const openBrief = (create: boolean) => {setBrief(create ? {...defaults} : {...p!.brief}); setModal(create ? 'new' : 'brief');};
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
      <div className="header-status"><span className={`status ${busy ? 'working' : ''}`} role="status"><i />{state.task || 'Tudo pronto'}</span>{busy && <button className="danger" onClick={() => void act(api.stop)}>Interromper</button>}</div>
    </header>
    {error && <div className="error" role="alert">{error}<button onClick={() => setError('')}>Fechar</button></div>}
    <div className="page-stack">
    <section id="panel-create" role="tabpanel" aria-labelledby="tab-create" className={`page creation-page ${section === 'create' ? 'is-active' : ''}`} inert={section !== 'create'}>
      <div className="section-heading"><div><small>ESTÚDIO</small><h1>Criação</h1></div><div className="actions">{p && <button disabled={busy} onClick={() => void act(api.close)}>‹ Projetos</button>}<button disabled={busy} onClick={() => void act(() => api.open())}>Abrir outra pasta</button><button className="primary" disabled={busy} onClick={() => openBrief(true)}>Novo projeto <span aria-hidden="true">＋</span></button></div></div>
    {!p ? state.projects.length ? <main className="library">
      <div className="library-head"><div><h2>Seus projetos</h2><small className="path">{state.library}</small></div><button disabled={busy} onClick={() => void act(api.showLibrary)}>Abrir pasta</button></div>
      <ul className="project-grid">{state.projects.map(s => <li key={s.root}><button disabled={busy} title={s.root} onClick={() => void act(() => api.open(s.root))}>
        <strong>{s.name}</strong>
        <small>{s.width} × {s.height} · {s.duration}s</small>
        <small>{s.messages ? `${s.messages} mensagem(ns)${s.hasSession ? ' · sessão ativa' : ''}` : 'Sem pedidos ainda'}</small>
        <small>Editado {new Date(s.updatedAt).toLocaleString('pt-BR', {dateStyle: 'short', timeStyle: 'short'})}</small>
      </button></li>)}</ul>
    </main> : <main className="welcome"><span className="welcome-symbol"><Icon name="create" /></span><h2>Do material bruto<br />ao vídeo final.</h2><p>Crie um projeto, adicione seus arquivos e descreva a edição no chat.</p>
      <p>Node.js e Claude Code instalado/autenticado são necessários. Os projetos ficam em {state.library}.</p>
      <button className="primary" disabled={busy} onClick={() => openBrief(true)}>Criar projeto de vídeo</button></main> : <main className="workspace">
      <aside>
        <h2>{p.brief.name}</h2><small className="path">{state.root}</small>
        <p>{p.brief.width} × {p.brief.height} · {p.brief.fps} FPS · {p.brief.duration}s</p>
        <button disabled={busy} onClick={() => openBrief(false)}>Configurações do projeto</button>
        <h3>Assets e referências</h3>
        <label>Tipo<Select label="Tipo de arquivo" value={kind} onChange={value => setKind(value as AssetKind)} options={Object.entries(labels).map(([value, label]) => ({value, label}))} /></label>
        <label>Como usar<textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Ex.: logo principal; vídeo da abertura; música de fundo" /></label>
        <label className="check"><input type="checkbox" checked={relevant} onChange={e => setRelevant(e.target.checked)} />Informar ao Claude no próximo pedido</label>
        <button disabled={busy} onClick={() => void act(async () => {await api.importAsset(kind, note, relevant); setNote('');})}>Adicionar arquivos</button>
        <AssetList assets={p.assets} busy={busy} api={api} act={act} onEdit={setEditing} />
        <small>{p.session.initialSent ? `${p.changes.filter(c => c.relevant).length} alteração(ões) para o próximo pedido.` : 'O primeiro pedido receberá o contexto completo.'}</small>
        <button disabled={busy} onClick={() => void act(api.reveal)}>Abrir pasta / último render</button>
      </aside>
      <section className="editor">
        <div className="toolbar"><strong>Preview · Remotion Studio</strong>
          <button disabled={busy} onClick={() => void act(api.preview)}>Reiniciar preview</button>
          <button disabled={busy} onClick={() => void act(api.install)}>Instalar dependências</button>
          <button className="primary" disabled={busy} onClick={() => void act(api.render)}>Renderizar MP4</button>
        </div>
        <div className="preview">{state.previewUrl ? <iframe title="Remotion Studio" src={state.previewUrl} sandbox="allow-scripts allow-same-origin allow-downloads" allow="autoplay; fullscreen" /> : <div className="placeholder"><p>{state.task || 'Preview não iniciado.'}</p><p>Use Instalar dependências na primeira execução ou Reiniciar preview.</p></div>}</div>
        {state.lastRender && <div className="success">Render concluído: {state.lastRender}</div>}
        <details className="logs"><summary>Status e logs ({state.logs.length})</summary><pre>{state.logs.join('\n')}</pre></details>
      </section>
      <section className="chat" aria-label="Conversa com Claude Code"><div className="toolbar chat-header"><div className="claude-brand"><ClaudeMascot /><div><strong>Claude Code</strong><small>Seu parceiro de edição</small></div></div><button disabled={busy} onClick={() => void act(api.resetSession)}>Nova sessão</button></div>
        <small className="session">{p.session.id ? `Sessão ${p.session.id.slice(0, 8)} · retomada automaticamente` : 'Sessão será criada no primeiro pedido'}</small>
        <div className="messages" aria-live="polite">{p.messages.length === 0 && <p className="hint">Ex.: monte um vídeo de 30s usando os clipes, com cortes no ritmo da trilha e uma cartela final com nossa logo.</p>}
          {p.messages.map(m => <article key={m.id} className={m.role}><small>{m.role === 'user' ? 'Você' : m.role === 'assistant' ? 'Claude' : 'Status'}</small><div>{m.text}</div></article>)}
          {state.claudeBusy && <article className="assistant"><small>Claude trabalhando…</small><div>{stream || 'Analisando o projeto e editando arquivos…'}</div></article>}<div ref={chatEnd} />
        </div>
        <form className="composer" onSubmit={e => {e.preventDefault(); if (busy || !request.trim()) return; const text = request; setRequest(''); setStream(''); setSubmitting(true); void act(() => api.send(text)).finally(() => setSubmitting(false));}}>
          <textarea aria-label="Pedido para Claude" value={request} onChange={e => setRequest(e.target.value)} rows={4} placeholder="Descreva a edição ou o próximo ajuste…" />
          <button disabled={busy || !request.trim()}>Enviar pedido</button>
          <small>Claude edita os arquivos diretamente. O preview atualiza automaticamente.</small>
        </form>
      </section>
    </main>}
    </section>
    <section id="panel-settings" role="tabpanel" aria-labelledby="tab-settings" className={`page settings-page ${section === 'settings' ? 'is-active' : ''}`} inert={section !== 'settings'}>
      <div className="section-heading"><div><small>PREFERÊNCIAS</small><h1>Configurações</h1></div><span className="local-badge">No seu computador</span></div>
      <main className="settings-content"><div className="settings-intro"><span className="welcome-symbol"><Icon name="settings" /></span><h2>Seu ambiente de criação.</h2><p>Conecte suas ferramentas locais.<br />O FramePilot cuida do workflow.</p></div>
      <section className="settings-card"><h2>Ferramentas locais</h2>
        <p>Deixe em branco para detectar pelo PATH. Use o caminho do executável, sem argumentos.</p>
        {(['claudePath', 'nodePath', 'npmPath'] as const).map(key => <label key={key}>{key === 'claudePath' ? 'Claude Code (claude.exe / claude)' : key === 'nodePath' ? 'Node.js (node.exe / node)' : 'npm (npm.cmd / npm)'}<input value={tools[key]} onChange={e => setTools({...tools, [key]: e.target.value})} /></label>)}
        <label>Modelo do Claude<select value={MODELS.includes(tools.model) ? tools.model : 'custom'} onChange={e => setTools({...tools, model: e.target.value === 'custom' ? 'claude-opus-5-5' : e.target.value})}>
          <option value="">Padrão do Claude Code</option><option value="opus">Opus (mais recente)</option><option value="sonnet">Sonnet (mais recente)</option><option value="haiku">Haiku (mais recente)</option><option value="fable">Fable (mais recente)</option><option value="custom">ID personalizado…</option></select></label>
        {!MODELS.includes(tools.model) && <label>ID do modelo<input value={tools.model} placeholder="claude-opus-5-5" onChange={e => setTools({...tools, model: e.target.value})} /></label>}
        <label className="check"><input type="checkbox" checked={tools.transcribe} onChange={e => setTools({...tools, transcribe: e.target.checked})} />Transcrever falas com Whisper antes de cada pedido (GPU NVIDIA quando disponível)</label>
        <label className="check"><input type="checkbox" checked={tools.frames} onChange={e => setTools({...tools, frames: e.target.checked})} />Extrair frames dos vídeos com FFmpeg para análise visual do Claude</label>
        <p>Na primeira vez são baixados o Whisper e o modelo large-v3-turbo (~2,3 GB). "Salvar e verificar" já faz esse download.</p>
        <p>Claude ausente ou sem login? Instale e execute <code>claude</code> uma vez para autenticar. Depois todas as sessões são controladas aqui.</p>
        <pre>{checking}</pre><div className="actions"><button disabled={busy} onClick={() => void act(async () => {await api.settings(tools); setChecking(await api.check());})}>Salvar e verificar</button>
          <button disabled={busy} onClick={() => void act(async () => {await api.settings(tools); setChecking('Configurações salvas.');})}>Salvar</button></div>
      </section>
      <section className="settings-card"><h2>Pasta de projetos</h2>
        <p>Novos projetos são criados automaticamente aqui e aparecem na tela inicial.</p>
        <code className="path">{state.library}</code>
        <div className="actions"><button onClick={() => void act(api.showLibrary)}>Abrir pasta</button></div>

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
    {modal && <div className="overlay"><section className="modal" role="dialog" aria-modal="true" aria-label="Configurações do projeto">
      <h2>{modal === 'new' ? 'Novo projeto de vídeo' : 'Configurações do projeto'}</h2>
      <form onSubmit={e => {e.preventDefault(); const create = modal === 'new'; void act(async () => {await (create ? api.create(brief) : api.save(brief)); setModal(null);}); setModal(null);}}>
        <label>Nome<input required maxLength={200} value={brief.name} onChange={e => setBrief({...brief, name: e.target.value})} /></label>
        <label>Briefing / objetivo<textarea rows={3} value={brief.briefing} onChange={e => setBrief({...brief, briefing: e.target.value})} placeholder="Tipo de vídeo, público, mensagem, estrutura e resultado esperado" /></label>
        <label>Formato<Select label="Formato do vídeo" value={["1920x1080", "1080x1920", "1080x1080"].includes(`${brief.width}x${brief.height}`) ? `${brief.width}x${brief.height}` : ""} placeholder="Escolher proporção (ou editar abaixo)" onChange={value => {const [width, height] = value.split("x").map(Number); setBrief({...brief, width, height});}} options={[{value: "1920x1080", label: "Horizontal 16:9"}, {value: "1080x1920", label: "Vertical 9:16"}, {value: "1080x1080", label: "Quadrado 1:1"}]} /></label>
        <div className="numbers">{(['width', 'height', 'fps', 'duration'] as const).map((key, i) => <label key={key}>{['Largura', 'Altura', 'FPS', 'Duração (s)'][i]}<input type="number" required min={key === 'duration' ? 0.1 : key === 'fps' ? 1 : 2} step={key === 'duration' || key === 'fps' ? 'any' : 2} value={brief[key]} onChange={e => setBrief({...brief, [key]: Number(e.target.value)})} /></label>)}</div>
        <label>Estilo / direção visual<textarea rows={2} value={brief.style} onChange={e => setBrief({...brief, style: e.target.value})} /></label>
        <label>Observações<textarea rows={2} value={brief.notes} onChange={e => setBrief({...brief, notes: e.target.value})} /></label>
        <button disabled={busy}>{modal === 'new' ? 'Criar projeto' : 'Salvar alterações'}</button>
      </form>
      <button className="close" onClick={() => setModal(null)}>Fechar</button>
    </section></div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<App />);
