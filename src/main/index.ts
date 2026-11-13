import {app, BrowserWindow, dialog, ipcMain, protocol, shell, webFrameMain} from 'electron';
import {createReadStream} from 'node:fs';
import {Readable} from 'node:stream';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {AgentEngine, AppEvent, AssetKind, AssetPatch, Brief, ClaudeOptions, CommandRecord, LoginKind, Project, ProjectSummary, Settings, State} from '../shared/types';
import {DEFAULT_SETTINGS, EFFORTS} from '../shared/types';
import {createProject, importAsset, listProjects, mainContext, transcriptContext, framesContext, moveAsset, openProject, persist, projectFolder, removeAsset, updateAsset, validateBrief, writeSettings, queueAsset, essentialAsset} from './project';
import {ffmpegDir, prepareMaterial, probe} from './media';
import {Processes, claudeExecutable, opencodeExecutable} from './processes';
import {LoginShell, opencodeModels, providerStatus} from './providers';
import {extractFrames} from './frames';
import {ensureWhisper, transcribeMissing, writeAlignedTranscripts, type Stoppable} from './transcribe';
import {Claude} from './claude';
import {claudeOptions} from './claude-options';
import {Remotion} from './remotion';
import {Terminal} from './terminal';
import {STUDIO_EMBED} from './studio-embed';

