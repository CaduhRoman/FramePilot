import {ensureProjectSkills} from './skills';
import {randomUUID} from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import type {AssetKind, AssetPatch, Brief, Project, ProjectSummary, Segment} from '../shared/types';

export const REMOTION_VERSION = '4.0.533';
export const kinds: AssetKind[] = ['main', 'logo', 'image', 'video', 'audio', 'font', 'reference', 'document'];
export function clock(t: number) {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3_600_000), m = Math.floor(ms / 60_000) % 60, s = (ms % 60_000) / 1000;
  return `${h ? `${h}:` : ''}${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}
export function mainContext(project: Project): string {
  const mains = project.assets.filter(a => a.kind === 'main');
  if (!mains.length) return 'Nenhum vídeo principal definido. Todos os arquivos abaixo são auxiliares.';
  const parts = project.material?.parts.filter(p => p.kind === 'main') ?? [];
  if (!parts.length) return `${mains.length} vídeo(s) principal(is) definido(s); o material preparado será gerado antes do próximo pedido.`;
  const sum = parts.reduce((s, p) => s + p.duration, 0);
  return [
    'É o material central sobre o qual você edita (ex.: podcast, entrevista, gravação). O usuário já o preparou:',
    'os arquivos abaixo contêm SOMENTE os trechos selecionados, concatenados na ordem definida, contínuos, sem lacunas nem telas pretas.',
    'Use apenas estes arquivos preparados como vídeo principal. Os originais completos em assets/ não fazem parte do material:',
    'não os use no vídeo e não recupere trechos que o usuário removeu.',
    `Duração efetiva total do material: ${sum.toFixed(2)}s (${clock(sum)}).`,
    ...parts.flatMap((p, i) => [
      `${i + 1}. staticFile(${JSON.stringify(p.file)}) — ${p.duration.toFixed(2)}s, ${p.width}x${p.height}, ${+p.fps.toFixed(3)} FPS, áudio sincronizado`,
      ...p.sources.map(s => {
        let offset = s.offset;
        const ranges = s.segments.map(seg => {
          const text = `${clock(seg.start)}–${clock(seg.end)} do original → ${clock(offset)}–${clock(offset + seg.end - seg.start)} do arquivo`;
          offset += seg.end - seg.start;
          return text;
        });
        return `   - ${s.name} (original de ${clock(s.originalDuration)}): ${ranges.join('; ')}`;
      })
    ]),
    ...(parts.length > 1 ? ['As partes têm resoluções diferentes: reproduza-as nessa ordem, em sequência (ex.: <Series>).'] : []),
    ...mains.filter(a => a.note).map(a => `Observação sobre ${a.name}: ${a.note}`),
    'Dentro desse material você continua livre para novos cortes, reordenações, transições e decisões criativas.'
  ].join('\n');
}
function auxContext(project: Project): string {
  return project.assets.filter(a => a.kind !== 'main').map(a => {
    const cut = project.material?.parts.find(p => p.kind === 'aux' && p.assetId === a.id);
    const use = cut
      ? ` — Remotion: staticFile(${JSON.stringify(cut.file)}) (recorte do usuário, ${cut.duration.toFixed(2)}s: ${cut.sources[0].segments.map(s => `${clock(s.start)}–${clock(s.end)}`).join(', ')} do original, concatenados; use este recorte)`
      : a.publicPath ? ` — Remotion: staticFile(${JSON.stringify(a.publicPath)})` : '';
    return `- [${a.kind}] ${a.path}${use}\n  ${a.note}`;
  }).join('\n') || 'Nenhum asset auxiliar fornecido ainda.';
}
export const transcriptContext = (project: Project) => project.transcript
  ? `O harness transcreve a fala com Whisper (timestamps por palavra). Use-a para cortar no tempo exato das frases,
remover hesitações e silêncios, escolher trechos fortes, sincronizar textos/legendas e respeitar o sentido do que é dito.
${project.transcript}`
  : 'Ainda não há transcrição. Vídeos e áudios são transcritos automaticamente antes do próximo pedido, se ativado nas configurações.';
export const framesContext = (project: Project) => project.frames
  ? `O harness extrai frames dos vídeos com FFmpeg. Olhe os frames relevantes antes de decidir enquadramento, cortes,
