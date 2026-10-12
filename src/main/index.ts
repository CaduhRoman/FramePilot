import {app, BrowserWindow, dialog, ipcMain, protocol, shell} from 'electron';
import {createReadStream} from 'node:fs';
import {Readable} from 'node:stream';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {AppEvent, AssetKind, AssetPatch, Brief, Project, ProjectSummary, Settings, State} from '../shared/types';
import {createProject, importAsset, listProjects, materialContext, transcriptContext, framesContext, moveAsset, openProject, persist, projectFolder, removeAsset, updateAsset, validateBrief, writeSettings} from './project';
import {ffmpegDir, prepareMaterial, probe} from './media';
import {Processes, claudeExecutable} from './processes';
import {extractFrames} from './frames';
import {ensureWhisper, transcribeMissing, writeAlignedTranscripts, type Stoppable} from './transcribe';
import {Claude} from './claude';
import {Remotion} from './remotion';

let window: BrowserWindow;
let project: Project | null = null;
let root: string | null = null;
let task: string | null = null;
let lastRender: string | null = null;
let library = '';
let projects: ProjectSummary[] = [];
let media: Stoppable | undefined;
let settings: Settings = {claudePath: '', nodePath: '', npmPath: '', transcribe: true, frames: true};
const whisperHome = () => path.join(app.getPath('userData'), 'whisper');
const logs: string[] = [];
const processes = new Processes();
const inFlight = new Set<Promise<unknown>>();
const emit = (event: AppEvent) => {if (window && !window.isDestroyed()) window.webContents.send('fp:event', event);};
const log = (text: string) => {
  const clean = text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').trim().slice(-8000);
  if (!clean) return;
  logs.push(clean);
  if (logs.length > 300) logs.shift();
  emit({type: 'log', text: clean});
};
const state = (): State => ({project, root, previewUrl: remotion.url, claudeBusy: Boolean(claude.job) || task === 'Claude', task, settings, logs, lastRender, library, projects});
const changed = () => emit({type: 'state', state: state()});
const claude = new Claude(processes, emit, log, changed);
const remotion = new Remotion(processes, log, changed);
async function refreshProjects() {
  projects = await listProjects(library);
  changed();
}
function current() {
  if (!project || !root) throw new Error('Crie ou abra um projeto primeiro.');
  return {project, root};
}
async function runTask<T>(name: string, action: () => Promise<T>): Promise<T> {
  if (task || claude.job) throw new Error('Aguarde a operação atual ou clique em Interromper.');
  task = name;
  changed();
  try {return await action();} catch (error) {log((error as Error).message); throw error;}
  finally {task = null; await refreshProjects();}
}
function handle(name: string, action: (...args: any[]) => unknown) {
  ipcMain.handle(`fp:${name}`, (event, ...args) => {
    // Only our top-level UI receives the bridge. Studio and generated video code do not.
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Origem IPC não autorizada.');
    const pending = Promise.resolve().then(() => action(...args));
    inFlight.add(pending);
    void pending.finally(() => inFlight.delete(pending)).catch(() => {});
    return pending;
  });
}
async function activate(nextRoot: string, next: Project) {
  await remotion.stopStudio();
  project = next;
  root = nextRoot;
  lastRender = null;
  logs.length = 0;
  changed();
}
function registerIPC() {
  handle('state', async () => {await refreshProjects(); return state();});
  handle('create', (brief: Brief) => runTask('Criando projeto', async () => {
    const nextRoot = await projectFolder(library, validateBrief(brief).name);
    await activate(nextRoot, await createProject(nextRoot, brief));
    await remotion.install(nextRoot, settings);
    await remotion.preview(nextRoot, settings);
  }));
  handle('open', (requested?: string) => runTask('Abrindo projeto', async () => {
    let nextRoot: string;
    if (requested !== undefined) {
      // Only projects listed from the library can be opened by path.
      if (typeof requested !== 'string' || !projects.some(p => p.root === requested)) throw new Error('Projeto não encontrado na biblioteca.');
      nextRoot = requested;
    } else {
      const selected = await dialog.showOpenDialog(window, {title: 'Abra a pasta que contém project.json', defaultPath: library, properties: ['openDirectory']});
      if (selected.canceled) return;
      nextRoot = selected.filePaths[0];
    }
    if (nextRoot === root) return;
    await activate(nextRoot, await openProject(nextRoot));
    await remotion.preview(nextRoot, settings);
  }));
  handle('close', () => runTask('Fechando projeto', async () => {
    await remotion.stopStudio();
    project = null;
    root = null;
    lastRender = null;
    logs.length = 0;
  }));
  handle('library', async () => {
    await fs.mkdir(library, {recursive: true});
    await shell.openPath(library);
  });
  handle('save', (brief: Brief) => runTask('Salvando configurações', async () => {
    const {root, project} = current();
    const next = validateBrief(brief);
    const changes = (Object.keys(next) as (keyof Brief)[]).filter(k => next[k] !== project.brief[k]);
    if (!changes.length) return;
    project.changes.push({id: randomUUID(), relevant: true, text: 'Configurações alteradas:\n' + changes.map(k => `${k}: ${next[k]}`).join('\n')});
    project.brief = next;
    await persist(root, project);
    await writeSettings(root, next);
  }));
  handle('import', (kind: AssetKind, note: string, relevant: boolean) => runTask('Importando assets', async () => {
    const {root, project} = current();
    if (typeof note !== 'string' || note.length > 10000 || typeof relevant !== 'boolean') throw new Error('Descrição inválida.');
    const videos = kind === 'main' || kind === 'video';
    const selected = await dialog.showOpenDialog(window, {title: kind === 'main' ? 'Adicionar vídeo principal' : 'Adicionar arquivos ao projeto', properties: ['openFile', 'multiSelections'],
      filters: videos ? [{name: 'Vídeos', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi']}, {name: 'Todos os arquivos', extensions: ['*']}] : undefined});
    if (selected.canceled) return;
    for (const source of selected.filePaths) {
      await importAsset(root, project, source, kind, note, relevant);
      if (!videos) continue;
      // Duration is optional metadata here; the material step probes again before using it.
      try {
        const asset = project.assets.at(-1)!;
        const info = await probe(processes, await ffmpegDir(root), path.join(root, asset.path));
        Object.assign(asset, {duration: info.duration, width: info.width, height: info.height, fps: info.fps});
        await persist(root, project);
      } catch {}
    }
  }));
  handle('updateAsset', (id: string, patch: AssetPatch) => runTask('Salvando arquivo', async () => {
    const {root, project} = current();
    await updateAsset(root, project, id, patch);
  }));
  handle('removeAsset', (id: string) => runTask('Removendo arquivo', async () => {
    const {root, project} = current();
    const asset = project.assets.find(a => a.id === id);
    if (!asset) return;
    const answer = await dialog.showMessageBox(window, {type: 'warning', buttons: ['Cancelar', 'Remover'], defaultId: 0, cancelId: 0,
      message: `Remover "${asset.name}" do projeto?`, detail: 'A cópia dentro do projeto será apagada. O arquivo original no seu computador não é alterado.'});
    if (answer.response === 1) await removeAsset(root, project, id);
  }));
  handle('moveAsset', (id: string, delta: -1 | 1) => runTask('Reordenando', async () => {
    const {root, project} = current();
    if (delta !== -1 && delta !== 1) throw new Error('Direção inválida.');
    await moveAsset(root, project, id, delta);
  }));
  // Metadata read by the renderer's player; allowed while other work runs.
  handle('assetDuration', async (id: string, duration: number) => {
    const asset = project?.assets.find(a => a.id === id);
    if (!asset || asset.duration || !root || !Number.isFinite(duration) || duration <= 0) return;
    asset.duration = duration;
    await persist(root, project!);
    changed();
  });
  handle('send', (text: string) => runTask('Claude', async () => {
    const {root, project} = current();
    task = 'Preparando material de vídeo';
    changed();
    try {
      if (await prepareMaterial(root, project, processes, log, job => {media = job;})) {
        project.changes.push({id: randomUUID(), relevant: true, text: materialContext(project)});
        await persist(root, project);
      }
      if (settings.transcribe) {
        task = 'Transcrevendo áudio';
        changed();
        try {await transcribeMissing(root, project, whisperHome(), processes, log, job => {media = job;});}
        catch (error) {log(`Transcrição indisponível: ${(error as Error).message}`);}
        // Alignment is cheap; refresh it whenever cuts or transcripts may have changed.
        const summary = await writeAlignedTranscripts(root, project) || undefined;
        if (summary !== project.transcript) {
          project.transcript = summary;
          project.changes.push({id: randomUUID(), relevant: true, text: `[Transcrição atualizada]\n${transcriptContext(project)}`});
          await persist(root, project);
        }
      }
      if (settings.frames) {
        task = 'Extraindo frames';
        changed();
        // Runs after transcription so frames/index.md pairs each frame with its speech.
        let summary: string | undefined;
        try {summary = await extractFrames(root, project, processes, log, job => {media = job;}) || undefined;}
        catch (error) {log(`Frames indisponíveis: ${(error as Error).message}`); summary = project.frames;}
        if (summary !== project.frames) {
          project.frames = summary;
          project.changes.push({id: randomUUID(), relevant: true, text: `[Frames atualizados]\n${framesContext(project)}`});
          await persist(root, project);
        }
      }
    } finally {media = undefined; task = 'Claude'; changed();}
    await claude.send(root, project, text, settings.claudePath);
  }));
  handle('stop', async () => {
    claude.job?.stop();
    remotion.operation?.stop();
    media?.stop();
    if (task && !claude.job && !remotion.operation && !media) await remotion.stopStudio();
    log('Interrupção solicitada.');
  });
  handle('reset', () => runTask('Nova sessão', async () => {
    const {root, project} = current();
    const answer = await dialog.showMessageBox(window, {type: 'question', buttons: ['Cancelar', 'Nova sessão'], defaultId: 0, cancelId: 0,
      message: 'Iniciar uma nova conversa?', detail: 'Os arquivos e o histórico permanecem. O próximo pedido receberá o contexto completo atualizado.'});
    if (answer.response !== 1) return;
    project.session = {initialSent: false};
    project.messages.push({id: randomUUID(), role: 'system', text: 'Nova sessão: o próximo pedido receberá o contexto atual completo.', at: new Date().toISOString()});
    await persist(root, project);
  }));
  handle('preview', () => runTask('Iniciando preview', async () => {await remotion.preview(current().root, settings);}));
  handle('install', () => runTask('Instalando dependências', async () => {
    const {root} = current();
    await remotion.stopStudio();
    await remotion.install(root, settings);
    await remotion.preview(root, settings);
  }));
  handle('render', () => runTask('Renderizando MP4', async () => {
    const {root} = current();
    const selected = await dialog.showSaveDialog(window, {title: 'Renderizar vídeo MP4', defaultPath: path.join(root, 'renders', `video-${Date.now()}.mp4`), filters: [{name: 'Vídeo MP4', extensions: ['mp4']}]});
    if (selected.canceled || !selected.filePath) return;
    const output = selected.filePath.toLowerCase().endsWith('.mp4') ? selected.filePath : selected.filePath + '.mp4';
    await remotion.render(root, output, settings);
    lastRender = output;
    log(`Vídeo concluído: ${output}`);
  }));
  handle('reveal', async () => {if (lastRender) shell.showItemInFolder(lastRender); else await shell.openPath(current().root);});
  handle('settings', (next: Settings) => runTask('Salvando ferramentas', async () => {
    for (const key of ['claudePath', 'nodePath', 'npmPath'] as const) {
      if (typeof next?.[key] !== 'string' || next[key].length > 4096) throw new Error('Caminho inválido.');
    }
    if (typeof next.transcribe !== 'boolean' || typeof next.frames !== 'boolean') throw new Error('Opção inválida.');
    settings = {claudePath: next.claudePath.trim(), nodePath: next.nodePath.trim(), npmPath: next.npmPath.trim(), transcribe: next.transcribe, frames: next.frames};
    await fs.writeFile(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify(settings));
  }));
  handle('check', () => runTask('Verificando ferramentas', async () => {
    const results: string[] = [];
    for (const [name, command] of [['Node', settings.nodePath || 'node'], ['npm', settings.npmPath || 'npm'], ['Claude', claudeExecutable(settings.claudePath)]]) {
      const job = processes.start(command, ['--version'], app.getPath('userData'));
      job.child.stdin?.end();
      let output = '';
      job.child.stdout?.on('data', chunk => {output += chunk.toString();});
      job.child.stderr?.on('data', chunk => {output += chunk.toString();});
      const timeout = setTimeout(job.stop, 10000);
      try {const code = await job.done; results.push(`${name}: ${code === 0 ? output.trim() : 'falhou — ' + output.trim()}`);}
      catch {results.push(`${name}: não encontrado. Configure o executável ou instale a ferramenta.`);}
      finally {clearTimeout(timeout);}
    }
    if (settings.transcribe) {
      // Installs Whisper and the model ahead of time so the first request does not wait for downloads.
      try {
        const {cli} = await ensureWhisper(whisperHome(), processes, log, job => {media = job;});
        results.push(`Whisper: pronto (${cli.includes('bin-cuda') ? 'GPU NVIDIA CUDA' : 'CPU'}, modelo large-v3-turbo)`);
      } catch (error) {results.push(`Whisper: falhou — ${(error as Error).message}`);}
      finally {media = undefined;}
    }
    const result = results.join('\n') + '\nO login do Claude será validado no primeiro pedido. Se necessário, execute claude uma vez para autenticar.';
    log(result);
    return result;
  }));
}

// fp-media://asset/<id> streams the current project's originals to the trim editor, with byte ranges for seeking.
protocol.registerSchemesAsPrivileged([{scheme: 'fp-media', privileges: {standard: true, secure: true, stream: true, supportFetchAPI: true}}]);
const mediaTypes: Record<string, string> = {'.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska'};
async function serveMedia(request: Request) {
  const id = decodeURIComponent(new URL(request.url).pathname.slice(1));
  const asset = project?.assets.find(a => a.id === id && (a.kind === 'main' || a.kind === 'video'));
  if (!asset || !root) return new Response(null, {status: 404});
  const file = path.resolve(root, asset.path);
  if (!file.startsWith(path.resolve(root) + path.sep)) return new Response(null, {status: 403});
  const {size} = await fs.stat(file);
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
  let start = 0, end = size - 1;
  if (range && range[1]) {start = Number(range[1]); if (range[2]) end = Math.min(Number(range[2]), size - 1);}
  else if (range && range[2]) start = Math.max(0, size - Number(range[2]));
  if (start > end) return new Response(null, {status: 416, headers: {'Content-Range': `bytes */${size}`}});
  const body = Readable.toWeb(createReadStream(file, {start, end})) as unknown as ReadableStream;
  return new Response(body, {status: range ? 206 : 200, headers: {'Content-Type': mediaTypes[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes', ...(range ? {'Content-Range': `bytes ${start}-${end}/${size}`} : {})}});
}

app.whenReady().then(async () => {
  protocol.handle('fp-media', request => serveMedia(request).catch(() => new Response(null, {status: 404})));
  await fs.mkdir(app.getPath('userData'), {recursive: true});
  library = path.join(app.getPath('videos'), 'FramePilot');
  try {await fs.mkdir(library, {recursive: true}); projects = await listProjects(library);} catch {}
  try {
    const saved = JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'settings.json'), 'utf8'));
    for (const key of ['claudePath', 'nodePath', 'npmPath'] as const) if (typeof saved[key] === 'string') settings[key] = saved[key];
    for (const key of ['transcribe', 'frames'] as const) if (typeof saved[key] === 'boolean') settings[key] = saved[key];
  } catch {}
  window = new BrowserWindow({width: 1440, height: 940, minWidth: 1000, minHeight: 700, title: 'FramePilot',
    icon: path.join(__dirname, 'favicon.png'), backgroundColor: '#101114',
    webPreferences: {preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false}});
  window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-frame-navigate', (event) => {
    if (event.isMainFrame) {event.preventDefault(); return;}
    try {if (!remotion.url || new URL(event.url).origin !== new URL(remotion.url).origin) event.preventDefault();}
    catch {event.preventDefault();}
  });
  registerIPC();
  if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await window.loadFile(path.join(__dirname, '../renderer/index.html'));
});
let quitting = false;
app.on('before-quit', event => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void (async () => {await processes.stopAll(); await Promise.allSettled([...inFlight]); app.quit();})();
});
app.on('window-all-closed', () => app.quit());
