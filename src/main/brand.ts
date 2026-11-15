import {promises as fs} from 'node:fs';
import path from 'node:path';
import type {
  BrandAsset, BrandAssetKind, BrandDetail, BrandFont, BrandInput, BrandKit, BrandPatch, Project, ProjectBrand
} from '../shared/types';

/** Chave estável de asset: é o contrato que os projetos usam (brand:logo). */
export const KEY = /^[a-z0-9][a-z0-9-]{0,40}$/;
/** Pasta, dentro de remotion/public, onde o kit da marca é espelhado. */
export const PUBLIC_DIR = 'brand';
/** Pasta, dentro de remotion/src, onde os componentes da marca são espelhados. */
export const COMPONENTS_DIR = 'brand-components';
/** Cópia congelada do kit usada por projetos exportados (re-render reproduz o vídeo antigo). */
export const SNAPSHOT_DIR = '.brand-snapshot';
const FONT_EXT = ['.woff2', '.woff', '.ttf', '.otf'];
const KIND_BY_EXT: Record<string, BrandAssetKind> = {
  '.svg': 'image', '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.avif': 'image', '.gif': 'image',
  '.mp4': 'video', '.mov': 'video', '.webm': 'video', '.m4v': 'video',
  '.mp3': 'audio', '.wav': 'audio', '.m4a': 'audio', '.aac': 'audio', '.ogg': 'audio', '.flac': 'audio',
  '.woff2': 'font', '.woff': 'font', '.ttf': 'font', '.otf': 'font'
};
export const assetKind = (file: string): BrandAssetKind => KIND_BY_EXT[path.extname(file).toLowerCase()] ?? 'other';

export const DEFAULT_COLORS = {primary: '#f5f5f5', secondary: '#9a9a9a', background: '#0a0a0a', text: '#fafafa'};
export const DEFAULT_DEFAULTS = {width: 1080, height: 1920, fps: 30, durationInSeconds: 30,
  safeArea: {top: 160, right: 64, bottom: 240, left: 64}};
const DEFAULT_TEMPLATES = [
  {id: 'reels', name: 'Reels / Shorts', description: 'Vertical 9:16, corte rápido, legenda grande.', width: 1080, height: 1920, fps: 30, duration: 30, style: ''},
  {id: 'apresentacao', name: 'Apresentação', description: 'Horizontal 16:9, ritmo calmo, lower thirds.', width: 1920, height: 1080, fps: 30, duration: 90, style: ''},
  {id: 'quadrado', name: 'Feed quadrado', description: 'Quadrado 1:1 para feed.', width: 1080, height: 1080, fps: 30, duration: 30, style: ''}
];

export const brandRoot = (library: string, id: string) => path.join(library, id);
export const kitDir = (library: string, id: string) => path.join(library, id, 'brand');
const kitFile = (library: string, id: string) => path.join(kitDir(library, id), 'brand.json');
const guideFile = (library: string, id: string) => path.join(kitDir(library, id), 'BRAND.md');

/** Mantém o id igual ao nome da pasta: o vínculo do projeto com a marca é o caminho no disco. */
export function brandId(name: string) {
  const id = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return KEY.test(id) ? id : '';
}
function inside(root: string, relative: string) {
  const file = path.resolve(root, relative);
  if (file !== path.resolve(root) && !file.startsWith(path.resolve(root) + path.sep)) throw new Error('Caminho de asset da marca inválido.');
  return file;
}
const color = (value: unknown, fallback: string) =>
  typeof value === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(value.trim()) ? value.trim() : fallback;
const positive = (value: unknown, fallback: number, max: number) =>
  Number.isFinite(value) && (value as number) > 0 && (value as number) <= max ? (value as number) : fallback;

