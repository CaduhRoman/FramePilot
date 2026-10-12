import {createWriteStream, existsSync, promises as fs} from 'node:fs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
import type {Asset, Project} from '../shared/types';
import {clock} from './project';
import {ffmpegDir} from './media';
import {environment, type Processes} from './processes';

// whisper.cpp runs natively (no Python). large-v3-turbo: near large-v3 accuracy, ~2-3 GB of VRAM, fast on CUDA.
const RELEASE = 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454';
const MODEL = 'ggml-large-v3-turbo.bin';
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL}`;
const TRANSCRIPT_VERSION = 1;

export interface Word {text: string; start: number; end: number}
export interface Transcript {version: number; source: string; language: string; model: string; words: Word[]}
/** Anything the stop button can interrupt: a process or a download. */
export interface Stoppable {stop: () => void}

const exists = (file: string) => fs.access(file).then(() => true, () => false);
const exe = (name: string) => process.platform === 'win32' ? `${name}.exe` : name;
const gpu = () => process.platform === 'win32' && existsSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe'));
export const transcriptFile = (root: string, asset: Asset) => path.join(root, 'transcripts', `${asset.id}.json`);
export const transcribable = (a: Asset) => a.kind === 'main' || a.kind === 'video' || a.kind === 'audio';

async function download(url: string, target: string, label: string, log: (text: string) => void, onJob: (job?: Stoppable) => void) {
  const controller = new AbortController();
  onJob({stop: () => controller.abort()});
  const temp = `${target}.part`;
  try {
    const response = await fetch(url, {signal: controller.signal});
    if (!response.ok || !response.body) throw new Error(`Download falhou (${response.status}): ${label}`);
    const size = Number(response.headers.get('content-length')) || 0;
    let received = 0, reported = 0;
    const body = Readable.fromWeb(response.body as any);
    body.on('data', (chunk: Buffer) => {
      received += chunk.length;
      const pct = size ? Math.floor(received / size * 100) : 0;
      if (pct >= reported + 10) {reported = pct - pct % 10; log(`Baixando ${label}: ${reported}%`);}
    });
    await fs.mkdir(path.dirname(target), {recursive: true});
    await pipeline(body, createWriteStream(temp));
    await fs.rename(temp, target);
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Download interrompido.');
    throw error;
  } finally {onJob(undefined); await fs.rm(temp, {force: true}).catch(() => {});}
}

/** Installs whisper-cli and the model under `home` on first use. Returns the executable and model paths. */
export async function ensureWhisper(home: string, processes: Processes, log: (text: string) => void, onJob: (job?: Stoppable) => void) {
  const model = path.join(home, 'models', MODEL);
  if (!await exists(model)) {
    log('Primeira transcrição: baixando o modelo Whisper large-v3-turbo (~1,6 GB, uma única vez).');
    await download(MODEL_URL, model, 'modelo Whisper', log, onJob);
  }
  if (process.platform !== 'win32') return {cli: exe('whisper-cli'), model}; // Expected on PATH (brew/apt).
  const variant = gpu() ? 'cuda' : 'cpu';
  const bin = path.join(home, `bin-${variant}`);
  const cli = path.join(bin, 'Release', exe('whisper-cli'));
  if (!await exists(cli)) {
    const zip = path.join(home, `whisper-${variant}.zip`);
    log(variant === 'cuda' ? 'Baixando Whisper com aceleração NVIDIA CUDA (~650 MB, uma única vez).' : 'Baixando Whisper (CPU).');
    await download(`${RELEASE}/${variant === 'cuda' ? 'whisper-bin-win-cuda-12.4.0-x64.zip' : 'whisper-bin-x64.zip'}`, zip, 'Whisper', log, onJob);
    try {
      const temp = `${bin}.tmp`;
      await fs.rm(temp, {recursive: true, force: true});
      await fs.mkdir(temp, {recursive: true});
      // Windows' bundled bsdtar extracts zip archives.
      const job = processes.start(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', temp], home);
      onJob(job);
      try {if (await job.done !== 0) throw new Error('Falha ao extrair o Whisper.');} finally {onJob(undefined);}
      await fs.rm(bin, {recursive: true, force: true});
      await fs.rename(temp, bin);
    } finally {await fs.rm(zip, {force: true}).catch(() => {});}
  }
  return {cli, model};
}

async function runLogged(processes: Processes, command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, onJob: (job?: Stoppable) => void, onLine?: (line: string) => void) {
  const job = processes.start(command, args, cwd, env);
  onJob(job);
  job.child.stdin?.end();
  let err = '';
  const read = (chunk: Buffer) => {
    const text = chunk.toString();
    err = (err + text).slice(-4000);
    if (onLine) text.split(/\r?\n/).forEach(onLine);
  };
  job.child.stdout?.on('data', read);
  job.child.stderr?.on('data', read);
  try {
    const code = await job.done;
    if (code !== 0) throw Object.assign(new Error(`${path.basename(command)} falhou (${code ?? 'interrompido'}): ${err.trim().split('\n').slice(-3).join(' ')}`), {output: err});
  } finally {onJob(undefined);}
}

async function transcribeAsset(root: string, asset: Asset, whisper: {cli: string; model: string}, processes: Processes, log: (text: string) => void, onJob: (job?: Stoppable) => void): Promise<Transcript> {
  const dir = path.join(root, 'transcripts');
  await fs.mkdir(dir, {recursive: true});
  const wav = path.join(dir, `${asset.id}.tmp.wav`);
  const out = path.join(dir, `${asset.id}.whisper`);
  const empty: Transcript = {version: TRANSCRIPT_VERSION, source: asset.path, language: '', model: MODEL, words: []};
  try {
    const ff = await ffmpegDir(root);
    const env = {...environment(), LD_LIBRARY_PATH: ff, DYLD_LIBRARY_PATH: ff};
    try {
      await runLogged(processes, path.join(ff, exe('ffmpeg')), ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(root, asset.path),
        '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav], ff, env, onJob);
    } catch (error) {
      if (/does not contain any stream|matches no streams|no audio/i.test(String((error as any).output ?? ''))) return empty;
      throw error;
    }
    let last = -1;
    // -ml 1 -sow: one JSON segment per whole word, so timestamps are per word and UTF-8 is never split mid-character.
    await runLogged(processes, whisper.cli, ['-m', whisper.model, '-f', wav, '-l', 'auto', '-oj', '-ml', '1', '-sow', '-np', '-pp', '-of', out],
      path.dirname(whisper.cli), environment(), onJob, line => {
        const pct = Number(/progress\s*=\s*(\d+)%/.exec(line)?.[1] ?? NaN);
        if (pct >= last + 25) {last = pct; log(`Transcrevendo ${asset.name}: ${pct}%`);}
      });
    const json = JSON.parse(await fs.readFile(`${out}.json`, 'utf8'));
    const words: Word[] = (json.transcription ?? []).map((t: any) => ({text: String(t.text ?? '').trim(), start: t.offsets.from / 1000, end: t.offsets.to / 1000}))
      .filter((w: Word) => w.text && !/^\[.*\]$|^\(.*\)$/.test(w.text));
    return {...empty, language: json.result?.language ?? '', words};
  } finally {
    await fs.rm(wav, {force: true}).catch(() => {});
    await fs.rm(`${out}.json`, {force: true}).catch(() => {});
  }
}

export async function readTranscript(root: string, asset: Asset): Promise<Transcript | undefined> {
  try {
    const t = JSON.parse(await fs.readFile(transcriptFile(root, asset), 'utf8')) as Transcript;
    return t.version === TRANSCRIPT_VERSION ? t : undefined;
  } catch {return undefined;}
}

/** Transcribes every video/audio asset that has no transcript yet. Returns how many were transcribed. */
export async function transcribeMissing(root: string, project: Project, home: string, processes: Processes, log: (text: string) => void, onJob: (job?: Stoppable) => void) {
  const missing: Asset[] = [];
  for (const a of project.assets.filter(transcribable)) if (!await readTranscript(root, a)) missing.push(a);
  if (!missing.length) return 0;
  const whisper = await ensureWhisper(home, processes, log, onJob);
  for (const a of missing) {
    log(`Transcrevendo ${a.name}…`);
    const t = await transcribeAsset(root, a, whisper, processes, log, onJob);
    await fs.writeFile(transcriptFile(root, a), JSON.stringify(t));
    log(t.words.length ? `Transcrição pronta: ${a.name} (${t.words.length} palavras, idioma ${t.language || '?'}).` : `${a.name}: nenhuma fala detectada.`);
  }
  return missing.length;
}

/** Groups words into readable phrases: breaks on long pauses, sentence ends, or length. */
export function phrases(words: Word[]) {
  const out: Word[][] = [];
  let current: Word[] = [];
  for (const w of words) {
    const prev = current.at(-1);
    if (prev && (w.start - prev.end > 0.6 || /[.?!…]$/.test(prev.text) || current.length >= 16)) {out.push(current); current = [];}
    current.push(w);
  }
  if (current.length) out.push(current);
  return out.map(p => ({start: p[0].start, end: p.at(-1)!.end, text: p.map(w => w.text).join(' ')}));
}

/** Maps original-time words into a prepared file's timeline, keeping only words inside kept ranges. */
export function mapWords(words: Word[], segments: {start: number; end: number}[], offset: number): Word[] {
  const out: Word[] = [];
  for (const seg of segments) {
    for (const w of words) {
      const mid = (w.start + w.end) / 2;
      if (mid < seg.start || mid >= seg.end) continue;
      out.push({text: w.text, start: +(offset + Math.max(w.start, seg.start) - seg.start).toFixed(3), end: +(offset + Math.min(w.end, seg.end) - seg.start).toFixed(3)});
    }
    offset += seg.end - seg.start;
  }
  return out;
}

/**
 * Writes transcripts aligned to the files Claude actually uses: remotion/public/transcripts/*.json (per word,
 * for captions via staticFile) and transcripts/material.md (readable phrases). Returns the summary for the context.
 */
export async function writeAlignedTranscripts(root: string, project: Project): Promise<string> {
  const publicDir = path.join(root, 'remotion/public/transcripts');
  await fs.rm(publicDir, {recursive: true, force: true});
  await fs.mkdir(publicDir, {recursive: true});
  await fs.mkdir(path.join(root, 'transcripts'), {recursive: true});
  const md: string[] = ['# Transcrições (Whisper large-v3-turbo)', '',
    'Tempos em segundos no arquivo indicado (o mesmo usado com staticFile), já considerando os recortes do usuário.', ''];
  const listed: string[] = [];
  const emit = async (title: string, file: string, words: Word[], language: string) => {
    const json = `transcripts/${file}.json`;
    await fs.writeFile(path.join(root, 'remotion/public', json), JSON.stringify({language, words}));
    md.push(`## ${title}`, `Palavras com tempo: staticFile(${JSON.stringify(json)}) — {language, words: [{text, start, end}]}`, '');
    md.push(...(words.length ? phrases(words).map(p => `[${clock(p.start)}–${clock(p.end)}] ${p.text}`) : ['(sem fala detectada)']), '');
    listed.push(`- ${title}: ${words.length} palavras → staticFile(${JSON.stringify(json)})`);
  };
  const byId = new Map(project.assets.map(a => [a.id, a]));
  for (const part of project.material?.parts ?? []) {
    let language = '';
    const words: Word[] = [];
    for (const s of part.sources) {
      const asset = byId.get(s.assetId);
      const t = asset && await readTranscript(root, asset);
      if (!t) continue;
      language ||= t.language;
      words.push(...mapWords(t.words, s.segments, s.offset));
    }
    if (part.sources.some(s => byId.has(s.assetId))) await emit(`${part.kind === 'main' ? 'Vídeo principal' : 'Recorte'} ${part.file}`, path.basename(part.file, '.mp4'), words, language);
  }
  const prepared = new Set((project.material?.parts ?? []).flatMap(p => p.sources.map(s => s.assetId)));
  for (const a of project.assets.filter(a => transcribable(a) && a.kind !== 'main' && !prepared.has(a.id))) {
    const t = await readTranscript(root, a);
    if (t) await emit(`${a.name}${a.publicPath ? ` (staticFile(${JSON.stringify(a.publicPath)}))` : ''}`, a.id.slice(0, 8), t.words, t.language);
  }
  await fs.writeFile(path.join(root, 'transcripts/material.md'), md.join('\n'));
  return listed.length ? ['Leia transcripts/material.md para saber o que é dito e quando (frases com tempos).', ...listed].join('\n') : '';
}
