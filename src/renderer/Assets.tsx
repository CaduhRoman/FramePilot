import React, {useEffect, useState} from 'react';
import type {API, Asset, AssetKind, AssetPatch, Project} from '../shared/types';
import {shortTime} from './Trimmer';
import {Select} from './Select';
import {Button, Icon, IconButton, MiddleTruncate, Section, type IconName} from './ui';

export const labels: Record<AssetKind, string> = {main: 'Vídeo principal', logo: 'Logo', image: 'Imagem', video: 'Vídeo', audio: 'Áudio / trilha', font: 'Fonte', reference: 'Referência visual', document: 'Identidade / documento'};
const isVideo = (a: Asset) => a.kind === 'main' || a.kind === 'video';
type Act = (action: () => Promise<unknown>) => Promise<void>;

const GROUPS: {title: string; icon: IconName; kinds: AssetKind[]}[] = [
  {title: 'Vídeo', icon: 'video', kinds: ['main', 'video']},
  {title: 'Áudio', icon: 'audio', kinds: ['audio']},
  {title: 'Imagem', icon: 'image', kinds: ['image', 'logo']},
  {title: 'Referência', icon: 'file', kinds: ['reference', 'document', 'font']}
];
const PLACEHOLDERS: Record<AssetKind, string> = {
  main: 'Ex.: entrevista principal; manter só as melhores respostas',
  video: 'Ex.: b-roll para cobrir os cortes da fala',
  audio: 'Ex.: música de fundo, baixa durante as falas',
  logo: 'Ex.: logo principal na cartela final',
  image: 'Ex.: foto do produto na abertura',
  font: 'Ex.: fonte dos títulos',
  reference: 'Ex.: referência de estilo e ritmo',
  document: 'Ex.: guia da marca com cores e tom'
};
const EXT: [RegExp, AssetKind][] = [
  [/\.(mp4|mov|m4v|webm|mkv|avi)$/i, 'video'], [/\.(mp3|wav|m4a|aac|ogg|flac)$/i, 'audio'],
  [/\.(png|jpe?g|webp|gif|svg|avif)$/i, 'image'], [/\.(ttf|otf|woff2?)$/i, 'font'], [/\.(pdf|docx?|txt|md)$/i, 'document']
];
/** A first guess from the extension; the user confirms the type before importing. */
export function guessKind(paths: string[], hasMain: boolean): AssetKind {
  const kind = EXT.find(([re]) => re.test(paths[0] ?? ''))?.[1] ?? 'reference';
  return kind === 'video' && !hasMain ? 'main' : kind;
}
const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const shortPath = (p: string) => {const parts = p.split(/[\\/]/).filter(Boolean); return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : p;};

function Thumb({asset, api, order}: {asset: Asset; api: API; order?: number}) {
  const [failed, setFailed] = useState(false);
  const src = `fp-media://asset/${encodeURIComponent(asset.id)}`;
  const icon: IconName = isVideo(asset) ? 'video' : asset.kind === 'audio' ? 'audio' : asset.kind === 'image' || asset.kind === 'logo' ? 'image' : 'file';
  return <span className={`thumb kind-${icon}`}>
    {!failed && isVideo(asset) ? <video src={`${src}#t=0.5`} preload="metadata" muted onError={() => setFailed(true)}
      // Also fills in the duration of videos imported before FFmpeg was available.
      onLoadedMetadata={e => {const d = e.currentTarget.duration; if (!asset.duration && Number.isFinite(d)) void api.assetDuration(asset.id, d).catch(() => {});}} />
      : !failed && (asset.kind === 'image' || asset.kind === 'logo') ? <img src={src} alt="" onError={() => setFailed(true)} />
      : <Icon name={icon} size={20} />}
    {order !== undefined && <span className="order" aria-label={`Posição ${order + 1}`}>{order + 1}</span>}
  </span>;
}

