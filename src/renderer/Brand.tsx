import React, {useEffect, useMemo, useState} from 'react';
import type {API, BrandDetail, BrandInput, BrandKit, BrandPatch, Brief, ProjectSummary} from '../shared/types';
import {Button, EmptyState, Icon, IconButton, Menu, MenuItem} from './ui';
import {Select} from './Select';

/** Marcas são as pastas de identidade; os assets do kit são servidos por fp-media://brand/<id>/<chave>. */
export const assetUrl = (brandId: string, key: string, version: number) =>
  `fp-media://brand/${encodeURIComponent(brandId)}/${encodeURIComponent(key)}?v=${version}`;
const ratio = (width: number, height: number) =>
  width === height ? '1:1' : width > height ? '16:9' : '9:16';
export const formatLabel = (width: number, height: number) => `${ratio(width, height)} · ${width}×${height}`;

/** Logo da marca no cabeçalho da seção, com a cor da marca como fundo quando não há logo. */
export function BrandMarkTile({brand, size = 32}: {brand: BrandDetail; size?: number}) {
  const logo = brand.kit.assets.logo ?? brand.kit.assets['logo-light'];
  const key = brand.kit.assets.logo ? 'logo' : 'logo-light';
  return <span className="kit-tile" style={{width: size, height: size, background: brand.kit.colors.background, borderColor: brand.kit.colors.primary}}>
    {logo && !logo.local
      ? <img src={assetUrl(brand.kit.id, key, brand.kit.version)} alt="" />
      : <span style={{color: brand.kit.colors.primary, fontWeight: 600, fontSize: size * .45}}>{brand.kit.name.slice(0, 2).toUpperCase()}</span>}
  </span>;
}

function ProjectCard({summary, brand, busy, onOpen, onMove}: {
  summary: ProjectSummary; brand?: BrandDetail; busy: boolean; onOpen: () => void; onMove: () => void;
}) {
  return <li className="project-item">
    <button className="project-card" disabled={busy} title={summary.root} onClick={onOpen}>
      <strong>{summary.name}</strong>
      <span className="chips">
        {brand && <span className="chip" style={{borderColor: brand.kit.colors.primary, color: brand.kit.colors.primary}}>{brand.kit.name}</span>}
        <span className="chip">{formatLabel(summary.width, summary.height)}</span>
        {summary.brandLock !== undefined && <span className="chip" title={`Congelado na versão ${summary.brandLock} da marca, pelo último export.`}>Marca v{summary.brandLock}</span>}
      </span>
      <small className="project-meta">
        {summary.messages ? `${summary.messages} mensagem(ns)${summary.hasSession ? ' · conversa ativa' : ''}` : 'Sem pedidos ainda'}
        {' · '}{new Date(summary.updatedAt).toLocaleString('pt-BR', {dateStyle: 'short', timeStyle: 'short'})}
      </small>
    </button>
    <Menu align="end" trigger={props => <IconButton {...props} className="project-menu" label={`Ações de ${summary.name}`} icon="more" disabled={busy} />}>
      {close => <><MenuItem icon="folder" onClick={() => {close(); onMove();}} hint="Herda identidade, assets e componentes">Mover para outra marca…</MenuItem></>}
    </Menu>
  </li>;
}

