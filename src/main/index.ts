import {app, BrowserWindow, dialog, ipcMain, shell} from 'electron';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {AppEvent, AssetKind, Brief, Project, Settings, State} from '../shared/types';
import {createProject, importAsset, openProject, persist, validateBrief, writeSettings} from './project';
import {Processes, claudeExecutable} from './processes';
import {Claude} from './claude';
import {Remotion} from './remotion';

let window: BrowserWindow;
let project: Project | null = null;
let root: string | null = null;
let task: string | null = null;
let lastRender: string | null = null;
let settings: Settings = {claudePath: '', nodePath: '', npmPath: ''};
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
const state = (): State => ({project, root, previewUrl: remotion.url, claudeBusy: Boolean(claude.job) || task === 'Claude', task, settings, logs, lastRender});
const changed = () => emit({type: 'state', state: state()});
const claude = new Claude(processes, emit, log, changed);
const remotion = new Remotion(processes, log, changed);
function current() {
  if (!project || !root) throw new Error('Crie ou abra um projeto primeiro.');
  return {project, root};
}
async function runTask<T>(name: string, action: () => Promise<T>): Promise<T> {
  if (task || claude.job) throw new Error('Aguarde a operação atual ou clique em Interromper.');
  task = name;
  changed();
  try {return await action();} catch (error) {log((error as Error).message); throw error;}
  finally {task = null; changed();}
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
  handle('state', state);
  handle('create', (brief: Brief) => runTask('Criando projeto', async () => {
    validateBrief(brief);
    const selected = await dialog.showOpenDialog(window, {title: 'Escolha uma pasta vazia para o projeto', properties: ['openDirectory', 'createDirectory']});
    if (selected.canceled) return;
    const nextRoot = selected.filePaths[0];
    await activate(nextRoot, await createProject(nextRoot, brief));
    await remotion.install(nextRoot, settings);
    await remotion.preview(nextRoot, settings);
  }));
  handle('open', () => runTask('Abrindo projeto', async () => {
    const selected = await dialog.showOpenDialog(window, {title: 'Abra a pasta que contém project.json', properties: ['openDirectory']});
    if (selected.canceled) return;
    const nextRoot = selected.filePaths[0];
    await activate(nextRoot, await openProject(nextRoot));
    await remotion.preview(nextRoot, settings);
  }));
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
    const selected = await dialog.showOpenDialog(window, {title: 'Adicionar arquivos ao projeto', properties: ['openFile', 'multiSelections']});
    if (selected.canceled) return;
    for (const source of selected.filePaths) await importAsset(root, project, source, kind, note, relevant);
  }));
  handle('send', (text: string) => runTask('Claude', async () => {
    const {root, project} = current();
    await claude.send(root, project, text, settings.claudePath);
  }));
  handle('stop', async () => {
    claude.job?.stop();
    remotion.operation?.stop();
    if (task && !claude.job && !remotion.operation) await remotion.stopStudio();
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
    settings = {claudePath: next.claudePath.trim(), nodePath: next.nodePath.trim(), npmPath: next.npmPath.trim()};
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
    const result = results.join('\n') + '\nO login do Claude será validado no primeiro pedido. Se necessário, execute claude uma vez para autenticar.';
    log(result);
    return result;
  }));
}

app.whenReady().then(async () => {
  await fs.mkdir(app.getPath('userData'), {recursive: true});
  try {
    const saved = JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'settings.json'), 'utf8'));
    for (const key of ['claudePath', 'nodePath', 'npmPath'] as const) if (typeof saved[key] === 'string') settings[key] = saved[key];
  } catch {}
  window = new BrowserWindow({width: 1440, height: 940, minWidth: 1000, minHeight: 700, title: 'FramePilot',
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