function Row({asset, index, count, busy, api, act, onEdit, pending, essential}: {asset: Asset; index?: number; count?: number; busy: boolean; api: API; pending: boolean; essential: boolean;
  act: Act; onEdit: () => void}) {
  const segments = asset.segments ?? [];
  const keptTime = segments.reduce((s, x) => s + x.end - x.start, 0);
  const meta = [labels[asset.kind], asset.duration ? shortTime(asset.duration) : null,
    segments.length ? `${segments.length} trecho${segments.length > 1 ? 's' : ''} · ${shortTime(keptTime)}` : null].filter(Boolean).join(' · ');
  return <li className={`asset ${pending ? 'is-queued' : ''}`}>
    <Thumb asset={asset} api={api} order={index} />
    <div className="asset-info">
      <MiddleTruncate text={asset.name} />
      <small>{meta}</small>
      {pending && <small className="queued"><Icon name="resend" size={12} /> No próximo pedido</small>}
      {asset.note && <small className="asset-note" title={asset.note}>{asset.note}</small>}
      {segments.length > 0 && asset.duration && <div className="mini-timeline" aria-hidden="true">{segments.map((s, i) => <i key={i} style={{left: `${s.start / asset.duration! * 100}%`, width: `${(s.end - s.start) / asset.duration! * 100}%`}} />)}</div>}
    </div>
    <div className="asset-actions">
      <IconButton icon="resend" disabled={busy || pending} label={`Reenviar ${asset.name} à IA`} tooltip={pending ? 'Já está na fila do próximo pedido' : 'Reenviar à IA no próximo pedido'} onClick={() => void act(() => api.queueAsset(asset.id, true))} />
      <IconButton icon={essential ? 'starFilled' : 'star'} className={essential ? 'is-on' : ''} aria-pressed={essential} disabled={busy}
        label={`${essential ? 'Remover dos favoritos' : 'Favoritar'} ${asset.name}`} tooltip={essential ? 'Favorito: lembrado em novas sessões. Clique para remover.' : 'Favoritar (lembrar em novas sessões)'}
        onClick={() => void act(() => api.essentialAsset(asset.id, !essential))} />
      <IconButton icon={isVideo(asset) ? 'trim' : 'edit'} disabled={busy} label={`${isVideo(asset) ? 'Editar recortes de' : 'Editar descrição de'} ${asset.name}`} tooltip={isVideo(asset) ? 'Editar recortes e descrição' : 'Editar descrição'} onClick={onEdit} />
      {index !== undefined && count! > 1 && <>
        <IconButton icon="up" disabled={busy || index === 0} label={`Mover ${asset.name} para cima`} tooltip="Mover para cima" onClick={() => void act(() => api.moveAsset(asset.id, -1))} />
        <IconButton icon="down" disabled={busy || index === count! - 1} label={`Mover ${asset.name} para baixo`} tooltip="Mover para baixo" onClick={() => void act(() => api.moveAsset(asset.id, 1))} />
      </>}
      <IconButton icon="trash" className="remove" disabled={busy} label={`Remover ${asset.name}`} tooltip="Remover do projeto (pede confirmação)" onClick={() => void act(() => api.removeAsset(asset.id))} />
    </div>
  </li>;
}

/** Single place to add files: pick or drop, then confirm the type and how to use them. */
function AddFiles({files, setFiles, onPick, busy, hasMain, api, act}: {files: string[] | null; setFiles: (files: string[] | null) => void; onPick: () => void;
  busy: boolean; hasMain: boolean; api: API; act: Act}) {
  const [kind, setKind] = useState<AssetKind>('main');
  const [note, setNote] = useState('');
  const [over, setOver] = useState(false);
  useEffect(() => {if (files?.length) {setKind(guessKind(files, hasMain)); setNote('');}}, [files]);
  if (files?.length) return <form className="add-form" aria-label="Adicionar arquivos" onSubmit={e => {e.preventDefault(); void act(async () => {await api.importFiles(kind, note, files); setFiles(null);});}}>
    <p className="add-step">{files.length} arquivo{files.length > 1 ? 's' : ''} selecionado{files.length > 1 ? 's' : ''}</p>
    <ul className="file-list">{files.slice(0, 5).map(f => <li key={f}><Icon name="file" size={14} /><MiddleTruncate text={fileName(f)} /></li>)}{files.length > 5 && <li className="muted">e mais {files.length - 5}</li>}</ul>
    <label className="field">Tipo<Select label="Tipo de arquivo" value={kind} onChange={value => setKind(value as AssetKind)} options={Object.entries(labels).map(([value, label]) => ({value, label}))} /></label>
    <label className="field">Como usar<textarea rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder={PLACEHOLDERS[kind]} /></label>
    <div className="row"><Button type="submit" variant="primary" icon="plus" disabled={busy}>Adicionar</Button><Button variant="ghost" onClick={() => setFiles(null)}>Cancelar</Button></div>
  </form>;
  return <div className={`dropzone ${over ? 'is-over' : ''}`}
    onDragOver={e => {if (e.dataTransfer.types.includes('Files')) {e.preventDefault(); setOver(true);}}}
    onDragLeave={() => setOver(false)}
    onDrop={e => {
      e.preventDefault(); setOver(false);
      const paths = [...e.dataTransfer.files].map(f => api.pathForFile(f)).filter(Boolean);
      if (paths.length) setFiles(paths);
    }}>
    <Button icon="upload" disabled={busy} onClick={onPick}>Adicionar arquivos</Button>
    <small>ou arraste e solte aqui</small>
  </div>;
}

