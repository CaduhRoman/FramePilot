import {promises as fs} from 'node:fs';
import path from 'node:path';
import type {Project} from '../shared/types';
import {clock} from './project';
import {ffmpegDir, probe, run} from './media';
import type {Processes} from './processes';
import type {Stoppable, Word} from './transcribe';

// Frames are sampled evenly: dense on short videos, capped on long ones so Claude can read them selectively.
const FRAMES_VERSION = 1;
const WIDTH = 640;
const MAX_FRAMES = 150;
const BATCH = 16;
export const frameInterval = (duration: number) => Math.min(10, Math.max(1, Math.ceil(duration / MAX_FRAMES * 2) / 2));
export function frameTimes(duration: number) {
  const step = frameInterval(duration);
  const times: number[] = [];
  for (let t = Math.min(step / 2, duration / 2); t < duration - 0.05; t += step) times.push(+t.toFixed(3));
  return times;
}
const frameName = (t: number) => `${t.toFixed(3).padStart(10, '0')}s.jpg`;

export interface Source {key: string; title: string; file: string; duration: number}
interface Manifest {version: number; file: string; duration: number; times: number[]}

/** Videos Claude actually uses: prepared material parts and uncut auxiliary videos, keyed like their transcripts. */
export async function sources(root: string, project: Project, processes: Processes, onJob: (job?: Stoppable) => void): Promise<Source[]> {
  const list: Source[] = (project.material?.parts ?? []).map(p => ({key: path.basename(p.file, '.mp4'), file: path.join('remotion/public', p.file), duration: p.duration,
    title: `${p.kind === 'main' ? 'Vídeo principal' : 'Recorte'} staticFile(${JSON.stringify(p.file)})`}));
  const prepared = new Set((project.material?.parts ?? []).flatMap(p => p.sources.map(s => s.assetId)));
  for (const a of project.assets.filter(a => a.kind === 'video' && !prepared.has(a.id))) {
    let duration = a.duration ?? 0;
    if (!duration) try {duration = (await probe(processes, await ffmpegDir(root), path.join(root, a.path), onJob)).duration;} catch {}
    list.push({key: a.id.slice(0, 8), file: a.path, duration, title: `${a.name}${a.publicPath ? ` staticFile(${JSON.stringify(a.publicPath)})` : ''}`});
  }
  return list.filter(s => s.duration > 0.1);
}

// Remotion's reduced FFmpeg has no select/fps filters: seek each frame as its own input, many per process.
async function grab(root: string, source: Source, frames: {t: number; file: string}[], processes: Processes, onJob: (job?: Stoppable) => void) {
  const ff = await ffmpegDir(root);
  const input = path.join(root, source.file);
  for (let i = 0; i < frames.length; i += BATCH) {
    const batch = frames.slice(i, i + BATCH);
    const args = ['-hide_banner', '-loglevel', 'error', '-y'];
    batch.forEach(f => args.push('-ss', f.t.toFixed(3), '-i', input));
    batch.forEach((f, j) => args.push('-map', `${j}:v:0`, '-frames:v', '1', '-vf', `scale=${WIDTH}:-2`, '-q:v', '5', f.file));
    await run(processes, ff, 'ffmpeg', args, onJob);
  }
}

/**
 * Frames at arbitrary timestamps of a source (seconds in its own timeline), for on-demand requests.
 * Reuses the automatic samples when a timestamp matches one; other frames are cached in frames/<key>/extra/.
 */
export async function framesAt(root: string, source: Source, times: number[], processes: Processes, onJob: (job?: Stoppable) => void = () => {}) {
  const dir = path.join(root, 'frames', source.key);
  const result: {t: number; file: string}[] = [];
  for (const raw of times) {
    if (!Number.isFinite(raw) || raw < 0 || raw >= source.duration) throw new Error(`Timestamp ${raw}s fora do vídeo (duração ${source.duration.toFixed(3)}s).`);
    const t = Math.round(raw * 1000) / 1000;
    const auto = path.join(dir, frameName(t));
    result.push({t, file: await fs.access(auto).then(() => auto, () => path.join(dir, 'extra', frameName(t)))});
  }
  const missing = [];
  for (const f of result) if (!await fs.access(f.file).then(() => true, () => false)) missing.push(f);
  if (missing.length) {
    await fs.mkdir(path.join(dir, 'extra'), {recursive: true});
    await grab(root, source, missing, processes, onJob);
  }
  return result;
}

async function extract(root: string, source: Source, processes: Processes, log: (text: string) => void, onJob: (job?: Stoppable) => void) {
  const dir = path.join(root, 'frames', source.key);
  const times = frameTimes(source.duration);
  try {
    const m = JSON.parse(await fs.readFile(path.join(dir, 'frames.json'), 'utf8')) as Manifest;
    if (m.version === FRAMES_VERSION && m.file === source.file && m.times.length === times.length) return times;
  } catch {}
  await fs.rm(dir, {recursive: true, force: true});
  await fs.mkdir(dir, {recursive: true});
  log(`Extraindo ${times.length} frames de ${source.title}…`);
  await grab(root, source, times.map(t => ({t, file: path.join(dir, frameName(t))})), processes, onJob);
  const manifest: Manifest = {version: FRAMES_VERSION, file: source.file, duration: source.duration, times};
  await fs.writeFile(path.join(dir, 'frames.json'), JSON.stringify(manifest));
  return times;
}

/**
 * Extracts sample frames of every video Claude edits into frames/<key>/ and writes frames/index.md,
 * pairing each frame with what is said around it. Returns the summary for the context ('' when none).
 */
export async function extractFrames(root: string, project: Project, processes: Processes, log: (text: string) => void, onJob: (job?: Stoppable) => void) {
  const base = path.join(root, 'frames');
  await fs.mkdir(base, {recursive: true});
  const list = await sources(root, project, processes, onJob);
  const keep = new Set(list.map(s => s.key));
  for (const entry of await fs.readdir(base, {withFileTypes: true})) {
    if (entry.isDirectory() && !keep.has(entry.name)) await fs.rm(path.join(base, entry.name), {recursive: true, force: true});
  }
  const md = ['# Frames dos vídeos', '',
    'Imagens JPEG (640 px de largura) amostradas em intervalos regulares. Tempos no arquivo indicado (o mesmo do staticFile).',
    'Abra os frames com a ferramenta de leitura de arquivos para ver enquadramento, pessoas, cenário, textos na tela e cores.', ''];
  const listed: string[] = [];
  for (const s of list) {
    const times = await extract(root, s, processes, log, onJob);
    let words: Word[] = [];
    try {words = JSON.parse(await fs.readFile(path.join(root, 'remotion/public/transcripts', `${s.key}.json`), 'utf8')).words ?? [];} catch {}
    const step = frameInterval(s.duration);
    md.push(`## ${s.title}`, `Duração ${clock(s.duration)}, 1 frame a cada ${step}s.`, '');
    for (const t of times) {
      const said = words.filter(w => w.end > t - step / 2 && w.start <= t + step / 2).map(w => w.text).join(' ');
      md.push(`- [${clock(t)}] frames/${s.key}/${frameName(t)}${said ? ` — fala: "${said}"` : ''}`);
    }
    md.push('');
    listed.push(`- ${s.title}: ${times.length} frames (1 a cada ${step}s) em frames/${s.key}/`);
  }
  await fs.writeFile(path.join(base, 'index.md'), md.join('\n'));
  return listed.length ? ['Leia frames/index.md: lista cada frame com seu tempo e a fala correspondente.', ...listed].join('\n') : '';
}
