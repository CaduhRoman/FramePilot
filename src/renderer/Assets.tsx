import React, {useState} from 'react';
import type {API, Asset, AssetKind, AssetPatch} from '../shared/types';
import {shortTime} from './Trimmer';

export const labels: Record<AssetKind, string> = {main: 'Vídeo principal', logo: 'Logo', image: 'Imagem', video: 'Vídeo', audio: 'Áudio / trilha', font: 'Fonte', reference: 'Referência visual', document: 'Identidade / documento'};
const isVideo = (a: Asset) => a.kind === 'main' || a.kind === 'video';

const paths = {
  edit: <><path d="M4 20h4L19 9l-4-4L4 16Z" /><path d="m13.5 6.5 4 4" /></>,
  trim: <><circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><path d="M8 7.5 20 17M8 16.5 20 7" /></>,
  up: <path d="m6 15 6-6 6 6" />,
  down: <path d="m6 9 6 6 6-6" />,
  video: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m10 9 5 3-5 3Z" /></>,
  file: <><path d="M6 3h8l4 4v14H6Z" /><path d="M14 3v4h4" /></>,
  audio: <><path d="M9 18V6l10-2v12" /><circle cx="7" cy="18" r="2" /><circle cx="17" cy="16" r="2" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="2" /><path d="m21 16-5-5-9 9" /></>
};
const Svg = ({name}: {name: keyof typeof paths}) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
const kindIcon = (k: AssetKind): keyof typeof paths => k === 'main' || k === 'video' ? 'video' : k === 'audio' ? 'audio' : k === 'image' || k === 'logo' ? 'image' : 'file';

/** Reads the duration of videos imported before FFmpeg was available. */
function DurationProbe({asset, api}: {asset: Asset; api: API}) {
  return <video hidden preload="metadata" src={`fp-media://asset/${encodeURIComponent(asset.id)}`}
    onLoadedMetadata={e => {const d = e.currentTarget.duration; if (Number.isFinite(d)) void api.assetDuration(asset.id, d).catch(() => {});}} />;
}

function Row({asset, index, count, busy, api, act, onEdit}: {asset: Asset; index?: number; count?: number; busy: boolean; api: API;
  act: (action: () => Promise<unknown>) => Promise<void>; onEdit: () => void}) {
  const segments = asset.segments ?? [];
  const keptTime = segments.reduce((s, x) => s + x.end - x.start, 0);
  const meta = [labels[asset.kind], asset.duration ? shortTime(asset.duration) : null,
    segments.length ? `${segments.length} trecho${segments.length > 1 ? 's' : ''} · ${shortTime(keptTime)}` : null].filter(Boolean).join(' · ');
  return <li className={asset.kind === 'main' ? 'main' : ''}>
    {index !== undefined ? <span className="order">{index + 1}</span> : <span className="kind-icon"><Svg name={kindIcon(asset.kind)} /></span>}
    <div className="asset-info" title={`${asset.name}\n${asset.note}`}>
      <div className="asset-name">{asset.name}</div>
      <small>{meta}</small>
      {segments.length > 0 && asset.duration && <div className="mini-timeline" aria-hidden="true">{segments.map((s, i) => <i key={i} style={{left: `${s.start / asset.duration! * 100}%`, width: `${(s.end - s.start) / asset.duration! * 100}%`}} />)}</div>}
    </div>
    <div className="asset-actions">
      {index !== undefined && count! > 1 && <span className="reorder">
        <button disabled={busy || index === 0} aria-label="Mover para cima" onClick={() => void act(() => api.moveAsset(asset.id, -1))}><Svg name="up" /></button>
        <button disabled={busy || index === count! - 1} aria-label="Mover para baixo" onClick={() => void act(() => api.moveAsset(asset.id, 1))}><Svg name="down" /></button>
      </span>}
      <button disabled={busy} aria-label={isVideo(asset) ? 'Editar recortes' : 'Editar'} title={isVideo(asset) ? 'Editar recortes' : 'Editar descrição'} onClick={onEdit}><Svg name={isVideo(asset) ? 'trim' : 'edit'} /></button>
      <button disabled={busy} className="remove" aria-label="Remover" title="Remover do projeto" onClick={() => void act(() => api.removeAsset(asset.id))}>−</button>
    </div>
    {isVideo(asset) && !asset.duration && <DurationProbe asset={asset} api={api} />}
  </li>;
}

export function AssetList({assets, busy, api, act, onEdit}: {assets: Asset[]; busy: boolean; api: API;
  act: (action: () => Promise<unknown>) => Promise<void>; onEdit: (asset: Asset) => void}) {
  const mains = assets.filter(a => a.kind === 'main');
  const others = assets.filter(a => a.kind !== 'main');
  return <>
    {mains.length > 0 && <><h4 className="asset-group">Vídeo principal{mains.length > 1 && <small>ordem de reprodução</small>}</h4>
      <ul className="asset-list">{mains.map((a, i) => <Row key={a.id} asset={a} index={i} count={mains.length} busy={busy} api={api} act={act} onEdit={() => onEdit(a)} />)}</ul></>}
    {others.length > 0 && <><h4 className="asset-group">Assets</h4>
      <ul className="asset-list">{others.map(a => <Row key={a.id} asset={a} busy={busy} api={api} act={act} onEdit={() => onEdit(a)} />)}</ul></>}
  </>;
}

export function NoteEditor({asset, busy, onSave, onClose}: {asset: Asset; busy: boolean; onSave: (patch: AssetPatch) => void; onClose: () => void}) {
  const [note, setNote] = useState(asset.note);
  return <div className="overlay"><section className="modal" role="dialog" aria-modal="true" aria-label="Editar arquivo">
    <h2>{labels[asset.kind]}</h2><p className="path">{asset.name}</p>
    <form onSubmit={e => {e.preventDefault(); onSave({note});}}>
      <label>Como usar<textarea rows={4} value={note} onChange={e => setNote(e.target.value)} /></label>
      <button disabled={busy}>Salvar</button>
    </form>
    <button className="close" onClick={onClose}>Fechar</button>
  </section></div>;
}