export function AssetsPanel({project, root, busy, api, act, onEdit, onSettings, importFiles, setImportFiles, onPick}: {
  project: Project; root: string; busy: boolean; api: API; act: Act; onEdit: (asset: Asset) => void; onSettings: () => void;
  importFiles: string[] | null; setImportFiles: (files: string[] | null) => void; onPick: () => void;
}) {
  const {brief, assets} = project;
  const pendingIds = project.pendingAssetIds ?? [];
  const essentialIds = project.essentialAssetIds ?? [];
  const mains = assets.filter(a => a.kind === 'main');
  return <aside className="assets-panel" aria-label="Projeto e assets">
    <Section title="Projeto">
      <p className="project-name">{brief.name}</p>
      <small className="path" title={root}>{shortPath(root)}</small>
      <small className="meta-line">{brief.width}×{brief.height} · {brief.fps} FPS · {brief.duration}s</small>
      <div className="row"><Button icon="sliders" disabled={busy} onClick={onSettings}>Configurações do projeto</Button>
        <IconButton icon="folder" label="Abrir pasta do projeto" onClick={() => void act(api.reveal)} /></div>
    </Section>
    <Section title="Assets" count={assets.length}>
      <AddFiles files={importFiles} setFiles={setImportFiles} onPick={onPick} busy={busy} hasMain={mains.length > 0} api={api} act={act} />
      <p className="help">Arquivos adicionados entram no próximo pedido.</p>
      {GROUPS.map(group => {
        const items = assets.filter(a => group.kinds.includes(a.kind));
        if (!items.length) return null;
        // Main videos keep their playback order and come first.
        const ordered = [...items.filter(a => a.kind === 'main'), ...items.filter(a => a.kind !== 'main')];
        return <div className="asset-group" key={group.title}>
          <h3><Icon name={group.icon} size={14} />{group.title}<span className="count">{items.length}</span></h3>
          <ul className="asset-list">{ordered.map(a => {
            const index = a.kind === 'main' ? mains.indexOf(a) : undefined;
            return <Row key={a.id} asset={a} index={index} count={mains.length} pending={pendingIds.includes(a.id)} essential={essentialIds.includes(a.id)} busy={busy} api={api} act={act} onEdit={() => onEdit(a)} />;
          })}</ul>
        </div>;
      })}
    </Section>
  </aside>;
}

export function NoteEditor({asset, busy, onSave, onClose}: {asset: Asset; busy: boolean; onSave: (patch: AssetPatch) => void; onClose: () => void}) {
  const [note, setNote] = useState(asset.note);
  return <div className="overlay"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="note-title">
    <h2 id="note-title">{labels[asset.kind]}</h2><p className="path">{asset.name}</p>
    <form onSubmit={e => {e.preventDefault(); onSave({note});}}>
      <label className="field">Como usar<textarea rows={4} value={note} onChange={e => setNote(e.target.value)} autoFocus /></label>
      <div className="row"><Button type="submit" variant="primary" disabled={busy}>Salvar</Button><Button variant="ghost" onClick={onClose}>Fechar</Button></div>
    </form>
  </section></div>;
}