export function validateKit(raw: any, id: string): BrandKit {
  if (!raw || typeof raw !== 'object') throw new Error('brand.json inválido.');
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 120) : id;
  const colors = {
    primary: color(raw.colors?.primary, DEFAULT_COLORS.primary),
    secondary: color(raw.colors?.secondary, DEFAULT_COLORS.secondary),
    background: color(raw.colors?.background, DEFAULT_COLORS.background),
    text: color(raw.colors?.text, DEFAULT_COLORS.text),
    ...(raw.colors?.accent ? {accent: color(raw.colors.accent, DEFAULT_COLORS.primary)} : {})
  };
  const fonts: Record<string, BrandFont> = {};
  for (const [role, value] of Object.entries(raw.fonts ?? {})) {
    if (!KEY.test(role) || !value || typeof value !== 'object') continue;
    const font = value as any;
    if (typeof font.family !== 'string' || !font.family.trim()) continue;
    fonts[role] = {family: font.family.trim().slice(0, 120),
      ...(typeof font.weight === 'string' ? {weight: font.weight.slice(0, 20)} : {}),
      ...(typeof font.asset === 'string' && KEY.test(font.asset) ? {asset: font.asset} : {})};
  }
  const safe = raw.defaults?.safeArea;
  const defaults = {
    width: Math.round(positive(raw.defaults?.width, DEFAULT_DEFAULTS.width, 7680)),
    height: Math.round(positive(raw.defaults?.height, DEFAULT_DEFAULTS.height, 7680)),
    fps: positive(raw.defaults?.fps, DEFAULT_DEFAULTS.fps, 120),
    durationInSeconds: positive(raw.defaults?.durationInSeconds, DEFAULT_DEFAULTS.durationInSeconds, 14400),
    safeArea: safe && typeof safe === 'object'
      ? {top: Math.max(0, Math.round(Number(safe.top) || 0)), right: Math.max(0, Math.round(Number(safe.right) || 0)),
        bottom: Math.max(0, Math.round(Number(safe.bottom) || 0)), left: Math.max(0, Math.round(Number(safe.left) || 0))}
      : DEFAULT_DEFAULTS.safeArea
  };
  const assets: Record<string, BrandAsset> = {};
  for (const [key, value] of Object.entries(raw.assets ?? {})) {
    if (!KEY.test(key) || !value || typeof value !== 'object') continue;
    const asset = value as any;
    if (typeof asset.file !== 'string' || !asset.file || path.isAbsolute(asset.file) || asset.file.includes('..')) continue;
    assets[key] = {file: asset.file.split(path.sep).join('/'), label: typeof asset.label === 'string' ? asset.label.slice(0, 200) : key,
      kind: KIND_BY_EXT[path.extname(asset.file).toLowerCase()] ?? 'other', ...(asset.local === true ? {local: true as const} : {})};
  }
  const templates = (Array.isArray(raw.templates) ? raw.templates : DEFAULT_TEMPLATES)
    .filter((t: any) => t && KEY.test(String(t.id ?? '')) && typeof t.name === 'string')
    .slice(0, 20)
    .map((t: any) => ({id: t.id, name: String(t.name).slice(0, 80), ...(t.description ? {description: String(t.description).slice(0, 300)} : {}),
      width: Math.round(positive(t.width, defaults.width, 7680)), height: Math.round(positive(t.height, defaults.height, 7680)),
      fps: positive(t.fps, defaults.fps, 120), duration: positive(t.duration, defaults.durationInSeconds, 14400),
      ...(typeof t.style === 'string' ? {style: t.style.slice(0, 2000)} : {})}));
  return {id, name, version: Math.max(1, Math.round(positive(raw.version, 1, 1e9))), colors, fonts, defaults, assets,
    templates: templates.length ? templates : DEFAULT_TEMPLATES};
}

export async function readKit(library: string, id: string): Promise<BrandKit> {
  if (!KEY.test(id)) throw new Error('Marca inválida.');
  return validateKit(JSON.parse(await fs.readFile(kitFile(library, id), 'utf8')), id);
}
export async function writeKit(library: string, kit: BrandKit) {
  const file = kitFile(library, kit.id);
  await fs.mkdir(path.dirname(file), {recursive: true});
  await fs.writeFile(file + '.tmp', JSON.stringify(kit, null, 2));
  await fs.rename(file + '.tmp', file);
}
export const readGuide = (library: string, id: string) => fs.readFile(guideFile(library, id), 'utf8').catch(() => '');