posição e cor de textos/legendas (evite cobrir rostos e textos já presentes), b-roll e transições; combine com a transcrição.
Para ver um momento que a amostragem não cobre (ex.: o ponto exato de um corte), use a ferramenta extract_frames
(MCP framepilot) com o vídeo e os timestamps da timeline usada na edição.
${project.frames}`
  : 'Ainda não há frames extraídos. Eles são gerados automaticamente antes do próximo pedido, se ativado nas configurações.';
export const materialContext = (project: Project) => `[Material de vídeo atualizado]\n${mainContext(project)}\n\nAssets auxiliares:\n${auxContext(project)}`;
export function validateSegments(input: unknown, duration?: number): Segment[] | undefined {
  if (!Array.isArray(input) || input.length > 500) throw new Error('Recortes inválidos.');
  const segments = input.map(s => ({start: Number(s?.start), end: Number(s?.end)})).sort((a, b) => a.start - b.start);
  segments.forEach((s, i) => {
    if (!Number.isFinite(s.start) || !Number.isFinite(s.end) || s.start < 0 || s.end - s.start < 0.001
      || (duration && s.end > duration + 0.05) || (i && s.start < segments[i - 1].end - 1e-6)) throw new Error('Recortes inválidos: trechos sobrepostos ou fora do vídeo.');
  });
  return segments.length ? segments : undefined;
}
function inside(root: string, relative: string) {
  const file = path.resolve(root, relative);
  if (!file.startsWith(path.resolve(root) + path.sep)) throw new Error('Caminho de asset inválido.');
  return file;
}
export async function updateAsset(root: string, project: Project, id: string, patch: AssetPatch) {
  const a = project.assets.find(x => x.id === id);
  if (!a || !patch || typeof patch !== 'object') throw new Error('Arquivo não encontrado.');
  const notes: string[] = [];
  if (patch.duration !== undefined && Number.isFinite(patch.duration) && patch.duration > 0) a.duration = patch.duration;
  if (patch.note !== undefined) {
    if (typeof patch.note !== 'string' || patch.note.length > 10000) throw new Error('Descrição inválida.');
    if (patch.note !== a.note && a.kind !== 'main') notes.push(`Nova descrição de ${a.path}: ${patch.note}`);
    a.note = patch.note;
  }
  if (patch.kind !== undefined && patch.kind !== a.kind) {
    if (![a.kind, patch.kind].every(k => k === 'main' || k === 'video')) throw new Error('Somente vídeos alternam entre principal e auxiliar.');
    if (patch.kind === 'main') {
      if (a.publicPath) await fs.rm(inside(path.join(root, 'remotion/public'), a.publicPath), {force: true});
      if (a.publicPath) notes.push(`${a.path} agora é vídeo principal: staticFile(${JSON.stringify(a.publicPath)}) não existe mais; use o material preparado.`);
      a.publicPath = undefined;
    } else {
      a.publicPath = a.path;
      await fs.copyFile(inside(root, a.path), inside(path.join(root, 'remotion/public'), a.path));
      notes.push(`${a.path} agora é vídeo auxiliar: staticFile(${JSON.stringify(a.publicPath)}).`);
    }
    a.kind = patch.kind;
  }
  if (patch.segments !== undefined) {
    if (!['main', 'video'].includes(a.kind)) throw new Error('Recortes só se aplicam a vídeos.');
    a.segments = validateSegments(patch.segments, a.duration);
  }
  if (notes.length) project.changes.push({id: randomUUID(), relevant: true, text: notes.join('\n')});
  await persist(root, project);
}
export async function removeAsset(root: string, project: Project, id: string) {
  const index = project.assets.findIndex(x => x.id === id);
  if (index < 0) throw new Error('Arquivo não encontrado.');
  const [a] = project.assets.splice(index, 1);
  await fs.rm(inside(root, a.path), {force: true});
  if (a.publicPath) await fs.rm(inside(path.join(root, 'remotion/public'), a.publicPath), {force: true});
  // Main videos and cut auxiliaries are reported with the next material update.
  if (a.kind !== 'main') project.changes.push({id: randomUUID(), relevant: true,
    text: `Asset removido: ${a.path}.${a.publicPath ? ` staticFile(${JSON.stringify(a.publicPath)}) não existe mais; remova as referências.` : ''}`});
  await persist(root, project);
}
export async function moveAsset(root: string, project: Project, id: string, delta: -1 | 1) {
  const mains = project.assets.map((a, i) => a.kind === 'main' ? i : -1).filter(i => i >= 0);
  const at = mains.findIndex(i => project.assets[i].id === id);
  const other = mains[at + delta];
  if (at < 0 || other === undefined) return;
  const from = mains[at];
  [project.assets[from], project.assets[other]] = [project.assets[other], project.assets[from]];
  await persist(root, project);
}
export function validateBrief(input: Brief): Brief {
  if (!input || typeof input !== 'object') throw new Error('Briefing inválido.');
  for (const key of ['name', 'briefing', 'style', 'notes'] as const) {
    if (typeof input[key] !== 'string' || input[key].length > 100_000) throw new Error(`Campo inválido: ${key}`);
  }
  if (!input.name.trim()) throw new Error('Informe o nome do projeto.');
  for (const key of ['width', 'height', 'fps', 'duration'] as const) {
    if (!Number.isFinite(input[key]) || input[key] <= 0) throw new Error(`Valor inválido: ${key}`);
  }
  if (![input.width, input.height].every(v => Number.isInteger(v) && v >= 2 && v <= 7680 && v % 2 === 0)) {
    throw new Error('Resolução: números pares entre 2 e 7680 pixels (H.264).');
  }
  if (input.fps > 120 || input.duration > 14400) throw new Error('Limite: 120 FPS e 4 horas.');
  return {name: input.name.trim(), briefing: input.briefing, width: input.width, height: input.height,
    fps: input.fps, duration: input.duration, style: input.style, notes: input.notes};
}
export function context(project: Project): string {
  const b = project.brief;
  return `# FramePilot — contexto de edição de vídeo\n