/** Home: projetos agrupados por marca em seções recolhíveis, mais "Avulsos". */
export function BrandLibrary({state, busy, onOpen, onMove, onBrand, onNewBrand}: {
  state: {projects: ProjectSummary[]; brands: BrandDetail[]; library: string};
  busy: boolean; onOpen: (root: string) => void; onMove: (summary: ProjectSummary) => void;
  onBrand: (id: string) => void; onNewBrand: () => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const loose = state.projects.filter(p => !p.brandId);
  const groups = [
    ...state.brands.map(brand => ({key: brand.kit.id, brand, items: state.projects.filter(p => p.brandId === brand.kit.id)})),
    ...(loose.length ? [{key: '', brand: undefined, items: loose}] : [])
  ];
  return <>{groups.map(group => {
    const open = !collapsed[group.key];
    const {brand} = group;
    return <section className="kit-group" key={group.key || 'loose'}>
      <header className="kit-group-head" style={brand ? {borderColor: brand.kit.colors.primary + '55'} : undefined}>
        <button className="kit-group-toggle" aria-expanded={open} onClick={() => setCollapsed(c => ({...c, [group.key]: open}))}>
          <Icon name={open ? 'down' : 'back'} />
          {brand ? <BrandMarkTile brand={brand} /> : <span className="kit-tile kit-tile-loose"><Icon name="folder" /></span>}
          <span className="kit-group-name">
            <strong>{brand ? brand.kit.name : 'Avulsos'}</strong>
            <small>{brand
              ? `${group.items.length} projeto(s) · versão ${brand.kit.version} · ${Object.keys(brand.kit.assets).length} asset(s)`
              : `${group.items.length} projeto(s) sem marca`}</small>
          </span>
        </button>
        {brand && <Button variant="ghost" icon="sliders" disabled={busy} onClick={() => onBrand(brand.kit.id)}>Abrir marca</Button>}
      </header>
      {open && (group.items.length
        ? <ul className="project-grid">{group.items.map(summary =>
          <ProjectCard key={summary.root} summary={summary} brand={brand} busy={busy}
            onOpen={() => onOpen(summary.root)} onMove={() => onMove(summary)} />)}</ul>
        : <p className="kit-group-empty">Nenhum projeto nesta marca ainda.</p>)}
    </section>;
  })}
  {!state.brands.length && <section className="kit-group kit-group-cta">
    <div><strong>Agrupe seus projetos por marca</strong>
      <small>Uma marca guarda a logo, as cores, as fontes e os componentes. Todo projeto criado nela herda isso automaticamente.</small></div>
    <Button icon="plus" disabled={busy} onClick={onNewBrand}>Nova marca</Button>
  </section>}
  </>;
}

const DEFAULT_COLORS = {primary: '#f5f5f5', secondary: '#9a9a9a', background: '#0a0a0a', text: '#fafafa'};
const COLOR_LABELS: Record<string, string> = {primary: 'Primária (destaque)', secondary: 'Secundária', background: 'Fundo', text: 'Texto'};
const FORMATS = [{value: '1080x1920', label: 'Vertical 9:16'}, {value: '1920x1080', label: 'Horizontal 16:9'}, {value: '1080x1080', label: 'Quadrado 1:1'}];

function ColorFields({colors, onChange}: {colors: Record<string, string>; onChange: (next: Record<string, string>) => void}) {
  return <div className="color-grid">{Object.keys(DEFAULT_COLORS).map(key =>
    <label className="field color-field" key={key}>{COLOR_LABELS[key]}
      <span className="color-input">
        <input type="color" value={colors[key] ?? DEFAULT_COLORS[key as keyof typeof DEFAULT_COLORS]} onChange={e => onChange({...colors, [key]: e.target.value})} />
        <input className="color-hex" value={colors[key] ?? ''} placeholder={DEFAULT_COLORS[key as keyof typeof DEFAULT_COLORS]}
          onChange={e => onChange({...colors, [key]: e.target.value})} spellCheck={false} />
      </span>
    </label>)}</div>;
}

/** Nova marca: nome, cores, formato padrão e a logo (importada logo após criar). */
export function NewBrandDialog({api, act, busy, onClose}: {
  api: API; act: (action: () => Promise<unknown>) => Promise<unknown>; busy: boolean; onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [colors, setColors] = useState<Record<string, string>>({...DEFAULT_COLORS});
  const [format, setFormat] = useState('1080x1920');
  const [guide, setGuide] = useState('');
  const [logo, setLogo] = useState('');
  const id = useMemo(() => name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40), [name]);
  const submit = () => {
    const [width, height] = format.split('x').map(Number);
    const input: BrandInput = {name, colors, defaults: {width, height, fps: 30, durationInSeconds: 30}, guide};
    void act(async () => {
      await api.createBrand(input);
      // A logo entra depois de a pasta existir, já pela chave brand:logo.
      if (logo) await api.putBrandAsset(id, 'logo', 'Logo principal', logo);
      onClose();
    });
  };
  return <div className="overlay"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="brand-title">
    <h2 id="brand-title">Nova marca</h2>
    <p className="modal-note">A marca guarda a identidade visual e os assets globais. Todo projeto criado dentro dela herda tudo isso.</p>
    <form onSubmit={e => {e.preventDefault(); submit();}}>
      <label className="field">Nome<input required maxLength={120} value={name} onChange={e => setName(e.target.value)} autoFocus placeholder="JA" /></label>
      {id && <small className="path">Pasta: {id}</small>}
      <ColorFields colors={colors} onChange={setColors} />
      <label className="field">Formato padrão dos vídeos
        <Select label="Formato padrão" value={format} onChange={setFormat} options={FORMATS} /></label>
      <label className="field">Logo principal (vira <code>brand:logo</code>)
        <div className="row">
          <Button icon="upload" disabled={busy} onClick={() => void act(async () => {
            const paths = await api.pickFiles();
            if (paths.length) setLogo(paths[0]);
          })}>{logo ? 'Trocar arquivo' : 'Escolher arquivo'}</Button>
          {logo && <small className="path">{logo.split(/[\\/]/).pop()}</small>}
        </div>
      </label>
      <label className="field">Guia da marca (tom, regras da logo, o que evitar)
        <textarea rows={4} value={guide} onChange={e => setGuide(e.target.value)}
          placeholder="Deixe em branco para começar com um modelo que você edita depois." /></label>
      <div className="row"><Button type="submit" variant="primary" disabled={busy || !id}>Criar marca</Button>
        <Button variant="ghost" onClick={onClose}>Fechar</Button></div>
    </form>
  </section></div>;
}

/** Página da marca: kit com previews e chaves, cores, fontes, componentes e os projetos. */
export function BrandPage({brand, projects, api, act, busy, onBack, onOpenProject, onNewProject}: {
  brand: BrandDetail; projects: ProjectSummary[]; api: API; act: (action: () => Promise<unknown>) => Promise<unknown>;
  busy: boolean; onBack: () => void; onOpenProject: (root: string) => void; onNewProject: () => void;
}) {
  const {kit} = brand;
  const [colors, setColors] = useState<Record<string, string>>({...kit.colors});
  const [guide, setGuide] = useState(brand.guide);
  const [fonts, setFonts] = useState(kit.fonts);
  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');
  // A marca pode mudar por baixo (push de outro projeto): refaz o formulário quando a versão sobe.
  useEffect(() => {setColors({...kit.colors}); setFonts(kit.fonts); setGuide(brand.guide);}, [kit.version, brand.guide]);
  const dirty = JSON.stringify(colors) !== JSON.stringify(kit.colors) || guide !== brand.guide
    || JSON.stringify(fonts) !== JSON.stringify(kit.fonts);
  const save = () => void act(() => api.updateBrand(kit.id, {colors, fonts, guide} as BrandPatch));
  const assets = Object.entries(kit.assets);
  const fontRoles = Object.keys(fonts).length ? Object.keys(fonts) : ['heading', 'body'];
  return <main className="library brand-page">
    <div className="library-head">
      <div className="row">
        <Button variant="ghost" icon="back" onClick={onBack}>Projetos</Button>
        <BrandMarkTile brand={brand} size={40} />
        <div><h2>{kit.name}</h2><small className="path">{brand.root} · versão {kit.version}</small></div>
      </div>
      <Button icon="plus" disabled={busy} onClick={onNewProject}>Novo projeto desta marca</Button>
    </div>

    <section className="settings-card">
      <h2>Assets globais</h2>
      <p>Os projetos usam a <strong>chave</strong>, nunca o caminho. Substituir o arquivo mantém a chave e atualiza todos os projetos da marca em edição.</p>
      {assets.length ? <ul className="kit-assets">{assets.map(([key, asset]) => <li key={key}>
        <span className="kit-preview" style={{background: kit.colors.background}}>
          {asset.kind === 'image' && !asset.local
            ? <img src={assetUrl(kit.id, key, kit.version)} alt="" />
            : <Icon name={asset.kind === 'audio' ? 'audio' : asset.kind === 'video' ? 'video' : asset.kind === 'font' ? 'file' : 'image'} size={20} />}
        </span>
        <span className="kit-asset-info">
          <code className="kit-key">brand:{key}</code>
          <small>{asset.label} · {asset.file}</small>
        </span>
        <span className="row">
          <Button variant="ghost" icon="upload" disabled={busy}
            onClick={() => void act(() => api.putBrandAsset(kit.id, key, asset.label))}>Substituir</Button>
          <IconButton label={`Remover brand:${key}`} icon="trash" disabled={busy}
            onClick={() => void act(() => api.removeBrandAsset(kit.id, key))} />
        </span>
      </li>)}</ul> : <EmptyState icon="image" title="Nenhum asset ainda">
        <p>Adicione a logo com a chave <code>logo</code> para que os projetos possam usar <code>brand:logo</code>.</p></EmptyState>}
      <div className="kit-add">
        <label className="field">Chave<input value={newKey} onChange={e => setNewKey(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
          placeholder="logo-light" maxLength={41} spellCheck={false} /></label>
        <label className="field">Rótulo<input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="Logo para fundo escuro" maxLength={200} /></label>
        <Button icon="plus" disabled={busy || !newKey} onClick={() => void act(async () => {
          await api.putBrandAsset(kit.id, newKey, newLabel || newKey);
          setNewKey(''); setNewLabel('');
        })}>Adicionar asset</Button>
      </div>
    </section>

    <section className="settings-card">
      <h2>Cores e tipografia</h2>
      <p>Chegam aos componentes por <code>useBrand()</code>. A IA é instruída a usar os tokens em vez de escrever hex.</p>
      <ColorFields colors={colors} onChange={setColors} />
      {fontRoles.map(role => <div className="font-row" key={role}>
        <label className="field">Fonte: {role === 'heading' ? 'títulos' : role === 'body' ? 'corpo' : role}
          <input value={fonts[role]?.family ?? ''} placeholder="Inter" spellCheck={false}
            onChange={e => setFonts({...fonts, [role]: {...fonts[role], family: e.target.value}})} /></label>
        <label className="field">Peso
          <input value={fonts[role]?.weight ?? ''} placeholder="700" spellCheck={false}
            onChange={e => setFonts({...fonts, [role]: {...fonts[role], family: fonts[role]?.family ?? '', weight: e.target.value}})} /></label>
        <label className="field">Arquivo da fonte
          <Select label={`Arquivo da fonte ${role}`} value={fonts[role]?.asset ?? ''} placeholder="Fonte do sistema"
            onChange={value => setFonts({...fonts, [role]: {...fonts[role], family: fonts[role]?.family ?? '', asset: value || undefined}})}
            options={[{value: '', label: 'Fonte do sistema'}, ...assets.filter(([, a]) => a.kind === 'font').map(([key]) => ({value: key, label: `brand:${key}`}))]} /></label>
      </div>)}
      <p><small>Fontes com arquivo são carregadas antes do primeiro frame, então não há troca de fonte no frame 0.</small></p>
    </section>

    <section className="settings-card">
      <h2>Guia da marca (BRAND.md)</h2>
      <p>Lido pela IA antes de cada edição: tom, regras de uso da logo e o que evitar.</p>
      <label className="field"><textarea rows={10} value={guide} onChange={e => setGuide(e.target.value)} /></label>
      <div className="row">
        <Button variant="primary" disabled={busy || !dirty} onClick={save}>Salvar alterações</Button>
        {dirty && <small>Salvar incrementa a versão da marca e aplica em todos os projetos em edição.</small>}
      </div>
    </section>

    <section className="settings-card">
      <h2>Componentes reutilizáveis</h2>
      <p>Arquivos <code>.tsx</code> em <code>brand/components/</code> chegam a cada projeto em <code>remotion/src/brand-components/</code>
        {' '}e são importados com <code>import {'{Intro}'} from './brand-components/Intro'</code>.</p>
      <code className="path">{brand.root}\brand\components</code>
      <div className="row"><Button variant="ghost" icon="folder" onClick={() => void act(api.showLibrary)}>Abrir pasta da biblioteca</Button></div>
    </section>

    <section className="settings-card">
      <h2>Projetos desta marca</h2>
      {projects.length ? <ul className="project-grid">{projects.map(summary =>
        <li key={summary.root}><button className="project-card" disabled={busy} title={summary.root} onClick={() => onOpenProject(summary.root)}>
          <strong>{summary.name}</strong>
          <span className="chips"><span className="chip">{formatLabel(summary.width, summary.height)}</span>
            {summary.brandLock !== undefined && <span className="chip">Marca v{summary.brandLock}</span>}</span>
          <small className="project-meta">Editado {new Date(summary.updatedAt).toLocaleString('pt-BR', {dateStyle: 'short', timeStyle: 'short'})}</small>
        </button></li>)}</ul>
        : <p>Nenhum projeto ainda. Crie o primeiro acima.</p>}
    </section>
  </main>;
}

/** Novo projeto: primeiro a marca, depois o template, com os defaults já preenchidos. */
export function NewProjectDialog({brands, initialBrand, defaults, api, act, busy, onClose}: {
  brands: BrandDetail[]; initialBrand?: string; defaults: Brief; api: API;
  act: (action: () => Promise<unknown>) => Promise<unknown>; busy: boolean; onClose: () => void;
}) {
  const [step, setStep] = useState<'brand' | 'brief'>(brands.length ? 'brand' : 'brief');
  const [brandId, setBrandId] = useState(initialBrand ?? '');
  const [brief, setBrief] = useState<Brief>(defaults);
  const brand = brands.find(b => b.kit.id === brandId);
  const choose = (id: string, template?: BrandKit['templates'][number]) => {
    const kit = brands.find(b => b.kit.id === id)?.kit;
    setBrandId(id);
    // Defaults da marca (ou do template) já preenchidos; o usuário ainda pode editar tudo.
    setBrief(kit ? {...defaults, width: template?.width ?? kit.defaults.width, height: template?.height ?? kit.defaults.height,
      fps: template?.fps ?? kit.defaults.fps, duration: template?.duration ?? kit.defaults.durationInSeconds,
      style: template?.style || defaults.style} : defaults);
    setStep('brief');
  };
  return <div className="overlay"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="new-title">
    <h2 id="new-title">{step === 'brand' ? 'Novo projeto: escolha a marca' : brand ? `Novo projeto · ${brand.kit.name}` : 'Novo projeto de vídeo'}</h2>
    {step === 'brand' ? <>
      <p className="modal-note">O projeto nasce dentro da pasta da marca e herda logo, cores, fontes e componentes.</p>
      <ul className="brand-picker">
        {brands.map(b => <li key={b.kit.id}><button className="brand-option" disabled={busy} onClick={() => choose(b.kit.id)}>
          <BrandMarkTile brand={b} />
          <span><strong>{b.kit.name}</strong><small>{formatLabel(b.kit.defaults.width, b.kit.defaults.height)} · {Object.keys(b.kit.assets).length} asset(s)</small></span>
        </button></li>)}
        <li><button className="brand-option" disabled={busy} onClick={() => choose('')}>
          <span className="kit-tile kit-tile-loose"><Icon name="folder" /></span>
          <span><strong>Sem marca</strong><small>Projeto avulso, como antes</small></span>
        </button></li>
      </ul>
      <div className="row"><Button variant="ghost" onClick={onClose}>Fechar</Button></div>
    </> : <form onSubmit={e => {
      e.preventDefault();
      void act(async () => {await api.create(brief, brandId || undefined); onClose();});
    }}>
      {brand && brand.kit.templates.length > 0 && <label className="field">Template da marca
        <ul className="template-picker">{brand.kit.templates.map(t => {
          const active = brief.width === t.width && brief.height === t.height && Math.abs(brief.duration - t.duration) < .001;
          return <li key={t.id}><button type="button" className={`template-option ${active ? 'selected' : ''}`} onClick={() => choose(brandId, t)}>
            <strong>{t.name}</strong><small>{formatLabel(t.width, t.height)} · {t.duration}s</small>
            {t.description && <small>{t.description}</small>}
          </button></li>;
        })}</ul></label>}
      <label className="field">Nome<input required maxLength={200} value={brief.name} onChange={e => setBrief({...brief, name: e.target.value})} autoFocus /></label>
      <label className="field">Briefing / objetivo<textarea rows={3} value={brief.briefing} onChange={e => setBrief({...brief, briefing: e.target.value})}
        placeholder="Tipo de vídeo, público, mensagem, estrutura e resultado esperado" /></label>
      <label className="field">Formato
        <Select label="Formato do vídeo" placeholder="Escolher proporção (ou editar abaixo)"
          value={FORMATS.some(f => f.value === `${brief.width}x${brief.height}`) ? `${brief.width}x${brief.height}` : ''}
          onChange={value => {const [width, height] = value.split('x').map(Number); setBrief({...brief, width, height});}} options={FORMATS} /></label>
      <div className="numbers">{(['width', 'height', 'fps', 'duration'] as const).map((key, i) =>
        <label className="field" key={key}>{['Largura', 'Altura', 'FPS', 'Duração (s)'][i]}
          <input type="number" required min={key === 'duration' ? 0.1 : key === 'fps' ? 1 : 2} step={key === 'duration' || key === 'fps' ? 'any' : 2}
            value={brief[key]} onChange={e => setBrief({...brief, [key]: Number(e.target.value)})} /></label>)}</div>
      <label className="field">Estilo / direção visual<textarea rows={3} value={brief.style} onChange={e => setBrief({...brief, style: e.target.value})} /></label>
      <label className="field">Observações<textarea rows={2} value={brief.notes} onChange={e => setBrief({...brief, notes: e.target.value})} /></label>
      <div className="row"><Button type="submit" variant="primary" disabled={busy}>Criar projeto</Button>
        {brands.length > 0 && <Button variant="ghost" icon="back" onClick={() => setStep('brand')}>Trocar marca</Button>}
        <Button variant="ghost" onClick={onClose}>Fechar</Button></div>
    </form>}
  </section></div>;
}

/** Mover projeto entre marcas (ou para Avulsos). */
export function MoveProjectDialog({summary, brands, api, act, busy, onClose}: {
  summary: ProjectSummary; brands: BrandDetail[]; api: API;
  act: (action: () => Promise<unknown>) => Promise<unknown>; busy: boolean;
  /** `movedTo` é o id da marca de destino quando o projeto realmente se moveu. */
  onClose: (movedTo?: string) => void;
}) {
  const options = [...brands.filter(b => b.kit.id !== summary.brandId).map(b => ({value: b.kit.id, label: b.kit.name})),
    ...(summary.brandId ? [{value: '', label: 'Avulsos (sem marca)'}] : [])];
  return <div className="overlay"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="move-title">
    <h2 id="move-title">Mover "{summary.name}"</h2>
    <p className="modal-note">A pasta do projeto é movida; nada é apagado. {summary.brandId
      ? 'Ao sair da marca, o projeto perde os assets e componentes herdados — ajuste as referências depois.'
      : 'Ao entrar numa marca, o projeto passa a herdar logo, cores, fontes e componentes.'}</p>
    {options.length ? <ul className="brand-picker">{options.map(option => {
      const brand = brands.find(b => b.kit.id === option.value);
      return <li key={option.value || 'loose'}><button className="brand-option" disabled={busy}
        onClick={() => void act(async () => {await api.moveProject(summary.root, option.value); onClose(option.value || undefined);})}>
        {brand ? <BrandMarkTile brand={brand} /> : <span className="kit-tile kit-tile-loose"><Icon name="folder" /></span>}
        <span><strong>{option.label}</strong>{brand && <small>{Object.keys(brand.kit.assets).length} asset(s) herdados</small>}</span>
      </button></li>;
    })}</ul> : <p>Crie uma marca primeiro para poder mover projetos para ela.</p>}
    <div className="row"><Button variant="ghost" onClick={() => onClose()}>Fechar</Button></div>
  </section></div>;
}

/**
 * Depois de mover para uma marca: oferece trocar caminhos de logo hardcoded por brand:<chave>.
 * Nunca aplica nada sem o usuário marcar o arquivo.
 */
export function BrandKeysDialog({root, api, act, busy, onClose}: {
  root: string; api: API; act: (action: () => Promise<unknown>) => Promise<unknown>; busy: boolean; onClose: () => void;
}) {
  const [found, setFound] = useState<{file: string; line: number; text: string; key: string}[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    void api.brandCandidates(root).then(list => {if (active) {setFound(list); setPicked(list.map(c => c.file));}}, () => {if (active) setFound([]);});
    return () => {active = false;};
  }, [root, api]);
  if (found === null) return null;
  if (!found.length) return null;
  const files = [...new Set(found.map(c => c.file))];
  return <div className="overlay"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="keys-title">
    <h2 id="keys-title">Trocar caminhos por chaves da marca?</h2>
    <p className="modal-note">Encontrei referências que parecem apontar para assets desta marca. Trocar por <code>brand:&lt;chave&gt;</code> faz
      o projeto acompanhar a marca quando o arquivo mudar. Nada é alterado sem você marcar.</p>
    <ul className="candidate-list">{files.map(file => <li key={file}>
      <label className="check"><input type="checkbox" checked={picked.includes(file)}
        onChange={e => setPicked(p => e.target.checked ? [...p, file] : p.filter(f => f !== file))} />
        <span><code>{file}</code>{found.filter(c => c.file === file).map(c =>
          <small key={c.line}>linha {c.line} → <code>brand:{c.key}</code><br /><code className="candidate-code">{c.text}</code></small>)}</span></label>
    </li>)}</ul>
    <div className="row">
      <Button variant="primary" disabled={busy || !picked.length} onClick={() => void act(async () => {
        await api.applyBrandKeys(root, picked);
        onClose();
      })}>Trocar nos {picked.length} arquivo(s)</Button>
      <Button variant="ghost" onClick={onClose}>Deixar como está</Button>
    </div>
  </section></div>;
}

/** Barra de marca dentro do projeto aberto: identidade herdada e estado do snapshot. */
export function BrandBar({brand, locked, api, act, busy}: {
  brand: BrandDetail; locked?: {version: number; at: string}; api: API;
  act: (action: () => Promise<unknown>) => Promise<unknown>; busy: boolean;
}) {
  return <div className="brand-bar" style={{borderColor: brand.kit.colors.primary + '55'}}>
    <BrandMarkTile brand={brand} size={24} />
    <span className="brand-bar-text">
      <strong>{brand.kit.name}</strong>
      <small>{locked
        ? `Congelado na versão ${locked.version} da marca (export de ${new Date(locked.at).toLocaleDateString('pt-BR')})`
        : `Acompanhando a marca ao vivo · versão ${brand.kit.version}`}</small>
    </span>
    {locked && <Button variant="ghost" icon="resend" disabled={busy} onClick={() => void act(api.refreshBrand)}>Atualizar para a marca atual</Button>}
  </div>;
}
