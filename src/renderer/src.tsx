import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {API, AssetKind, Brief, Settings, State} from '../shared/types';
import './style.css';
declare global {interface Window {framepilot: API}}
const api = window.framepilot;
const defaults: Brief = {name: '', briefing: '', width: 1920, height: 1080, fps: 30, duration: 30, style: '', notes: ''};
const labels: Record<AssetKind, string> = {logo: 'Logo', image: 'Imagem', video: 'Vídeo', audio: 'Áudio / trilha', font: 'Fonte', reference: 'Referência visual', document: 'Identidade / documento'};

function App() {
  const [state, setState] = useState<State>();
  const [error, setError] = useState('');
  const [modal, setModal] = useState<'new' | 'brief' | 'tools' | null>(null);
  const [brief, setBrief] = useState<Brief>(defaults);
  const [tools, setTools] = useState<Settings>({claudePath: '', nodePath: '', npmPath: ''});
  const [kind, setKind] = useState<AssetKind>('video');
  const [note, setNote] = useState('');
  const [relevant, setRelevant] = useState(true);
  const [request, setRequest] = useState('');
  const [stream, setStream] = useState('');
  const [checking, setChecking] = useState('');
  const [submitting, setSubmitting] = useState(false);
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
  useEffect(() => {chatEnd.current?.scrollIntoView({block: 'end'});}, [stream, state?.project?.messages.length]);
  async function act(action: () => Promise<unknown>) {
    setError('');
    try {await action();} catch (e) {setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''));}
  }
  if (!state) return <main className="loading">{error || 'Carregando FramePilot…'}</main>;
  const p = state.project;
  const busy = Boolean(state.task) || state.claudeBusy || submitting;
  const openBrief = (create: boolean) => {setBrief(create ? {...defaults} : {...p!.brief}); setModal(create ? 'new' : 'brief');};
  return <div className="app">
    <header><strong>FramePilot</strong><span>Edição de vídeo com Claude + Remotion</span>
      <button disabled={busy} onClick={() => openBrief(true)}>Novo projeto</button>
      <button disabled={busy} onClick={() => void act(api.open)}>Abrir projeto</button>
      <button disabled={busy} onClick={() => {setTools({...state.settings}); setModal('tools');}}>Ferramentas</button>
      <span className="status" role="status">{state.task || 'Pronto'}</span>
      {busy && <button className="danger" onClick={() => void act(api.stop)}>Interromper</button>}
    </header>
    {error && <div className="error" role="alert">{error}<button onClick={() => setError('')}>Fechar</button></div>}
    {!p ? <main className="welcome"><h1>Do material bruto ao vídeo final.</h1><p>Crie um projeto, adicione seus arquivos e descreva a edição no chat.</p>
      <p>Node.js e Claude Code instalado/autenticado são necessários. Os arquivos ficam no seu computador.</p>
      <button disabled={busy} onClick={() => openBrief(true)}>Criar projeto de vídeo</button></main> : <main className="workspace">
      <aside>
        <h2>{p.brief.name}</h2><small className="path">{state.root}</small>
        <p>{p.brief.width} × {p.brief.height} · {p.brief.fps} FPS · {p.brief.duration}s</p>
        <button disabled={busy} onClick={() => openBrief(false)}>Configurações do projeto</button>
        <h3>Assets e referências</h3>
        <label>Tipo<select value={kind} onChange={e => setKind(e.target.value as AssetKind)}>{Object.entries(labels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Como usar<textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Ex.: logo principal; vídeo da abertura; música de fundo" /></label>
        <label className="check"><input type="checkbox" checked={relevant} onChange={e => setRelevant(e.target.checked)} />Informar ao Claude no próximo pedido</label>
        <button disabled={busy} onClick={() => void act(async () => {await api.importAsset(kind, note, relevant); setNote('');})}>Adicionar arquivos</button>
        <ul className="assets">{p.assets.map(a => <li key={a.id} title={`${a.path}\n${a.note}`}><small>{labels[a.kind]}</small><div>{a.name}</div>{a.note && <small>{a.note}</small>}</li>)}</ul>
        <small>{p.session.initialSent ? `${p.changes.filter(c => c.relevant).length} alteração(ões) para o próximo pedido.` : 'O primeiro pedido receberá o contexto completo.'}</small>
        <button disabled={busy} onClick={() => void act(api.reveal)}>Abrir pasta / último render</button>
      </aside>
      <section className="editor">
        <div className="toolbar"><strong>Preview · Remotion Studio</strong>
          <button disabled={busy} onClick={() => void act(api.preview)}>Reiniciar preview</button>
          <button disabled={busy} onClick={() => void act(api.install)}>Instalar dependências</button>
          <button disabled={busy} onClick={() => void act(api.render)}>Renderizar MP4</button>
        </div>
        <div className="preview">{state.previewUrl ? <iframe title="Remotion Studio" src={state.previewUrl} sandbox="allow-scripts allow-same-origin allow-downloads" allow="autoplay; fullscreen" /> : <div className="placeholder"><p>{state.task || 'Preview não iniciado.'}</p><p>Use Instalar dependências na primeira execução ou Reiniciar preview.</p></div>}</div>
        {state.lastRender && <div className="success">Render concluído: {state.lastRender}</div>}
        <details className="logs"><summary>Status e logs ({state.logs.length})</summary><pre>{state.logs.join('\n')}</pre></details>
      </section>
      <section className="chat"><div className="toolbar"><strong>Claude Code</strong><button disabled={busy} onClick={() => void act(api.resetSession)}>Nova sessão</button></div>
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
    {modal && <div className="overlay"><section className="modal" role="dialog" aria-modal="true" aria-label={modal === 'tools' ? 'Ferramentas locais' : 'Configurações do projeto'}>
      <h2>{modal === 'tools' ? 'Ferramentas locais' : modal === 'new' ? 'Novo projeto de vídeo' : 'Configurações do projeto'}</h2>
      {modal === 'tools' ? <>
        <p>Deixe em branco para detectar pelo PATH. Use o caminho do executável, sem argumentos.</p>
        {(['claudePath', 'nodePath', 'npmPath'] as const).map(key => <label key={key}>{key === 'claudePath' ? 'Claude Code (claude.exe / claude)' : key === 'nodePath' ? 'Node.js (node.exe / node)' : 'npm (npm.cmd / npm)'}<input value={tools[key]} onChange={e => setTools({...tools, [key]: e.target.value})} /></label>)}
        <p>Claude ausente ou sem login? Instale e execute <code>claude</code> uma vez para autenticar. Depois todas as sessões são controladas aqui.</p>
        <pre>{checking}</pre><div className="actions"><button disabled={busy} onClick={() => void act(async () => {await api.settings(tools); setChecking(await api.check());})}>Salvar e verificar</button>
          <button disabled={busy} onClick={() => void act(async () => {await api.settings(tools); setModal(null);})}>Salvar</button></div>
      </> : <form onSubmit={e => {e.preventDefault(); const create = modal === 'new'; void act(async () => {await (create ? api.create(brief) : api.save(brief)); setModal(null);}); setModal(null);}}>
        <label>Nome<input required maxLength={200} value={brief.name} onChange={e => setBrief({...brief, name: e.target.value})} /></label>
        <label>Briefing / objetivo<textarea rows={3} value={brief.briefing} onChange={e => setBrief({...brief, briefing: e.target.value})} placeholder="Tipo de vídeo, público, mensagem, estrutura e resultado esperado" /></label>
        <label>Formato<select value="" onChange={e => {const [width, height] = e.target.value.split('x').map(Number); setBrief({...brief, width, height});}}><option value="" disabled>Escolher proporção (ou editar abaixo)</option><option value="1920x1080">Horizontal 16:9</option><option value="1080x1920">Vertical 9:16</option><option value="1080x1080">Quadrado 1:1</option></select></label>
        <div className="numbers">{(['width', 'height', 'fps', 'duration'] as const).map((key, i) => <label key={key}>{['Largura', 'Altura', 'FPS', 'Duração (s)'][i]}<input type="number" required min={key === 'duration' ? 0.1 : key === 'fps' ? 1 : 2} step={key === 'duration' || key === 'fps' ? 'any' : 2} value={brief[key]} onChange={e => setBrief({...brief, [key]: Number(e.target.value)})} /></label>)}</div>
        <label>Estilo / direção visual<textarea rows={2} value={brief.style} onChange={e => setBrief({...brief, style: e.target.value})} /></label>
        <label>Observações<textarea rows={2} value={brief.notes} onChange={e => setBrief({...brief, notes: e.target.value})} /></label>
        <button disabled={busy}>{modal === 'new' ? 'Escolher pasta e criar' : 'Salvar alterações'}</button>
      </form>}
      <button className="close" onClick={() => setModal(null)}>Fechar</button>
    </section></div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<App />);