Você trabalha no projeto local de vídeo controlado pelo harness FramePilot.
Edite diretamente remotion/src para realizar os pedidos: cortes, montagem, ritmo, transições,
áudio, trilha, legendas, tipografia, correção visual e motion design conforme o briefing.
Não prometa geração de mídia ou processamento que não realizou.
Use os recursos reais fornecidos; se faltar algo, explique no chat.

## Briefing
Nome: ${b.name}
Objetivo / briefing: ${b.briefing}
Resolução: ${b.width}x${b.height}
FPS: ${b.fps}
Duração: ${b.duration}s (${Math.round(b.duration * b.fps)} frames)
Direção visual: ${b.style}
Observações: ${b.notes}

## Vídeo principal (material central da edição)
${mainContext(project)}

## Assets auxiliares, referências e identidade visual
${auxContext(project)}
Leia os documentos de identidade e examine as referências quando necessário.
Documentos binários podem precisar de uma versão em texto se suas ferramentas não conseguirem lê-los.

## Transcrição (o que é dito no vídeo)
${transcriptContext(project)}

## Análise visual (o que aparece no vídeo)
${framesContext(project)}

## Skills de edição
Leia .claude/skills/video-craft/SKILL.md e craft.md em cada pedido de edição.
Consulte CLAUDE.md e outras skills locais relevantes.

