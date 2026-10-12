import React, {useEffect, useMemo, useRef, useState} from 'react';
import type {Asset, AssetPatch, Segment} from '../shared/types';

const EPS = 1e-4;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const pad = (n: number) => String(n).padStart(2, '0');
/** h:mm:ss:ff (hours only when needed), frames at the nominal rate. */
export function timecode(t: number, fps: number) {
  const rate = Math.round(fps);
  const frames = Math.round(Math.max(0, t) * rate);
  const s = Math.floor(frames / rate), h = Math.floor(s / 3600);
  return `${h ? `${h}:` : ''}${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(frames % rate)}`;
}
/** Accepts h:mm:ss:ff, mm:ss:ff, mm:ss, mm:ss.mmm or plain seconds. */
export function parseTimecode(text: string, fps: number): number | null {
  const parts = text.trim().replace(',', '.').split(':');
  if (!parts.every(p => /^\d+(\.\d+)?$/.test(p))) return null;
  const n = parts.map(Number);
  if (n.length === 1) return n[0];
  const decimal = parts.at(-1)!.includes('.');
  if (!decimal && n.length >= 3) {
    const [f, s, m, h = 0] = n.reverse();
    return h * 3600 + m * 60 + s + f / Math.round(fps);
  }
  const [s, m, h = 0] = n.reverse();
  return h * 3600 + m * 60 + s;
}
export const shortTime = (t: number) => {
  const s = Math.round(t), h = Math.floor(s / 3600);
  return h ? `${h}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`;
};
const kept = (segments: Segment[]) => segments.reduce((sum, s) => sum + s.end - s.start, 0);

function TimeField({label, value, fps, onCommit}: {label: string; value: number; fps: number; onCommit: (t: number) => void}) {
  const [text, setText] = useState(timecode(value, fps));
  useEffect(() => setText(timecode(value, fps)), [value, fps]);
  const commit = () => {
    const t = parseTimecode(text, fps);
    setText(timecode(value, fps));
    if (t !== null) onCommit(t);
  };
  return <label className="time-field">{label}<input value={text} spellCheck={false} onChange={e => setText(e.target.value)} onBlur={commit}
    onKeyDown={e => {if (e.key === 'Enter') (e.target as HTMLInputElement).blur();}} /></label>;
}

const icons = {
  play: <path d="M8 5v14l11-7Z" fill="currentColor" stroke="none" />,
  pause: <path d="M8 5h3v14H8zm5 0h3v14h-3z" fill="currentColor" stroke="none" />,
  prev: <path d="M15 6l-6 6 6 6" />,
  next: <path d="M9 6l6 6-6 6" />,
  split: <><path d="M12 3v18" /><path d="M5 8l-3 4 3 4M19 8l3 4-3 4" /></>
};
const Glyph = ({name}: {name: keyof typeof icons}) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name]}</svg>;