/** Marcas são as pastas da biblioteca que contêm brand/brand.json. */
export async function listBrands(library: string): Promise<BrandDetail[]> {
  let entries: import('node:fs').Dirent[];
  try {entries = await fs.readdir(library, {withFileTypes: true});} catch {return [];}
  const found = await Promise.all(entries.filter(e => e.isDirectory() && KEY.test(e.name)).map(async (e): Promise<BrandDetail | null> => {
    try {
      const kit = await readKit(library, e.name);
      return {root: brandRoot(library, e.name), kit, guide: await readGuide(library, e.name), projects: 0};
    } catch {return null;}
  }));
  return found.filter((b): b is BrandDetail => b !== null).sort((a, b) => a.kit.name.localeCompare(b.kit.name, 'pt-BR'));
}

const GUIDE_TEMPLATE = (name: string) => `# ${name} — guia da marca

Este arquivo é lido pela IA antes de editar qualquer vídeo desta marca.

## Tom e linguagem
Descreva aqui como a marca fala: direto ou institucional, formal ou próximo, o que nunca dizer.

## Uso da logo
- Use sempre \`brand:logo\` (ou \`brand:logo-light\` sobre fundo escuro). Nunca recrie a logo em texto.
- Respeite a área de respiro e a área segura definidas em \`brand.json\`.
- Não distorça, não recolora e não aplique sombra na logo.

## Cores e tipografia
Use os tokens de \`useBrand()\`. Não escreva hex nem nomes de fonte direto no código.

## O que evitar
Liste aqui o que está fora da marca: efeitos, trilhas, tipos de corte, assuntos.
`;