## Estrutura e contrato do harness
assets/ = originais; references/ = referências e documentos privados.
remotion/public/assets/ = cópias dos assets usados pelo preview e render.
remotion/src/index.ts = entrada; remotion/src/Root.tsx = composição principal.
remotion/src/Video.tsx = edição livre; remotion/src/project-settings.json = configuração gerenciada.
project.json e CONTEXT.md são gerenciados pelo aplicativo: não os altere.
Mantenha uma composição com ID Main e use project-settings.json para resolução, FPS e duração.
Use ferramentas oficiais do Remotion: Sequence, Img, staticFile e Video/Audio de @remotion/media.
Vídeo: use Video de @remotion/media (não OffthreadVideo nem Html5Video); recorte com trimBefore/durationInFrames.
Toda Sequence (ou Video com from) que contém vídeo/áudio recebe premountFor={fps} (1 s), para carregar antes do corte e evitar frames pretos no preview.
Não monte o mesmo arquivo duas vezes no mesmo trecho sem necessidade; se um efeito exigir duas instâncias, deixe só uma com som (a outra muted).
Animações devem depender de frames, sem aleatoriedade não determinística.
Não inicie servidores, não renderize e não instale dependências: o harness faz isso.
Se alterar package.json, avise que o usuário deve clicar em Instalar dependências.
Seu diretório de trabalho é a raiz deste projeto; código fica em remotion/.
Você pode ler/escrever arquivos com suas ferramentas; Bash não é disponibilizado neste MVP; para frames use extract_frames.
Trabalhe apenas dentro deste projeto. Responda de forma breve em português.
O contexto completo é entregue no primeiro pedido da sessão; depois apenas deltas e o pedido atual.
`;
}
export function promptFor(project: Project, request: string) {
  const changes = project.changes.filter(c => c.relevant);
  const prefix = project.session.initialSent
    ? (changes.length ? `[NEW PROJECT CONTEXT]\n${changes.map(c => c.text).join('\n\n')}\n\n` : '')
    : `[INITIAL PROJECT CONTEXT]\n${context(project)}\n`;
  return {prompt: `${prefix}[USER REQUEST]\n${request}`, changeIds: project.changes.map(c => c.id)};
}

// Serialize all metadata writes; an older save must never overwrite newer session state.
let writes: Promise<void> = Promise.resolve();
export function persist(root: string, project: Project) {
  const json = JSON.stringify(project, null, 2);
  const md = context(project);
  writes = writes.catch(() => {}).then(async () => {
    await fs.writeFile(path.join(root, 'project.json.tmp'), json);
    await fs.rename(path.join(root, 'project.json.tmp'), path.join(root, 'project.json'));
    await fs.writeFile(path.join(root, 'CONTEXT.md'), md);
  });
  return writes;
}
export async function writeSettings(root: string, brief: Brief) {
  await fs.writeFile(path.join(root, 'remotion/src/project-settings.json'), JSON.stringify(brief, null, 2));
}
export async function createProject(root: string, input: Brief): Promise<Project> {
  const brief = validateBrief(input);
  await fs.mkdir(root, {recursive: true});
  if ((await fs.readdir(root)).length) throw new Error('Escolha uma pasta vazia para o novo projeto.');
  for (const dir of ['assets', 'references', 'remotion/src', 'remotion/public/assets', 'renders']) {
    await fs.mkdir(path.join(root, dir), {recursive: true});
  }
  const project: Project = {version: 1, id: randomUUID(), brief, assets: [], changes: [],
    session: {initialSent: false}, messages: []};
  await fs.writeFile(path.join(root, 'remotion/package.json'), JSON.stringify({
    name: 'framepilot-video', private: true, version: '1.0.0',
    scripts: {studio: 'remotion studio src/index.ts', render: 'remotion render src/index.ts Main'},
    dependencies: {'@remotion/cli': REMOTION_VERSION, '@remotion/media': REMOTION_VERSION, remotion: REMOTION_VERSION, react: '19.1.0', 'react-dom': '19.1.0'},
    devDependencies: {typescript: '5.9.3', '@types/react': '^19.0.0', '@types/react-dom': '^19.0.0'}
  }, null, 2));
  await fs.writeFile(path.join(root, 'remotion/tsconfig.json'), JSON.stringify({compilerOptions: {
    target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
    strict: true, esModuleInterop: true, resolveJsonModule: true, skipLibCheck: true, noEmit: true
  }, include: ['src']}, null, 2));
  await fs.writeFile(path.join(root, 'remotion/src/index.ts'), "import {registerRoot} from 'remotion';\nimport {Root} from './Root';\nregisterRoot(Root);\n");
  await fs.writeFile(path.join(root, 'remotion/src/Root.tsx'), `import React from 'react';
import {Composition} from 'remotion';
import {Video} from './Video';
import settings from './project-settings.json';
export const Root = () => <Composition id="Main" component={Video}
  width={settings.width} height={settings.height} fps={settings.fps}
  durationInFrames={Math.max(1, Math.round(settings.duration * settings.fps))} />;
`);
  await fs.writeFile(path.join(root, 'remotion/src/Video.tsx'), `import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import settings from './project-settings.json';
