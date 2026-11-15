import {app, BrowserWindow, dialog, ipcMain, protocol, shell, webFrameMain} from 'electron';
import {createReadStream} from 'node:fs';
import {Readable} from 'node:stream';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {AgentEngine, AppEvent, AssetKind, AssetPatch, Brief, ClaudeOptions, CommandRecord, LoginKind, Project, ProjectSummary, Settings, State} from '../shared/types';
import type {BrandDetail, BrandInput, BrandPatch} from '../shared/types';
import {DEFAULT_SETTINGS, EFFORTS} from '../shared/types';
import {createProject, importAsset, listProjects, mainContext, moveProject, transcriptContext, framesContext, moveAsset, openProject, persist, projectFolder, refreshBrand, removeAsset, updateAsset, validateBrief, writeSettings, queueAsset, essentialAsset} from './project';
import {applyBrandKeys, brandCandidates, createBrand, KEY as BRAND_KEY, kitDir, listBrands, projectKit, putBrandAsset, removeBrandAsset, SNAPSHOT_DIR, snapshotBrand, syncProjectBrand, updateBrand} from './brand';
import {ffmpegDir, prepareMaterial, probe} from './media';
import {Processes, claudeExecutable, opencodeExecutable} from './processes';
import {LoginShell, opencodeModels, providerStatus, registerElevenlabsForClaude} from './providers';
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
let brands: BrandDetail[] = [];
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
/** Agent commands waiting for the user's answer in the renderer's approval popup, oldest first. */
const approvals = new Map<string, {record: CommandRecord; answer: (allow: boolean) => void}>();
const state = (): State => ({project, root, previewUrl: remotion.url, claudeBusy: Boolean(claude.job) || task === 'Claude', task, settings, logs, lastRender, library, projects, brands,
  commands: terminal.commands(), approvals: [...approvals.values()].map(a => a.record)});
const changed = () => emit({type: 'state', state: state()});
// Agent commands that need approval wait here until the popup answers (or the work is stopped).
async function approveCommand(record: CommandRecord) {
  if (settings.autoMode) {log(`Modo Auto: comando permitido sem confirmação (${record.reasons.join('; ')}): ${record.command.slice(0, 300)}`); return true;}
  if (!window || window.isDestroyed()) return false;
  if (window.isMinimized()) window.restore();
  if (!window.isFocused()) window.flashFrame(true);
  window.focus();
  return new Promise<boolean>(resolve => {
    approvals.set(record.id, {record, answer: allow => {approvals.delete(record.id); resolve(allow); changed();}});
    changed();
  });
}
/** Stopping, switching projects or quitting denies whatever is still waiting. */
const denyApprovals = () => {for (const {answer} of [...approvals.values()]) answer(false);};
const terminal = new Terminal(processes, emit, () => changed(), approveCommand);
const claude = new Claude(processes, emit, log, changed, () => terminal.bridge);
const remotion = new Remotion(processes, log, changed);
async function refreshProjects() {
  projects = await listProjects(library);
  const found = await listBrands(library);
  brands = found.map(b => ({...b, projects: projects.filter(p => p.brandId === b.kit.id).length}));
  changed();
}
/**
 * Depois de qualquer alteração no kit, reespelha a marca em todos os seus projetos em edição,
 * para que a logo nova apareça no preview sem abrir projeto por projeto. Projetos travados
 * num snapshot (já exportados) ficam de fora de propósito.
 */