export async function createBrand(library: string, input: BrandInput): Promise<BrandDetail> {
  if (!input || typeof input.name !== 'string' || !input.name.trim()) throw new Error('Informe o nome da marca.');
  const id = brandId(input.name);
  if (!id) throw new Error('Nome de marca inválido: use letras ou números.');
  const root = brandRoot(library, id);
  try {
    await fs.access(root);
    throw new Error(`Já existe uma pasta "${id}" na biblioteca. Escolha outro nome.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  for (const dir of ['brand/assets', 'brand/fonts', 'brand/components', 'brand/templates']) {
    await fs.mkdir(path.join(root, dir), {recursive: true});
  }
  const kit = validateKit({name: input.name.trim(), version: 1, colors: input.colors, defaults: input.defaults,
    fonts: {}, assets: {}, templates: DEFAULT_TEMPLATES}, id);
  await writeKit(library, kit);
  await fs.writeFile(guideFile(library, id), (input.guide ?? '').trim() || GUIDE_TEMPLATE(kit.name));
  await writeBrandInstructions(library, kit);
  return {root, kit, guide: await readGuide(library, id), projects: 0};
}

export async function updateBrand(library: string, id: string, patch: BrandPatch): Promise<BrandKit> {
  const kit = await readKit(library, id);
  if (!patch || typeof patch !== 'object') throw new Error('Alteração inválida.');
  const next = validateKit({...kit,
    name: patch.name ?? kit.name,
    colors: {...kit.colors, ...(patch.colors ?? {})},
    fonts: patch.fonts ? {...patch.fonts} : kit.fonts,
    defaults: {...kit.defaults, ...(patch.defaults ?? {})},
    version: kit.version + 1
  }, id);
  await writeKit(library, next);
  if (typeof patch.guide === 'string') await fs.writeFile(guideFile(library, id), patch.guide.slice(0, 200_000));
  await writeBrandInstructions(library, next);
  return next;
}

/** Adiciona ou substitui o arquivo de uma chave. O nome no disco é a própria chave, então substituir é trivial. */
export async function putBrandAsset(library: string, id: string, key: string, label: string, source: string): Promise<BrandKit> {
  const kit = await readKit(library, id);
  if (!KEY.test(key)) throw new Error('Chave inválida: use letras minúsculas, números e hífen (ex.: logo-light).');
  if (typeof label !== 'string' || label.length > 200) throw new Error('Rótulo inválido.');
  const ext = path.extname(source).toLowerCase();
  if (!ext || ext.length > 10) throw new Error('Arquivo sem extensão reconhecida.');
  const kind = assetKind(source);
  const relative = `${FONT_EXT.includes(ext) ? 'fonts' : 'assets'}/${key}${ext}`;
  const dir = kitDir(library, id);
  const previous = kit.assets[key];
  if (previous && !previous.local && previous.file !== relative) await fs.rm(inside(dir, previous.file), {force: true});
  await fs.mkdir(path.dirname(inside(dir, relative)), {recursive: true});
  await fs.copyFile(source, inside(dir, relative));
  kit.assets[key] = {file: relative, label: label.trim() || previous?.label || key, kind};
  kit.version += 1;
  await writeKit(library, kit);
  await writeBrandInstructions(library, kit);
  return kit;
}

export async function removeBrandAsset(library: string, id: string, key: string): Promise<BrandKit> {
  const kit = await readKit(library, id);
  const asset = kit.assets[key];
  if (!asset) throw new Error('Asset não encontrado na marca.');
  if (!asset.local) await fs.rm(inside(kitDir(library, id), asset.file), {force: true});
  delete kit.assets[key];
  for (const [role, font] of Object.entries(kit.fonts)) if (font.asset === key) kit.fonts[role] = {...font, asset: undefined};
  kit.version += 1;
  await writeKit(library, kit);
  await writeBrandInstructions(library, kit);
  return kit;
}

/** Tokens e manifesto já mesclados com os `overrides` do projeto. */
export function resolveKit(kit: BrandKit, overrides?: ProjectBrand['overrides']): BrandKit {
  if (!overrides) return kit;
  const fonts = {...kit.fonts};
  for (const [role, font] of Object.entries(overrides.fonts ?? {})) {
    if (!KEY.test(role)) continue;
    const base = fonts[role];
    if (base) fonts[role] = {...base, ...font};
    else if (typeof font.family === 'string' && font.family) fonts[role] = {family: font.family, ...font} as BrandFont;
  }
  const assets = {...kit.assets};
  for (const [key, asset] of Object.entries(overrides.assets ?? {})) {
    if (!KEY.test(key) || !asset?.file || path.isAbsolute(asset.file) || asset.file.includes('..')) continue;
    assets[key] = {...asset, file: asset.file.split(path.sep).join('/'), kind: assetKind(asset.file),
      label: asset.label || assets[key]?.label || key};
  }
  return {...kit, colors: {...kit.colors, ...(overrides.colors ?? {})},
    defaults: {...kit.defaults, ...(overrides.defaults ?? {})}, fonts, assets};
}

/** O kit como os componentes Remotion o veem: todo `file` já é um caminho válido para staticFile(). */
export function publicKit(kit: BrandKit, lock?: ProjectBrand['lock']) {
  const file = (asset: BrandAsset) => asset.local ? asset.file : `${PUBLIC_DIR}/${asset.file}`;
  return {
    id: kit.id, name: kit.name, version: kit.version, locked: Boolean(lock),
    colors: kit.colors, defaults: kit.defaults,
    fonts: Object.fromEntries(Object.entries(kit.fonts).map(([role, font]) => {
      const asset = font.asset ? kit.assets[font.asset] : undefined;
      return [role, {family: font.family, ...(font.weight ? {weight: font.weight} : {}), ...(asset ? {file: file(asset)} : {})}];
    })),
    assets: Object.fromEntries(Object.entries(kit.assets).map(([key, asset]) =>
      [key, {file: file(asset), label: asset.label, kind: asset.kind}]))
  };
}

/** Copia source sobre dest, pulando o que já está igual e apagando o que sobrou. */
export async function mirror(source: string, dest: string): Promise<boolean> {
  let entries: import('node:fs').Dirent[];
  try {entries = await fs.readdir(source, {withFileTypes: true});} catch {return false;}
  await fs.mkdir(dest, {recursive: true});
  const keep = new Set<string>();
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    keep.add(entry.name);
    const from = path.join(source, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await mirror(from, to);
      continue;
    }
    if (!entry.isFile()) continue;
    const [a, b] = await Promise.all([fs.stat(from), fs.stat(to).catch(() => null)]);
    // mtime comparison is coarse on purpose: the kit is small and a needless copy is cheaper than a stale asset.
    if (b && b.size === a.size && Math.abs(b.mtimeMs - a.mtimeMs) < 2) continue;
    await fs.copyFile(from, to);
    await fs.utimes(to, a.atime, a.mtime);
  }
  for (const entry of await fs.readdir(dest, {withFileTypes: true})) {
    if (!keep.has(entry.name)) await fs.rm(path.join(dest, entry.name), {recursive: true, force: true});
  }
  return true;
}

/**
 * O módulo gerado em remotion/src/brand.tsx. É a única porta entre os projetos e a marca:
 * resolveAsset('brand:logo') e useBrand() leem brand-kit.json, que o FramePilot reescreve.
 */
export const BRAND_MODULE = `/**
 * Gerado pelo FramePilot a partir da marca. NÃO EDITE: é reescrito a cada abertura do projeto.
 * Use brand:<chave> / resolveAsset() para arquivos e useBrand() para cores, fontes e defaults.
 */
import React, {createContext, useContext, useMemo} from 'react';
import {continueRender, delayRender, staticFile} from 'remotion';
import kit from './brand-kit.json';

type Assets = typeof kit.assets;
export type BrandAssetKey = keyof Assets;
/** Aceita 'brand:logo' e 'logo'. */
export type BrandAssetRef = BrandAssetKey | \\\`brand:\\\${string}\\\` | string;

const assets: Record<string, {file: string; label: string; kind: string}> = kit.assets;

/** brand:<chave> → URL servida pelo Remotion, no preview e no render. */
export function resolveAsset(reference: BrandAssetRef): string {
  const key = String(reference).startsWith('brand:') ? String(reference).slice(6) : String(reference);
  const asset = assets[key];
  if (!asset) {
    throw new Error(
      \\\`Asset de marca desconhecido: "\\\${reference}". Chaves disponíveis: \\\${Object.keys(assets).map(k => 'brand:' + k).join(', ') || '(nenhuma)'}.\\\`
    );
  }
  return staticFile(asset.file);
}
/** Como resolveAsset, mas devolve null em vez de lançar (para assets opcionais). */
export function tryAsset(reference: BrandAssetRef): string | null {
  const key = String(reference).startsWith('brand:') ? String(reference).slice(6) : String(reference);
  return assets[key] ? staticFile(assets[key].file) : null;
}
export const brandAssets = () => Object.entries(assets).map(([key, a]) => ({key: 'brand:' + key, label: a.label, kind: a.kind}));

// As fontes da marca carregam antes do primeiro frame: delayRender segura o render até a fonte estar pronta,
// evitando o fallback de fonte no frame 0 tanto no preview quanto no MP4.
let fontsStarted = false;
function loadFonts() {
  if (fontsStarted || typeof document === 'undefined' || typeof FontFace === 'undefined') return;
  fontsStarted = true;
  for (const [role, font] of Object.entries(kit.fonts as Record<string, {family: string; weight?: string; file?: string}>)) {
    if (!font.file) continue;
    const handle = delayRender(\\\`Carregando fonte da marca (\\\${role}): \\\${font.family}\\\`);
    const face = new FontFace(font.family, \\\`url(\\\${staticFile(font.file)})\\\`, {weight: font.weight ?? 'normal'});
    face.load().then(
      loaded => {document.fonts.add(loaded); continueRender(handle);},
      () => continueRender(handle)
    );
  }
}
loadFonts();

export interface BrandValue {
  id: string;
  name: string;
  version: number;
  /** true quando o projeto está travado num snapshot da marca (vídeo já exportado). */
  locked: boolean;
  colors: typeof kit.colors;
  fonts: typeof kit.fonts;
  defaults: typeof kit.defaults;
  /** Fonte da verdade para arquivos: asset('brand:logo'). */
  asset: (reference: BrandAssetRef) => string;
  tryAsset: (reference: BrandAssetRef) => string | null;
}
export const brandValue: BrandValue = {
  id: kit.id, name: kit.name, version: kit.version, locked: kit.locked,
  colors: kit.colors, fonts: kit.fonts, defaults: kit.defaults, asset: resolveAsset, tryAsset
};
const BrandContext = createContext<BrandValue>(brandValue);
/** Opcional: useBrand() já funciona sem provider. Use para sobrescrever tokens num trecho do vídeo. */
export const BrandProvider: React.FC<{children: React.ReactNode; colors?: Partial<typeof kit.colors>}> = ({children, colors}) => {
  const value = useMemo(() => colors ? {...brandValue, colors: {...brandValue.colors, ...colors}} : brandValue, [colors]);
  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
};
export const useBrand = () => useContext(BrandContext);
export default brandValue;
`;

/**
 * A pasta da marca é sempre a pasta-mãe do projeto (<library>/<id>/<projeto>), então o vínculo
 * se verifica no próprio caminho: um projeto fora da pasta da marca é tratado como avulso.
 */
export function kitDirOf(root: string, project: Project): string | null {
  if (!project.brand) return null;
  const parent = path.dirname(root);
  if (path.basename(parent) !== project.brand.id) return null;
  return path.join(parent, 'brand');
}
export const libraryOf = (root: string) => path.dirname(path.dirname(root));

/** Espelha o kit no projeto e reescreve brand-kit.json + brand.tsx. Chamado ao abrir, ao dar preview e antes do render. */
export async function syncProjectBrand(root: string, project: Project): Promise<BrandKit | null> {
  const src = path.join(root, 'remotion/src');
  const publicDir = path.join(root, 'remotion/public', PUBLIC_DIR);
  const components = path.join(src, COMPONENTS_DIR);
  const live = kitDirOf(root, project);
  if (!live) {
    // Projeto avulso (ou retirado de uma marca): some com tudo o que a marca havia deixado.
    await Promise.all([
      fs.rm(publicDir, {recursive: true, force: true}),
      fs.rm(components, {recursive: true, force: true}),
      fs.rm(path.join(src, 'brand.tsx'), {force: true}),
      fs.rm(path.join(src, 'brand-kit.json'), {force: true})
    ]);
    return null;
  }
  // Travado: a origem é o snapshot gravado no export, para que o re-render reproduza o vídeo antigo.
  const origin = project.brand!.lock ? path.join(root, SNAPSHOT_DIR) : live;
  const raw = await fs.readFile(path.join(origin, 'brand.json'), 'utf8');
  const kit = resolveKit(validateKit(JSON.parse(raw), project.brand!.id), project.brand!.overrides);
  await mirror(origin, publicDir);
  await mirror(path.join(origin, 'components'), components);
  await fs.mkdir(src, {recursive: true});
  await fs.writeFile(path.join(src, 'brand-kit.json'), JSON.stringify(publicKit(kit, project.brand!.lock), null, 2));
  await fs.writeFile(path.join(src, 'brand.tsx'), BRAND_MODULE);
  return kit;
}

/** Congela a marca no projeto: o kit inteiro vai para .brand-snapshot/ e o projeto passa a ler de lá. */
export async function snapshotBrand(root: string, project: Project): Promise<number | null> {
  const live = kitDirOf(root, project);
  if (!live || !project.brand) return null;
  const kit = validateKit(JSON.parse(await fs.readFile(path.join(live, 'brand.json'), 'utf8')), project.brand.id);
  const target = path.join(root, SNAPSHOT_DIR);
  await mirror(live, target);
  await fs.writeFile(path.join(target, 'brand.json'), JSON.stringify(kit, null, 2));
  project.brand.lock = {version: kit.version, at: new Date().toISOString()};
  return kit.version;
}

/** Lê o kit vivo da marca de um projeto (ignora o lock); null em projetos avulsos. */
export async function projectKit(root: string, project: Project): Promise<{kit: BrandKit; guide: string} | null> {
  const live = kitDirOf(root, project);
  if (!live || !project.brand) return null;
  try {
    const kit = validateKit(JSON.parse(await fs.readFile(path.join(live, 'brand.json'), 'utf8')), project.brand.id);
    return {kit, guide: await fs.readFile(path.join(live, 'BRAND.md'), 'utf8').catch(() => '')};
  } catch {return null;}
}

/** Instruções da marca para a IA: CLAUDE.md da pasta da marca, que o Claude Code lê das pastas pai. */
export async function writeBrandInstructions(library: string, kit: BrandKit) {
  const file = path.join(brandRoot(library, kit.id), 'CLAUDE.md');
  const keys = Object.entries(kit.assets);
  await fs.writeFile(file, `# Marca: ${kit.name}

Todos os projetos de vídeo nesta pasta pertencem a esta marca e herdam sua identidade.
O guia completo está em @brand/BRAND.md — leia antes de editar.

## Regras não negociáveis
- Arquivos da marca SEMPRE por chave: \`resolveAsset('brand:logo')\` ou \`useBrand().asset('brand:logo')\`,
  importados de \`./brand\` (ou \`../brand\`) em remotion/src. NUNCA escreva o caminho do arquivo.
- Cores e fontes SEMPRE pelos tokens: \`const {colors, fonts} = useBrand()\`. NUNCA escreva hex nem nome de fonte.
- Componentes reutilizáveis da marca ficam em \`remotion/src/${COMPONENTS_DIR}/\` — prefira reusá-los a recriar intro, outro, lower third e legenda.
- \`remotion/src/brand.tsx\`, \`remotion/src/brand-kit.json\`, \`remotion/public/${PUBLIC_DIR}/\` e \`remotion/src/${COMPONENTS_DIR}/\`
  são gerados pelo FramePilot a partir da marca: não edite nem versione nada ali. Para mudar a identidade, o usuário edita a marca no app.

## Tokens desta marca (versão ${kit.version})
Cores: ${Object.entries(kit.colors).map(([k, v]) => `${k}=${v}`).join(', ')}
Fontes: ${Object.entries(kit.fonts).map(([role, f]) => `${role}="${f.family}"${f.weight ? ` (${f.weight})` : ''}`).join(', ') || '(nenhuma definida)'}
Formato padrão: ${kit.defaults.width}x${kit.defaults.height}, ${kit.defaults.fps} FPS, ${kit.defaults.durationInSeconds}s${kit.defaults.safeArea ? `; área segura: topo ${kit.defaults.safeArea.top}px, base ${kit.defaults.safeArea.bottom}px, laterais ${kit.defaults.safeArea.left}/${kit.defaults.safeArea.right}px` : ''}

## Assets globais disponíveis
${keys.length ? keys.map(([key, a]) => `- \`brand:${key}\` — ${a.label} (${a.kind})`).join('\n') : '- (nenhum ainda; o usuário adiciona na página da marca)'}

<!-- framepilot-brand -->
`);
}

/** O bloco de contexto da marca injetado no CONTEXT.md e no primeiro pedido da sessão. */
export function brandContext(kit: BrandKit, guide: string, lock?: ProjectBrand['lock'], overrides?: ProjectBrand['overrides']): string {
  const keys = Object.entries(kit.assets);
  return `Este projeto pertence à marca "${kit.name}" (id ${kit.id}, versão ${kit.version}${lock ? `, congelada no export de ${lock.at.slice(0, 10)}` : ''}).
Identidade, assets e componentes vêm da marca; não recrie nem hardcode nada disso.

Como usar (obrigatório):
- Arquivos: \`import {resolveAsset, useBrand} from './brand'\` (em remotion/src) e então \`resolveAsset('brand:<chave>')\`.
  Nunca escreva o caminho de um arquivo da marca; a chave é o contrato e sobrevive à troca do arquivo.
- Cores, fontes, área segura: \`const {colors, fonts, defaults} = useBrand()\`. Nunca escreva hex nem nome de fonte.
- As fontes da marca já são carregadas por ./brand antes do primeiro frame; basta usar \`fontFamily: fonts.heading.family\`.
- Componentes prontos da marca: remotion/src/${COMPONENTS_DIR}/ — reúse em vez de recriar intro, outro, lower third, legenda.
- remotion/src/brand.tsx, remotion/src/brand-kit.json, remotion/public/${PUBLIC_DIR}/ e remotion/src/${COMPONENTS_DIR}/ são gerados pelo app: não edite.

Tokens: cores ${Object.entries(kit.colors).map(([k, v]) => `${k}=${v}`).join(', ')}.
Fontes: ${Object.entries(kit.fonts).map(([role, f]) => `${role}="${f.family}"${f.weight ? ` ${f.weight}` : ''}`).join(', ') || '(nenhuma)'}.
Formato padrão da marca: ${kit.defaults.width}x${kit.defaults.height}, ${kit.defaults.fps} FPS${kit.defaults.safeArea ? `; área segura topo ${kit.defaults.safeArea.top}px / base ${kit.defaults.safeArea.bottom}px / laterais ${kit.defaults.safeArea.left}px e ${kit.defaults.safeArea.right}px` : ''}.
${overrides && Object.keys(overrides).length ? `Este projeto sobrescreve pontualmente: ${JSON.stringify(overrides)}. Os valores já vêm aplicados em useBrand().\n` : ''}
Assets globais (chave → o que é):
${keys.length ? keys.map(([key, a]) => `- brand:${key} — ${a.label} (${a.kind})`).join('\n') : '- (nenhum ainda)'}

Guia da marca (BRAND.md):
${guide.trim() || '(vazio)'}`;
}

/** Caminhos de logo escritos à mão que poderiam virar brand:<chave>. Sugestão: nunca aplicado sem o usuário confirmar. */
export async function brandCandidates(root: string, kit: BrandKit) {
  const dir = path.join(root, 'remotion/src');
  const found: {file: string; line: number; text: string; key: string}[] = [];
  const names = Object.keys(kit.assets);
  if (!names.length) return found;
  const walk = async (folder: string): Promise<void> => {
    for (const entry of await fs.readdir(folder, {withFileTypes: true}).catch(() => [])) {
      if (entry.name === COMPONENTS_DIR || entry.name === 'node_modules') continue;
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) {await walk(full); continue;}
      if (!/\.(tsx?|jsx?)$/.test(entry.name) || entry.name === 'brand.tsx') continue;
      const lines = (await fs.readFile(full, 'utf8')).split('\n');
      lines.forEach((text, index) => {
        const match = /staticFile\(\s*['"`]([^'"`]+)['"`]\s*\)/.exec(text);
        if (!match || match[1].startsWith(PUBLIC_DIR + '/')) return;
        const base = path.basename(match[1]).toLowerCase();
        // Só sugere quando o nome do arquivo aponta claramente para uma chave da marca.
        const key = names.find(k => base.includes(k)) ?? (/logo|marca|brand/.test(base) ? names.find(k => k === 'logo') : undefined);
        if (key) found.push({file: path.relative(root, full).split(path.sep).join('/'), line: index + 1, text: text.trim().slice(0, 200), key});
      });
    }
  };
  await walk(dir);
  return found;
}
/** Aplica as substituições nos arquivos que o usuário confirmou. */
export async function applyBrandKeys(root: string, kit: BrandKit, files: string[]) {
  const candidates = (await brandCandidates(root, kit)).filter(c => files.includes(c.file));
  const byFile = new Map<string, typeof candidates>();
  for (const c of candidates) byFile.set(c.file, [...(byFile.get(c.file) ?? []), c]);
  let changed = 0;
  for (const [relative, items] of byFile) {
    const file = path.join(root, relative);
    const lines = (await fs.readFile(file, 'utf8')).split('\n');
    for (const item of items) {
      const index = item.line - 1;
      if (!lines[index]) continue;
      lines[index] = lines[index].replace(/staticFile\(\s*['"`][^'"`]+['"`]\s*\)/, `resolveAsset('brand:${item.key}')`);
      changed++;
    }
    let text = lines.join('\n');
    if (!/from ['"]\.{1,2}\/brand['"]/.test(text)) {
      const depth = relative.split('/').length - 3; // remotion/src/<...>
      text = `import {resolveAsset} from '${depth > 0 ? '../'.repeat(depth) : './'}brand';\n` + text;
    }
    await fs.writeFile(file, text);
  }
  return changed;
}