export const Video = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const opacity = interpolate(frame, [0, fps / 2], [0, 1], {extrapolateRight: 'clamp'});
  return <AbsoluteFill style={{backgroundColor: '#15171b', color: 'white', justifyContent: 'center',
    alignItems: 'center', fontFamily: 'sans-serif', padding: 80, textAlign: 'center'}}>
    <div style={{opacity, fontSize: 72, fontWeight: 700}}>{settings.name}</div>
    <div style={{opacity, fontSize: 28, marginTop: 24}}>Seu vídeo começa aqui.</div>
  </AbsoluteFill>;
};
`);
  await ensureProjectSkills(root);
  await writeSettings(root, brief);
  await persist(root, project);
  return project;
}
export async function openProject(root: string): Promise<Project> {
  const p: Project = JSON.parse(await fs.readFile(path.join(root, 'project.json'), 'utf8'));
  if (p.version !== 1 || typeof p.id !== 'string' || !Array.isArray(p.assets) || !Array.isArray(p.changes)
    || !Array.isArray(p.messages) || typeof p.session?.initialSent !== 'boolean') throw new Error('Projeto FramePilot inválido.');
  p.brief = validateBrief(p.brief);
  if (p.session.id && !/^[a-f0-9-]{36}$/i.test(p.session.id)) throw new Error('ID de sessão inválido.');
  await fs.access(path.join(root, 'remotion/src/index.ts'));
  await ensureProjectSkills(root);
  await ensureMediaPlayback(root, p);
  return p;
}
const MEDIA_NOTE = 'Atualização do harness: o preview passou a usar @remotion/media.';
/** Older projects: adds @remotion/media and asks Claude, once, to migrate OffthreadVideo/Html5Video and add premountFor. */
async function ensureMediaPlayback(root: string, p: Project) {
  const file = path.join(root, 'remotion/package.json');
  const pkg = JSON.parse(await fs.readFile(file, 'utf8'));
  if (!pkg.dependencies?.['@remotion/media']) {
    pkg.dependencies = {...pkg.dependencies, '@remotion/media': pkg.dependencies?.remotion ?? REMOTION_VERSION};
    await fs.writeFile(file, JSON.stringify(pkg, null, 2));
  }
  const src = path.join(root, 'remotion/src');
  const code = (await Promise.all((await fs.readdir(src)).filter(n => /\.tsx?$/.test(n)).map(n => fs.readFile(path.join(src, n), 'utf8')))).join('\n');
  if (!/OffthreadVideo|Html5Video|Html5Audio/.test(code) || p.changes.some(c => c.text.startsWith(MEDIA_NOTE))) return;
  p.changes.push({id: randomUUID(), relevant: true, text: `${MEDIA_NOTE} No próximo pedido, antes do resto: troque OffthreadVideo/Html5Video por Video e Html5Audio por Audio de '@remotion/media' (mesmas props: trimBefore, volume, muted, style); `
    + 'adicione premountFor={fps} às Sequences com mídia; mantenha instâncias duplicadas só se o efeito exigir (uma delas muted). Não mude o resultado visual.'});
  await persist(root, p);
}
export async function importAsset(root: string, project: Project, source: string, kind: AssetKind, note: string, relevant: boolean) {
  if (!kinds.includes(kind)) throw new Error('Tipo de asset inválido.');
  const name = path.basename(source);
  const safeName = name.replace(/[^\p{L}\p{N}._-]/gu, '_');
  const id = randomUUID();
  const folder = ['reference', 'document'].includes(kind) ? 'references' : 'assets';
  const relative = `${folder}/${id.slice(0, 8)}-${safeName}`;
  await fs.copyFile(source, path.join(root, relative));
  // Main videos reach Remotion only as prepared material, never as the full original.
  const publicPath = folder === 'assets' && kind !== 'main' ? relative : undefined;
  if (publicPath) await fs.copyFile(source, path.join(root, 'remotion/public', publicPath));
  project.assets.push({id, name, path: relative, kind, note, publicPath});
  if (kind !== 'main') project.changes.push({id: randomUUID(), relevant,
    text: `Novo ${kind}: ${relative}.${publicPath ? ` Use staticFile(${JSON.stringify(publicPath)}).` : ''}\n${note}`});
  await persist(root, project);
}

// Projects live as direct children of the library folder (Videos/FramePilot by default).
export async function projectFolder(library: string, name: string) {
  const slug = name.normalize('NFC').replace(/[<>:"/\|?*\x00-\x1F]/g, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 80) || 'Projeto';
  await fs.mkdir(library, {recursive: true});
  for (let i = 1; ; i++) {
    const candidate = path.join(library, i === 1 ? slug : `${slug} (${i})`);
    try {await fs.access(candidate);} catch {return candidate;}
  }
}
export async function listProjects(library: string): Promise<ProjectSummary[]> {
  let entries: import('node:fs').Dirent[];
  try {entries = await fs.readdir(library, {withFileTypes: true});} catch {return [];}
  const found = await Promise.all(entries.filter(e => e.isDirectory()).map(async (e): Promise<ProjectSummary | null> => {
    const root = path.join(library, e.name);
    try {
      const file = path.join(root, 'project.json');
      const [raw, stat] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)]);
      const p: Project = JSON.parse(raw);
      if (p.version !== 1 || !p.brief?.name) return null;
      return {root, name: p.brief.name, width: p.brief.width, height: p.brief.height, duration: p.brief.duration,
        messages: Array.isArray(p.messages) ? p.messages.filter(m => m.role !== 'system').length : 0,
        hasSession: Boolean(p.session?.id), updatedAt: stat.mtime.toISOString()};
    } catch {return null;}
  }));
  return found.filter((s): s is ProjectSummary => s !== null).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