async function pushBrand(id: string) {
  for (const summary of projects.filter(p => p.brandId === id)) {
    if (root && path.resolve(summary.root) === path.resolve(root) && project) continue;
    try {
      const p: Project = JSON.parse(await fs.readFile(path.join(summary.root, 'project.json'), 'utf8'));
      if (!p.brand || p.brand.lock) continue;
      await syncProjectBrand(summary.root, p);
    } catch (error) {log(`Marca não aplicada em ${summary.name}: ${(error as Error).message}`);}
  }
  // O projeto aberto também recebe o kit novo e um CONTEXT.md atualizado.
  if (root && project?.brand?.id === id && !project.brand.lock) {
    await refreshBrand(root, project);
    await persist(root, project);
  }
  await refreshProjects();
}
function brandOf(id: unknown): BrandDetail {
  if (typeof id !== 'string' || !BRAND_KEY.test(id)) throw new Error('Marca inválida.');
  const brand = brands.find(b => b.kit.id === id);
  if (!brand) throw new Error('Marca não encontrada na biblioteca.');
  return brand;
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
  denyApprovals();
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
  handle('create', (brief: Brief, brandId?: string) => runTask('Criando projeto', async () => {
    const id = brandId ? brandOf(brandId).kit.id : undefined;
    const nextRoot = await projectFolder(library, validateBrief(brief).name, id);
    await activate(nextRoot, await createProject(nextRoot, brief, id));
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
    denyApprovals();
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
  // --- Marcas -------------------------------------------------------------
  handle('createBrand', (input: BrandInput) => runTask('Criando marca', async () => {
    if (!input || typeof input !== 'object' || typeof input.name !== 'string') throw new Error('Marca inválida.');
    if (typeof input.guide === 'string' && input.guide.length > 200_000) throw new Error('Guia da marca muito longo.');
    const brand = await createBrand(library, {name: input.name, colors: input.colors, defaults: input.defaults, guide: input.guide});
    log(`Marca criada: ${brand.kit.name} (${brand.kit.id}).`);
  }));
  handle('updateBrand', (id: string, patch: BrandPatch) => runTask('Salvando marca', async () => {
    const brand = brandOf(id);
    if (!patch || typeof patch !== 'object') throw new Error('Alteração inválida.');
    if (typeof patch.guide === 'string' && patch.guide.length > 200_000) throw new Error('Guia da marca muito longo.');
    const kit = await updateBrand(library, brand.kit.id, patch);
    await pushBrand(kit.id);
  }));
  // Substituir mantém a chave: os projetos continuam pedindo brand:<chave> e recebem o arquivo novo.
  handle('putBrandAsset', (id: string, key: string, label: string, source?: string) => runTask('Salvando asset da marca', async () => {
    const brand = brandOf(id);
    let file = source;
    if (file === undefined) {
      const selected = await dialog.showOpenDialog(window, {title: `Arquivo para brand:${key}`, properties: ['openFile']});
      if (selected.canceled) return;
      file = selected.filePaths[0];
    }
    if (typeof file !== 'string' || !path.isAbsolute(file) || !(await fs.stat(file)).isFile()) throw new Error('Arquivo inválido.');
    const kit = await putBrandAsset(library, brand.kit.id, key, label, file);
    log(`brand:${key} atualizado em ${kit.name} (versão ${kit.version}).`);
    await pushBrand(kit.id);
  }));
  handle('removeBrandAsset', (id: string, key: string) => runTask('Removendo asset da marca', async () => {
    const brand = brandOf(id);
    const asset = brand.kit.assets[key as string];
    if (!asset) throw new Error('Asset não encontrado na marca.');
    const answer = await dialog.showMessageBox(window, {type: 'warning', buttons: ['Cancelar', 'Remover'], defaultId: 0, cancelId: 0,
      message: `Remover brand:${key} da marca ${brand.kit.name}?`,
      detail: 'O arquivo é apagado da marca. Projetos que usam essa chave vão falhar até serem ajustados.'});
    if (answer.response !== 1) return;
    const kit = await removeBrandAsset(library, brand.kit.id, key);
    await pushBrand(kit.id);
  }));
  handle('moveProject', (target: string, brandId: string) => runTask('Movendo projeto', async () => {
    if (typeof target !== 'string' || !projects.some(p => p.root === target)) throw new Error('Projeto não encontrado na biblioteca.');
    if (typeof brandId !== 'string') throw new Error('Marca inválida.');
    const id = brandId ? brandOf(brandId).kit.id : '';
    const summary = projects.find(p => p.root === target)!;
    const answer = await dialog.showMessageBox(window, {type: 'question', buttons: ['Cancelar', 'Mover'], defaultId: 0, cancelId: 0,
      message: id ? `Mover "${summary.name}" para a marca ${brandOf(id).kit.name}?` : `Mover "${summary.name}" para Avulsos?`,
      detail: `A pasta do projeto será movida para ${id ? path.join(library, id) : library}. Nada é apagado.`});
    if (answer.response !== 1) return;
    const open = root && path.resolve(root) === path.resolve(target);
    if (open) {
      // A pasta não pode se mover sob os pés do preview, do terminal e da sessão do agente.
      denyApprovals();
      await remotion.stopStudio();
      await terminal.open(null);
      project = null;
      root = null;
    }
    const moved = await moveProject(library, target, id);
    log(`Projeto movido para ${moved}.`);
    await refreshProjects();
    if (open) {
      await activate(moved, await openProject(moved));
      await remotion.preview(moved, settings);
    }
  }));
  handle('brandCandidates', async (target: string) => {
    const {root, project} = current();
    if (typeof target !== 'string' || path.resolve(target) !== path.resolve(root)) throw new Error('Projeto inválido.');
    const live = await projectKit(root, project);
    return live ? brandCandidates(root, live.kit) : [];
  });
  handle('applyBrandKeys', (target: string, files: string[]) => runTask('Aplicando chaves da marca', async () => {
    const {root, project} = current();
    if (typeof target !== 'string' || path.resolve(target) !== path.resolve(root)) throw new Error('Projeto inválido.');
    if (!Array.isArray(files) || files.length > 200 || files.some(f => typeof f !== 'string')) throw new Error('Arquivos inválidos.');
    const live = await projectKit(root, project);
    if (!live) throw new Error('Este projeto não pertence a uma marca.');
    const changedLines = await applyBrandKeys(root, live.kit, files);
    project.changes.push({id: randomUUID(), relevant: true,
      text: `O usuário trocou ${changedLines} caminho(s) de arquivo por chaves brand:* em remotion/src. Confira se o resultado visual continua correto e siga usando resolveAsset('brand:<chave>').`});
    await persist(root, project);
    log(`${changedLines} referência(s) trocadas por brand:*.`);
  }));
  handle('refreshBrand', () => runTask('Atualizando marca do projeto', async () => {
    const {root, project} = current();
    if (!project.brand) throw new Error('Este projeto não pertence a uma marca.');
    if (!project.brand.lock) throw new Error('O projeto já acompanha a marca atual.');
    const answer = await dialog.showMessageBox(window, {type: 'question', buttons: ['Cancelar', 'Atualizar'], defaultId: 0, cancelId: 0,
      message: 'Atualizar este projeto para a marca atual?',
      detail: `O projeto está congelado na versão ${project.brand.lock.version} da marca (snapshot do export). Atualizar faz o vídeo voltar a usar os assets e tokens atuais, o que pode mudar o resultado de um vídeo já entregue.`});
    if (answer.response !== 1) return;
    project.brand = {id: project.brand.id, ...(project.brand.overrides ? {overrides: project.brand.overrides} : {})};
    await fs.rm(path.join(root, SNAPSHOT_DIR), {recursive: true, force: true});
    await refreshBrand(root, project);
    project.changes.push({id: randomUUID(), relevant: true,
      text: 'O projeto voltou a acompanhar a marca ao vivo (snapshot descartado). Os assets e tokens podem ter mudado desde o último export.'});
    await persist(root, project);
    await remotion.preview(root, settings);
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
  // Escolher arquivos não exige projeto aberto: a tela de nova marca também escolhe a logo por aqui.
  handle('pickFiles', async () => {
    const selected = await dialog.showOpenDialog(window, {title: 'Escolher arquivos', properties: ['openFile', 'multiSelections']});
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
    denyApprovals();
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
  handle('preview', () => runTask('Iniciando preview', async () => {
    const {root, project} = current();
    // Reespelha o kit antes de subir o Studio: o preview sempre reflete a marca como ela está agora.
    await refreshBrand(root, project);
    await remotion.preview(root, settings);
  }));
  handle('install', () => runTask('Instalando dependências', async () => {
    const {root} = current();
    await remotion.stopStudio();
    await remotion.install(root, settings);
    await remotion.preview(root, settings);
  }));
  handle('render', () => runTask('Renderizando MP4', async () => {
    const {root, project} = current();
    const selected = await dialog.showSaveDialog(window, {title: 'Renderizar vídeo MP4', defaultPath: path.join(root, 'renders', `video-${Date.now()}.mp4`), filters: [{name: 'Vídeo MP4', extensions: ['mp4']}]});
    if (selected.canceled || !selected.filePath) return;
    const output = selected.filePath.toLowerCase().endsWith('.mp4') ? selected.filePath : selected.filePath + '.mp4';
    // Exportar congela a marca: o snapshot entra antes do render, então o MP4 e o .brand-snapshot batem.
    let frozen: number | null = null;
    if (project.brand && !project.brand.lock) {
      frozen = await snapshotBrand(root, project);
      await refreshBrand(root, project);
      await persist(root, project);
    }
    await refreshBrand(root, project);
    await remotion.render(root, output, settings);
    lastRender = output;
    log(`Vídeo concluído: ${output}`);
    if (frozen !== null) log(`Marca congelada na versão ${frozen} para este projeto. Use "Atualizar para a marca atual" quando quiser acompanhar a marca de novo.`);
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
  // Answer from the approval popup. Allowed while other work runs: the agent is waiting on it.
  handle('approveCommand', (id: string, allow: boolean) => {
    if (typeof id !== 'string' || typeof allow !== 'boolean') throw new Error('Resposta inválida.');
    approvals.get(id)?.answer(allow);
  });
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
  const logins: LoginKind[] = ['claude', 'opencode-openai', 'opencode-copilot', 'opencode-other', 'install-opencode', 'elevenlabs'];
  handle('loginStart', (kind: LoginKind, cols: number, rows: number) => {
    if (!logins.includes(kind) || !size(cols, 1000) || !size(rows, 500)) throw new Error('Login inválido.');
    if (kind !== 'elevenlabs') return login.start(kind, settings, cols, rows);
    if (!settings.engine) throw new Error('Escolha a IA antes de conectar a ElevenLabs.');
    return (async () => {
      if (settings.engine === 'claude') await registerElevenlabsForClaude(processes, settings);
      await login.start(kind, settings, cols, rows);
    })();
  });
  // Modo Auto is a plain switch (not a task), so it can be flipped while the agent is working.
  handle('autoMode', async (enabled: boolean) => {
    if (typeof enabled !== 'boolean') throw new Error('Opção inválida.');
    settings = {...settings, autoMode: enabled};
    await saveSettings();
    log(enabled ? 'Modo Auto ativado: a IA trabalha sem pedir permissão.' : 'Modo Auto desativado: comandos sensíveis voltam a pedir confirmação.');
    if (enabled) for (const {answer} of [...approvals.values()]) answer(true);
    changed();
  });
  // Turning ElevenLabs on is checked against the sign-in of the CLI that will actually use it.
  handle('elevenlabs', (enabled: boolean) => runTask('Configurando ElevenLabs', async () => {
    if (typeof enabled !== 'boolean') throw new Error('Opção inválida.');
    if (enabled) {
      const status = await providerStatus(processes, settings);
      const engine = settings.engine === 'opencode' ? 'opencode' : 'claude';
      if (!status.elevenlabs[engine]) throw new Error('A ElevenLabs ainda não está conectada para a IA atual. Clique em Conectar e conclua o login.');
    }
    settings = {...settings, elevenlabs: enabled};
    await saveSettings();
    log(enabled ? 'ElevenLabs conectada: as IAs podem gerar narração.' : 'ElevenLabs desativada.');
  }));
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
/** fp-media://brand/<id>/<chave> serve os assets do kit para as previews da página da marca. */
async function serveBrandAsset(url: URL) {
  const [id, key] = url.pathname.slice(1).split('/').map(decodeURIComponent);
  const brand = brands.find(b => b.kit.id === id);
  const asset = brand && !brand.kit.assets[key]?.local ? brand.kit.assets[key] : undefined;
  if (!brand || !asset) return new Response(null, {status: 404});
  const dir = path.resolve(kitDir(library, brand.kit.id));
  const file = path.resolve(dir, asset.file);
  if (!file.startsWith(dir + path.sep)) return new Response(null, {status: 403});
  const type = mediaTypes[path.extname(file).toLowerCase()] ?? (path.extname(file).toLowerCase() === '.svg' ? 'image/svg+xml' : '');
  if (!type) return new Response(null, {status: 415});
  // Preview-only: nosniff e um CSP vazio impedem que um SVG da marca execute qualquer coisa.
  return new Response(Readable.toWeb(createReadStream(file)) as unknown as ReadableStream, {status: 200,
    headers: {'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'"}});
}
async function serveMedia(request: Request) {
  const url = new URL(request.url);
  if (url.host === 'brand') return serveBrandAsset(url);
  const id = decodeURIComponent(url.pathname.slice(1));
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
    if (typeof saved.elevenlabs === 'boolean') settings.elevenlabs = saved.elevenlabs;
    if (typeof saved.autoMode === 'boolean') settings.autoMode = saved.autoMode;
    for (const key of ['transcribe', 'frames'] as const) if (typeof saved[key] === 'boolean') settings[key] = saved[key];
  } catch {}
  window = new BrowserWindow({width: 1440, height: 940, minWidth: 1000, minHeight: 700, title: 'FramePilot',
    icon: path.join(__dirname, 'favicon.png'), backgroundColor: '#0a0a0a',
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
  denyApprovals();
  void (async () => {await terminal.dispose(); await processes.stopAll(); await Promise.allSettled([...inFlight]); app.quit();})();
});
app.on('window-all-closed', () => app.quit());