let window: BrowserWindow;
let project: Project | null = null;
let root: string | null = null;
let task: string | null = null;
let lastRender: string | null = null;
let library = '';
let projects: ProjectSummary[] = [];
let media: Stoppable | undefined;
let settings: Settings = {...DEFAULT_SETTINGS};
const saveSettings = () => fs.writeFile(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify(settings));
/** provider/model as listed by `opencode models`. */
const MODEL_ID = /^[\w.-]+\/[\w.:@/-]{1,200}$/;
const login = new LoginShell(event => emit(event));
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
const state = (): State => ({project, root, previewUrl: remotion.url, claudeBusy: Boolean(claude.job) || task === 'Claude', task, settings, logs, lastRender, library, projects, commands: terminal.commands()});
const changed = () => emit({type: 'state', state: state()});
// Agent commands that need approval wait here; the dialog is modal to the main window.
async function approveCommand(record: CommandRecord) {
  if (!window || window.isDestroyed()) return false;
  if (window.isMinimized()) window.restore();
  window.focus();
  const answer = await dialog.showMessageBox(window, {type: 'warning', buttons: ['Negar', 'Permitir uma vez'], defaultId: 0, cancelId: 0, noLink: true,
    title: 'Confirmar comando', message: 'Claude quer executar um comando que precisa da sua confirmação.',
    detail: `${record.command.slice(0, 2000)}\n\nPasta: ${record.cwd}\nMotivo: ${record.reasons.join('; ')}`});
  return answer.response === 1;
}
const terminal = new Terminal(processes, emit, () => changed(), approveCommand);
const claude = new Claude(processes, emit, log, changed, () => terminal.bridge);
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
  await terminal.open(nextRoot);
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
    await terminal.open(null);
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
  const kinds: AssetKind[] = ['main', 'logo', 'image', 'video', 'audio', 'font', 'reference', 'document'];
  async function importFiles(kind: AssetKind, note: string, sources: string[]) {
    const {root, project} = current();
    if (typeof note !== 'string' || note.length > 10000) throw new Error('Descrição inválida.');
    if (!kinds.includes(kind)) throw new Error('Tipo de arquivo inválido.');
    const videos = kind === 'main' || kind === 'video';
    for (const source of sources) {
      await importAsset(root, project, source, kind, note);
      if (!videos) continue;
      // Duration is optional metadata here; the material step probes again before using it.
      try {
        const asset = project.assets.at(-1)!;
        const info = await probe(processes, await ffmpegDir(root), path.join(root, asset.path));
        Object.assign(asset, {duration: info.duration, width: info.width, height: info.height, fps: info.fps});
        await persist(root, project);
      } catch {}
    }
  }
  handle('import', (kind: AssetKind, note: string) => runTask('Importando assets', async () => {
    current();
    const videos = kind === 'main' || kind === 'video';
    const selected = await dialog.showOpenDialog(window, {title: kind === 'main' ? 'Adicionar vídeo principal' : 'Adicionar arquivos ao projeto', properties: ['openFile', 'multiSelections'],
      filters: videos ? [{name: 'Vídeos', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi']}, {name: 'Todos os arquivos', extensions: ['*']}] : undefined});
    if (selected.canceled) return;
    await importFiles(kind, note, selected.filePaths);
  }));
  // Picking and importing are split so the UI can ask for the type and usage after choosing files.
  handle('pickFiles', async () => {
    current();
    const selected = await dialog.showOpenDialog(window, {title: 'Adicionar arquivos ao projeto', properties: ['openFile', 'multiSelections']});
    return selected.canceled ? [] : selected.filePaths;
  });
  handle('importFiles', (kind: AssetKind, note: string, sources: string[]) => runTask('Importando assets', async () => {
    if (!Array.isArray(sources) || sources.length > 200 || sources.some(s => typeof s !== 'string' || !path.isAbsolute(s))) throw new Error('Arquivos inválidos.');
    for (const source of sources) if (!(await fs.stat(source)).isFile()) throw new Error(`Não é um arquivo: ${source}`);
    await importFiles(kind, note, sources);
  }));
  handle('queueAsset', (id: string, pending: boolean) => runTask('Atualizando contexto', async () => {
    const {root, project} = current();
    if (typeof pending !== 'boolean') throw new Error('Estado inválido.');
    queueAsset(project, id, pending);
    await persist(root, project);
  }));
  handle('essentialAsset', (id: string, essential: boolean) => runTask('Atualizando referência', async () => {
    const {root, project} = current();
    if (typeof essential !== 'boolean') throw new Error('Estado inválido.');
    essentialAsset(project, id, essential);
    await persist(root, project);
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
        project.changes.push({id: randomUUID(), relevant: true, text: `[Material principal preparado]\n${mainContext(project)}`});
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
    await claude.send(root, project, text, settings);
  }));
  handle('stop', async () => {
    claude.job?.stop();
    remotion.operation?.stop();
    media?.stop();
    await terminal.stopAll();
    if (task && !claude.job && !remotion.operation && !media) await remotion.stopStudio();
    log('Interrupção solicitada.');
  });
  handle('reset', () => runTask('Nova sessão', async () => {
    const {root, project} = current();
    const answer = await dialog.showMessageBox(window, {type: 'question', buttons: ['Cancelar', 'Nova sessão'], defaultId: 0, cancelId: 0,
      message: 'Iniciar uma nova conversa?', detail: 'Histórico preservado. O próximo pedido recebe o briefing, alterações pendentes e referências essenciais fixadas.'});
    if (answer.response !== 1) return;
    project.session = {initialSent: false};
    project.pendingAssetIds = [...new Set([...(project.pendingAssetIds ?? []), ...(project.essentialAssetIds ?? [])])];
    project.messages.push({id: randomUUID(), role: 'system', text: 'Nova sessão: briefing, atualizações pendentes e referências essenciais serão reapresentados no próximo pedido.', at: new Date().toISOString()});
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
  handle('openRender', async () => {
    if (!lastRender) throw new Error('Nenhum vídeo renderizado nesta sessão.');
    const failure = await shell.openPath(lastRender);
    if (failure) throw new Error(failure);
  });
  // Terminal: the user's shell and agent command history. Allowed while other work runs.
  const size = (value: unknown, max: number) => Number.isInteger(value) && (value as number) > 0 && (value as number) <= max;
  handle('ptyStart', (cols: number, rows: number) => {
    if (!size(cols, 1000) || !size(rows, 500)) throw new Error('Tamanho de terminal inválido.');
    return terminal.ptyStart(cols, rows);
  });
  handle('ptyWrite', (data: string) => {if (typeof data === 'string' && data.length <= 100_000) terminal.ptyWrite(data);});
  handle('ptyResize', (cols: number, rows: number) => {if (size(cols, 1000) && size(rows, 500)) terminal.ptyResize(cols, rows);});
  handle('ptyRestart', () => terminal.killPty());
  handle('commandOutput', (id: string) => terminal.output(id));
  handle('stopCommand', async (id: string) => {await terminal.stop(id);});
  handle('clearCommands', () => terminal.clear());
  handle('settings', (next: Settings) => runTask('Salvando ferramentas', async () => {
    for (const key of ['claudePath', 'nodePath', 'npmPath'] as const) {
      if (typeof next?.[key] !== 'string' || next[key].length > 4096) throw new Error('Caminho inválido.');
    }
    if (typeof next.transcribe !== 'boolean' || typeof next.frames !== 'boolean') throw new Error('Opção inválida.');
    if (typeof next.model !== 'string' || !/^[\w.[\]-]{0,100}$/.test(next.model.trim())) throw new Error('Modelo inválido.');
    if (!EFFORTS.includes(next.effort)) throw new Error('Esforço inválido.');
    if (typeof next.opencodePath !== 'string' || next.opencodePath.length > 4096) throw new Error('Caminho inválido.');
    // Engine and OpenCode model change only through the connect screen or the chat options.
    settings = {...settings, claudePath: next.claudePath.trim(), nodePath: next.nodePath.trim(), npmPath: next.npmPath.trim(), opencodePath: next.opencodePath.trim(),
      transcribe: next.transcribe, frames: next.frames, model: next.model.trim(), effort: next.effort};
    await saveSettings();
  }));
  async function engineOptions(): Promise<ClaudeOptions> {
    if (settings.engine !== 'opencode') return claudeOptions(processes, settings.claudePath);
    try {
      const models = await opencodeModels(processes, settings);
      return {models: models.map(value => ({value, label: value})), efforts: [''], notice: 'Modelos do OpenCode disponíveis com as credenciais deste computador.'};
    } catch (error) {return {models: [{value: settings.opencodeModel, label: settings.opencodeModel}], efforts: [''], notice: (error as Error).message};}
  }
  handle('claudeOptions', engineOptions);
  handle('claudePreference', (model: string, effort: string) => runTask('Configurando IA', async () => {
    if (settings.engine === 'opencode') {
      if (typeof model !== 'string' || !MODEL_ID.test(model) || !(await opencodeModels(processes, settings)).includes(model)) throw new Error('Modelo não disponível no OpenCode.');
      settings = {...settings, opencodeModel: model};
      await saveSettings();
      return;
    }
    const available = await claudeOptions(processes, settings.claudePath);
    // Preserve a custom full model ID already saved by an older FramePilot version.
    // CLI --help only enumerates aliases, although --model also accepts full IDs.
    if ((!available.models.some(m => m.value === model) && model !== settings.model)
      || !available.efforts.includes(effort)) throw new Error('Opção não anunciada pelo Claude Code instalado.');
    settings = {...settings, model, effort};
    await saveSettings();
  }));
  // First-run connect screen. Status and models are read-only and allowed while other work runs.
  handle('providers', () => providerStatus(processes, settings));
  handle('opencodeModels', () => opencodeModels(processes, settings));
  handle('connect', (engine: AgentEngine, model?: string) => runTask('Conectando IA', async () => {
    if (engine !== 'claude' && engine !== 'opencode') throw new Error('Provedor inválido.');
    if (engine === 'opencode' && (typeof model !== 'string' || !MODEL_ID.test(model))) throw new Error('Modelo inválido.');
    login.stop();
    settings = {...settings, engine, ...(engine === 'opencode' ? {opencodeModel: model!} : {})};
    await saveSettings();
    log(engine === 'claude' ? 'IA conectada: Claude Code.' : `IA conectada: OpenCode (${model}).`);
  }));
  const logins: LoginKind[] = ['claude', 'opencode-openai', 'opencode-copilot', 'opencode-other', 'install-opencode'];
  handle('loginStart', (kind: LoginKind, cols: number, rows: number) => {
    if (!logins.includes(kind) || !size(cols, 1000) || !size(rows, 500)) throw new Error('Login inválido.');
    return login.start(kind, settings, cols, rows);
  });
  handle('loginWrite', (data: string) => {if (typeof data === 'string' && data.length <= 100_000) login.write(data);});
  handle('loginResize', (cols: number, rows: number) => {if (size(cols, 1000) && size(rows, 500)) login.resize(cols, rows);});
  handle('loginStop', () => login.stop());
  handle('check', () => runTask('Verificando ferramentas', async () => {
    const results: string[] = [];
    const agent = settings.engine === 'opencode' ? ['OpenCode', opencodeExecutable(settings.opencodePath)] : ['Claude', claudeExecutable(settings.claudePath)];
    for (const [name, command] of [['Node', settings.nodePath || 'node'], ['npm', settings.npmPath || 'npm'], agent]) {
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
    const result = results.join('\n') + (settings.engine === 'opencode'
      ? `\nModelo do OpenCode: ${settings.opencodeModel}. O acesso é validado no primeiro pedido.`
      : '\nO login do Claude será validado no primeiro pedido. Se necessário, execute claude uma vez para autenticar.');
    log(result);
    return result;
  }));
}

// fp-media://asset/<id> streams the current project's originals to the trim editor and asset thumbnails, with byte ranges for seeking.
protocol.registerSchemesAsPrivileged([{scheme: 'fp-media', privileges: {standard: true, secure: true, stream: true, supportFetchAPI: true}}]);
const mediaTypes: Record<string, string> = {'.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif'};
async function serveMedia(request: Request) {
  const id = decodeURIComponent(new URL(request.url).pathname.slice(1));
  const asset = project?.assets.find(a => a.id === id && ['main', 'video', 'image', 'logo'].includes(a.kind));
  if (!asset || !root) return new Response(null, {status: 404});
  const file = path.resolve(root, asset.path);
  // Images are served for thumbnails only; SVG and unknown types stay out.
  if (['image', 'logo'].includes(asset.kind) && !mediaTypes[path.extname(file).toLowerCase()]?.startsWith('image/')) return new Response(null, {status: 415});
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
    for (const key of ['claudePath', 'nodePath', 'npmPath', 'model', 'opencodePath'] as const) if (typeof saved[key] === 'string') settings[key] = saved[key];
    if (EFFORTS.includes(saved.effort)) settings.effort = saved.effort;
    if (saved.engine === 'claude' || saved.engine === 'opencode') settings.engine = saved.engine;
    if (typeof saved.opencodeModel === 'string' && MODEL_ID.test(saved.opencodeModel)) settings.opencodeModel = saved.opencodeModel;
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
  // The preview's clean player mode is driven by a small script inside the Studio frame.
  window.webContents.on('did-frame-finish-load', (_event, isMainFrame, processId, routingId) => {
    if (isMainFrame || !remotion.url) return;
    const frame = webFrameMain.fromId(processId, routingId);
    if (!frame || frame.origin !== new URL(remotion.url).origin) return;
    frame.executeJavaScript(STUDIO_EMBED).catch(error => log(`Player do preview indisponível: ${(error as Error).message}`));
  });
  try {await terminal.listen();} catch (error) {log(`Terminal dos agentes indisponível: ${(error as Error).message}`);}
  registerIPC();
  if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await window.loadFile(path.join(__dirname, '../renderer/index.html'));
});
let quitting = false;
app.on('before-quit', event => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  login.stop();
  void (async () => {await terminal.dispose(); await processes.stopAll(); await Promise.allSettled([...inFlight]); app.quit();})();
});
app.on('window-all-closed', () => app.quit());
