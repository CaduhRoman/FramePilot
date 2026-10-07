import {ensureProjectSkills} from './skills';
import {randomUUID} from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import type {AssetKind, Brief, Project} from '../shared/types';

export const REMOTION_VERSION = '4.0.533';
export const kinds: AssetKind[] = ['logo', 'image', 'video', 'audio', 'font', 'reference', 'document'];
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
Não prometa transcrição, geração de mídia ou processamento que não realizou.
Use os recursos reais fornecidos; se faltar algo, explique no chat.

## Briefing
Nome: ${b.name}
Objetivo / briefing: ${b.briefing}
Resolução: ${b.width}x${b.height}
FPS: ${b.fps}
Duração: ${b.duration}s (${Math.round(b.duration * b.fps)} frames)
Direção visual: ${b.style}
Observações: ${b.notes}

## Assets, referências e identidade visual
${project.assets.map(a => `- [${a.kind}] ${a.path}${a.publicPath ? ` — Remotion: staticFile(${JSON.stringify(a.publicPath)})` : ''}\n  ${a.note}`).join('\n') || 'Nenhum asset fornecido ainda.'}
Leia os documentos de identidade e examine as referências quando necessário.
Arquivos de áudio/vídeo não são automaticamente transcritos. Documentos binários podem
precisar de uma versão em texto se suas ferramentas não conseguirem lê-los.

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
Use ferramentas oficiais do Remotion, Sequence, OffthreadVideo, Audio, Img e staticFile.
Animações devem depender de frames, sem aleatoriedade não determinística.
Não inicie servidores, não renderize e não instale dependências: o harness faz isso.
Se alterar package.json, avise que o usuário deve clicar em Instalar dependências.
Seu diretório de trabalho é a raiz deste projeto; código fica em remotion/.
Você pode ler/escrever arquivos com suas ferramentas; Bash não é disponibilizado neste MVP.
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
    dependencies: {'@remotion/cli': REMOTION_VERSION, remotion: REMOTION_VERSION, react: '19.1.0', 'react-dom': '19.1.0'},
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
  return p;
}
export async function importAsset(root: string, project: Project, source: string, kind: AssetKind, note: string, relevant: boolean) {
  if (!kinds.includes(kind)) throw new Error('Tipo de asset inválido.');
  const name = path.basename(source);
  const safeName = name.replace(/[^\p{L}\p{N}._-]/gu, '_');
  const id = randomUUID();
  const folder = ['reference', 'document'].includes(kind) ? 'references' : 'assets';
  const relative = `${folder}/${id.slice(0, 8)}-${safeName}`;
  await fs.copyFile(source, path.join(root, relative));
  const publicPath = folder === 'assets' ? relative : undefined;
  if (publicPath) await fs.copyFile(source, path.join(root, 'remotion/public', publicPath));
  project.assets.push({id, name, path: relative, kind, note, publicPath});
  project.changes.push({id: randomUUID(), relevant,
    text: `Novo ${kind}: ${relative}.${publicPath ? ` Use staticFile(${JSON.stringify(publicPath)}).` : ''}\n${note}`});
  await persist(root, project);
}
