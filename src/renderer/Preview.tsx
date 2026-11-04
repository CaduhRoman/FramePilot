import React, {useEffect, useRef, useState} from 'react';
import type {API, State} from '../shared/types';
import {Button, EmptyState, Icon, IconButton, Menu, MenuItem, formatTime} from './ui';
import {renderProgress, type AppStatus} from './status';

type Act = (action: () => Promise<unknown>) => Promise<void>;
type Player = {ready: boolean; frame: number; playing: boolean; duration: number; fps: number};

const modeKey = (root: string) => `framepilot.advancedPreview:${root}`;
function readMode(root: string) {
  try {return localStorage.getItem(modeKey(root)) === '1';} catch {return false;}
}

/** Studio stays the engine; by default only its canvas is shown, with FramePilot's own transport. */
export function PreviewPanel({state, api, act, busy, status, fallbackFps, fallbackDuration, onBuilding, overlay}: {
  state: State; api: API; act: Act; busy: boolean; status: AppStatus; fallbackFps: number; fallbackDuration: number;
  onBuilding: (building: boolean) => void; overlay?: React.ReactNode;
}) {
  const root = state.root!;
  const [advanced, setAdvanced] = useState(() => readMode(root));
  const [player, setPlayer] = useState<Player>({ready: false, frame: 0, playing: false, duration: 0, fps: 0});
  const [slow, setSlow] = useState(false);
  const [doneDismissed, setDoneDismissed] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => setAdvanced(readMode(root)), [root]);
  const post = (message: object) => frame.current?.contentWindow?.postMessage({fp: 'host', ...message}, '*');
  useEffect(() => {post({type: 'mode', clean: !advanced});}, [advanced, state.previewUrl]);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.fp !== 'studio') return;
      if (event.data.type === 'hello') post({type: 'mode', clean: !advanced});
      if (event.data.type === 'state') {
        const {ready, frame: f, playing, duration, fps, building} = event.data;
        setPlayer({ready: Boolean(ready), frame: Number(f) || 0, playing: Boolean(playing), duration: Number(duration) || 0, fps: Number(fps) || 0});
        onBuilding(Boolean(building));
      }
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [advanced, onBuilding]);
  useEffect(() => {
    setPlayer(p => ({...p, ready: false}));
    setSlow(false);
    if (!state.previewUrl) return;
    const timer = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(timer);
  }, [state.previewUrl]);
  function toggleMode() {
    const next = !advanced;
    setAdvanced(next);
    try {localStorage.setItem(modeKey(root), next ? '1' : '0');} catch {}
  }
  const fps = player.fps || fallbackFps;
  const total = player.duration || Math.round(fallbackDuration * fallbackFps);
  const rendering = status.kind === 'render';
  const progress = rendering ? renderProgress(state.logs) : null;
  const finished = !rendering && state.lastRender && doneDismissed !== state.lastRender ? state.lastRender : null;
  const starting = !state.previewUrl && (status.kind === 'preview');

  return <section className="editor" aria-label="Preview do vídeo">
    <header className="panel-toolbar">
      <h2>Preview</h2>
      <Button variant="ghost" aria-pressed={advanced} title={advanced ? 'Voltar ao player simples' : 'Mostrar o Remotion Studio completo'} onClick={toggleMode}>{advanced ? 'Player simples' : 'Modo avançado'}</Button>
      <Menu trigger={props => <IconButton {...props} label="Mais opções do preview" icon="more" />}>
        {close => <div role="menu" aria-label="Opções do preview">
          <MenuItem role="menuitem" icon="restart" disabled={busy} hint="Use se o preview travar ou não atualizar" onClick={() => {close(); void act(api.preview);}}>Reiniciar preview</MenuItem>
          <MenuItem role="menuitem" icon="package" disabled={busy} hint="Reinstala os pacotes do projeto Remotion" onClick={() => {close(); void act(api.install);}}>Instalar dependências</MenuItem>
          <MenuItem role="menuitem" icon="folder" onClick={() => {close(); void act(api.reveal);}}>Abrir pasta do projeto</MenuItem>
        </div>}
      </Menu>
      <Button variant="primary" icon="film" disabled={busy} title={busy ? 'Aguarde a operação atual terminar' : undefined} onClick={() => void act(api.render)}>Renderizar MP4</Button>
    </header>

    <div className="preview">
      {overlay ?? (state.previewUrl ? <>
        <iframe ref={frame} title="Preview do vídeo" src={state.previewUrl} sandbox="allow-scripts allow-same-origin allow-downloads" allow="autoplay; fullscreen"
          onLoad={() => post({type: 'mode', clean: !advanced})} />
        {!advanced && player.ready && <div className="stage-click" aria-hidden="true" onClick={() => post({type: 'toggle'})} />}
      </> : <EmptyState icon="film" title={starting ? 'Preparando o preview…' : 'Preview parado'}>
        {starting ? <p>{status.detail ?? 'Isso pode levar alguns segundos.'}</p> : <>
          <p>Inicie o preview para ver o vídeo. Na primeira vez, instale as dependências.</p>
          <div className="row"><Button icon="restart" disabled={busy} onClick={() => void act(api.preview)}>Iniciar preview</Button>
            <Button variant="ghost" icon="package" disabled={busy} onClick={() => void act(api.install)}>Instalar dependências</Button></div>
        </>}
      </EmptyState>)}
    </div>

    {!overlay && state.previewUrl && !advanced && <div className="player-bar">
      {player.ready ? <>
        <IconButton variant="secondary" label={player.playing ? 'Pausar' : 'Reproduzir'} icon={player.playing ? 'pause' : 'play'} onClick={() => post({type: 'toggle'})} />
        <input type="range" className="seek" aria-label="Posição no vídeo" min={0} max={Math.max(0, total - 1)} step={1} value={Math.min(player.frame, Math.max(0, total - 1))}
          aria-valuetext={`${formatTime(player.frame / fps)} de ${formatTime(total / fps)}`}
          style={{'--progress': `${total > 1 ? (player.frame / (total - 1)) * 100 : 0}%`} as React.CSSProperties}
          onChange={e => {const f = Number(e.target.value); setPlayer(p => ({...p, frame: f})); post({type: 'seek', frame: f});}} />
        <span className="clock"><span>{formatTime(player.frame / fps)}</span> / {formatTime(total / fps)}</span>
      </> : <span className="player-note">{slow ? 'Player simples indisponível agora. Use o Modo avançado para ver o Studio completo.' : 'Carregando player…'}</span>}
    </div>}

    {rendering && <div className="render-progress" role="status">
      <div className="render-row"><span><Icon name="film" /> Renderizando MP4</span><strong>{progress === null ? 'Preparando…' : `${Math.round(progress * 100)}%`}</strong>
        <Button variant="danger" onClick={() => void act(api.stop)}>Cancelar</Button></div>
      <div className={`bar ${progress === null ? 'indeterminate' : ''}`} role="progressbar" aria-label="Progresso do render" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress === null ? undefined : Math.round(progress * 100)}>
        <i style={{width: progress === null ? undefined : `${progress * 100}%`}} /></div>
    </div>}

    {finished && <div className="render-done" role="status">
      <Icon name="check" /><div className="render-done-text"><strong>Vídeo renderizado</strong><small title={finished}>{finished.split(/[\\/]/).pop()}</small></div>
      <Button icon="open" onClick={() => void act(api.openRender)}>Abrir vídeo</Button>
      <Button variant="ghost" icon="folder" onClick={() => void act(api.reveal)}>Abrir pasta</Button>
      <IconButton label="Dispensar aviso" icon="close" onClick={() => setDoneDismissed(finished)} />
    </div>}
  </section>;
}