interface Props {asset: Asset; fps: number; busy: boolean; onSave: (patch: AssetPatch) => Promise<void>; onClose: () => void}
export function Trimmer({asset, fps: projectFps, busy, onSave, onClose}: Props) {
  const fps = asset.fps || projectFps;
  const frame = 1 / fps;
  const video = useRef<HTMLVideoElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const drag = useRef<{type: 'seek'} | {type: 'start' | 'end'; index: number} | null>(null);
  const [duration, setDuration] = useState(asset.duration ?? 0);
  const [segments, setSegments] = useState<Segment[]>(asset.segments ?? []);
  const [selected, setSelected] = useState(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [skipCuts, setSkipCuts] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(800);
  const [kind, setKind] = useState(asset.kind);
  const [note, setNote] = useState(asset.note);
  const [loadError, setLoadError] = useState('');
  const live = useRef({segments, skipCuts});
  live.current = {segments, skipCuts};
  const snap = (t: number) => clamp(Math.round(t * fps) / fps, 0, duration);
  const seg = segments[selected];

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // While playing, follow the playhead and, in result preview, jump over removed ranges.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const v = video.current;
      if (!v) return;
      const t = v.currentTime;
      const {segments, skipCuts} = live.current;
      if (skipCuts && segments.length && !v.seeking) {
        const inside = segments.some(s => t >= s.start - 0.02 && t < s.end - frame / 2);
        if (!inside) {
          const next = segments.find(s => s.start > t - 0.02);
          if (next) v.currentTime = next.start;
          else {v.pause(); v.currentTime = segments.at(-1)!.end;}
        }
      }
      setTime(v.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, frame]);
  useEffect(() => {
    const el = scroller.current;
    if (!el || zoom <= 1 || !duration) return;
    const x = time / duration * el.scrollWidth;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 30) el.scrollLeft = x - el.clientWidth * 0.2;
  }, [time, zoom, duration]);

  const seek = (t: number) => {
    const v = video.current;
    const target = clamp(t, 0, duration);
    if (v) v.currentTime = target;
    setTime(target);
  };
  const toggle = () => {
    const v = video.current;
    if (!v || !duration) return;
    if (!v.paused) {v.pause(); return;}
    if (skipCuts && segments.length && !segments.some(s => v.currentTime >= s.start - 0.02 && v.currentTime < s.end - frame / 2)) {
      v.currentTime = (segments.find(s => s.start > v.currentTime) ?? segments[0]).start;
    }
    void v.play();
  };
  const adjust = (list: Segment[], index: number, edge: 'start' | 'end', t: number) => {
    const next = list.slice();
    const s = {...next[index]};
    if (edge === 'start') s.start = clamp(snap(t), index ? next[index - 1].end : 0, s.end - frame);
    else s.end = clamp(snap(t), s.start + frame, index < next.length - 1 ? next[index + 1].start : duration);
    next[index] = s;
    return next;
  };
  const splitIndex = segments.findIndex(s => time - s.start >= frame - EPS && s.end - time >= frame - EPS);
  const inGap = duration > 0 && !segments.some(s => time >= s.start - EPS && time < s.end - EPS);
  const ops = {
    split: () => {
      if (splitIndex < 0) return;
      const t = snap(time);
      const s = segments[splitIndex];
      setSegments([...segments.slice(0, splitIndex), {start: s.start, end: t}, {start: t, end: s.end}, ...segments.slice(splitIndex + 1)]);
      setSelected(splitIndex + 1);
    },
    remove: () => {
      if (segments.length <= 1) return;
      setSegments(segments.filter((_, i) => i !== selected));
      setSelected(Math.max(0, Math.min(selected, segments.length - 2)));
    },
    setIn: () => {if (seg) setSegments(adjust(segments, selected, 'start', time));},
    setOut: () => {if (seg) setSegments(adjust(segments, selected, 'end', time));},
    add: () => {
      if (!inGap) return;
      const t = snap(time);
      const limit = segments.find(s => s.start > t)?.start ?? duration;
      const end = Math.min(limit, t + 5);
      if (end - t < frame - EPS) return;
      const next = [...segments, {start: t, end}].sort((a, b) => a.start - b.start);
      setSegments(next);
      setSelected(next.findIndex(s => s.start === t));
    },
    reset: () => {setSegments([{start: 0, end: duration}]); setSelected(0);},
    step: (delta: number) => {video.current?.pause(); seek(snap(time + delta));}
  };
  const keys = useRef<(e: KeyboardEvent) => void>(undefined);
  keys.current = e => {
    if ((e.target as HTMLElement).closest('input, textarea, select, [role="listbox"]')) return;
    const map: Record<string, () => void> = {' ': toggle, ArrowLeft: () => ops.step(e.shiftKey ? -1 : -frame), ArrowRight: () => ops.step(e.shiftKey ? 1 : frame),
      i: ops.setIn, o: ops.setOut, s: ops.split, Delete: ops.remove, Backspace: ops.remove};
    const action = map[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (action) {e.preventDefault(); action();}
  };
  useEffect(() => {
    const listener = (e: KeyboardEvent) => keys.current?.(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  const timeAt = (clientX: number) => {
    const rect = track.current!.getBoundingClientRect();
    return snap((clientX - rect.left) / rect.width * duration);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !duration) return;
    const t = timeAt(e.clientX);
    if (d.type !== 'seek') {
      const next = adjust(segments, d.index, d.type, t);
      setSegments(next);
      seek(next[d.index][d.type]);
    } else seek(t);
  };
  const begin = (e: React.PointerEvent, state: NonNullable<typeof drag.current>) => {
    if (!duration) return;
    e.stopPropagation();
    track.current!.setPointerCapture(e.pointerId);
    drag.current = state;
    if (state.type === 'seek') {video.current?.pause(); seek(timeAt(e.clientX));}
  };
  const ticks = useMemo(() => {
    if (!duration) return [];
    const inner = width * zoom;
    const step = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600].find(s => s / duration * inner >= 80) ?? 3600;
    return Array.from({length: Math.floor(duration / step) + 1}, (_, i) => i * step);
  }, [duration, width, zoom]);
  const pct = (t: number) => duration ? `${t / duration * 100}%` : '0%';
  const full = segments.length === 1 && segments[0].start < frame && segments[0].end > duration - frame;
  const isVideo = kind === 'main' || kind === 'video';

  return <div className="overlay"><section className="trimmer" role="dialog" aria-modal="true" aria-label={`Recortes de ${asset.name}`}>
    <header className="trimmer-head">
      <div><small>{kind === 'main' ? 'VÍDEO PRINCIPAL' : 'VÍDEO AUXILIAR'} · RECORTES</small><h2 title={asset.name}>{asset.name}</h2></div>
      {isVideo && <div className="segmented" role="radiogroup" aria-label="Categoria">
        {(['main', 'video'] as const).map(k => <button key={k} role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{k === 'main' ? 'Principal' : 'Auxiliar'}</button>)}
      </div>}
    </header>
    <div className="trimmer-body">
      <div className="player">
        <video ref={video} src={`fp-media://asset/${encodeURIComponent(asset.id)}`} preload="auto" onClick={toggle}
          onLoadedMetadata={e => {
            const d = e.currentTarget.duration;
            if (!Number.isFinite(d)) return;
            setDuration(d);
            setSegments(list => {
              const clean = list.map(s => ({start: Math.min(s.start, d), end: Math.min(s.end, d)})).filter(s => s.end - s.start > EPS);
              return clean.length ? clean : [{start: 0, end: d}];
            });
            if (asset.segments?.length) e.currentTarget.currentTime = asset.segments[0].start;
          }}
          onError={() => setLoadError('Este arquivo não pode ser reproduzido aqui (codec não suportado pelo Chromium). Converta para MP4 H.264 para recortá-lo.')}
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onSeeked={e => !playing && setTime(e.currentTarget.currentTime)} />
        {loadError && <p className="player-error">{loadError}</p>}
      </div>
      <aside className="segment-panel">
        <h3>Trechos mantidos <span>{segments.length}</span></h3>
        <ol className="segment-list">{segments.map((s, i) => <li key={i}><button className={i === selected ? 'on' : ''} onClick={() => {setSelected(i); seek(s.start);}}>
          <b>{i + 1}</b><span>{timecode(s.start, fps)} → {timecode(s.end, fps)}</span><small>{shortTime(s.end - s.start)}</small></button></li>)}</ol>
        {seg && <div className="segment-edit">
          <TimeField label="Início" value={seg.start} fps={fps} onCommit={t => setSegments(adjust(segments, selected, 'start', t))} />
          <TimeField label="Fim" value={seg.end} fps={fps} onCommit={t => setSegments(adjust(segments, selected, 'end', t))} />
          <div className="mini-actions"><button onClick={ops.setIn} title="Atalho: I">Início no cursor</button><button onClick={ops.setOut} title="Atalho: O">Fim no cursor</button></div>
          <button className="remove-segment" disabled={segments.length <= 1} onClick={ops.remove} title="Atalho: Delete">Remover trecho {selected + 1}</button>
        </div>}
        <label className="note">Como usar<textarea rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="Ex.: entrevista completa; priorizar respostas sobre gestão" /></label>
      </aside>
    </div>
    <div className="transport">
      <button className="icon" onClick={() => ops.step(-frame)} aria-label="Frame anterior" title="← frame · Shift+← 1s"><Glyph name="prev" /></button>
      <button className="icon play" onClick={toggle} aria-label={playing ? 'Pausar' : 'Reproduzir'} title="Espaço"><Glyph name={playing ? 'pause' : 'play'} /></button>
      <button className="icon" onClick={() => ops.step(frame)} aria-label="Próximo frame" title="→ frame · Shift+→ 1s"><Glyph name="next" /></button>
      <span className="clock">{timecode(time, fps)} <small>/ {timecode(duration, fps)}</small></span>
      <label className="check"><input type="checkbox" checked={skipCuts} onChange={e => setSkipCuts(e.target.checked)} />Prévia do resultado (pula trechos removidos)</label>
      <span className="spacer" />
      <button onClick={ops.split} disabled={splitIndex < 0} title="Atalho: S"><Glyph name="split" /> Dividir</button>
      <button onClick={ops.add} disabled={!inGap}>Manter trecho aqui</button>
      <button onClick={ops.reset} disabled={!duration || full}>Vídeo inteiro</button>
      <label className="zoom">Zoom<input type="range" min={1} max={60} step={0.5} value={zoom} onChange={e => setZoom(Number(e.target.value))} /></label>
    </div>
    <div className="timeline" ref={scroller}>
      <div className="timeline-inner" style={{width: `${zoom * 100}%`}}>
        <div className="ruler">{ticks.map(t => <span key={t} style={{left: pct(t)}}>{shortTime(t)}{t % 1 ? `.${Math.round((t % 1) * 100)}` : ''}</span>)}</div>
        <div className="track" ref={track} onPointerDown={e => begin(e, {type: 'seek'})} onPointerMove={onMove} onPointerUp={() => {drag.current = null;}} onPointerCancel={() => {drag.current = null;}}>
          {segments.map((s, i) => <div key={i} className={`clip ${i === selected ? 'on' : ''}`} style={{left: pct(s.start), width: pct(s.end - s.start)}}
            onPointerDown={e => {setSelected(i); begin(e, {type: 'seek'});}}>
            <span className="grip start" onPointerDown={e => {setSelected(i); begin(e, {type: 'start', index: i});}} />
            <em>{i + 1}</em>
            <span className="grip end" onPointerDown={e => {setSelected(i); begin(e, {type: 'end', index: i});}} />
          </div>)}
          <div className="playhead" style={{left: pct(time)}} />
        </div>
      </div>
    </div>
    <footer className="trimmer-foot">
      <span>Original {timecode(duration, fps)} · <strong>Resultado {timecode(kept(segments), fps)}</strong> em {segments.length} trecho(s), contínuo e sem lacunas · {+fps.toFixed(3)} FPS</span>
      <button onClick={onClose}>Cancelar</button>
      <button className="primary" disabled={busy || !duration} onClick={() => void onSave({kind, note, duration, segments: full ? [] : segments})}>Salvar recortes</button>
    </footer>
  </section></div>;
}
