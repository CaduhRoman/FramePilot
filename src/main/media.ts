import {createHash} from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import type {Asset, MaterialPart, MaterialSource, Project, Segment} from '../shared/types';
import {environment, type Job, type Processes} from './processes';

// Reuses the FFmpeg build that Remotion installs with every project. It is a reduced build
// (no trim/pad/overlay), so cuts use accurate input seeking and joins use the concat filter.
const exe = (name: string) => process.platform === 'win32' ? `${name}.exe` : name;
export async function ffmpegDir(root: string) {
  const base = path.join(root, 'remotion/node_modules/@remotion');
  const names = await fs.readdir(base).catch(() => [] as string[]);
  for (const name of names.filter(n => n.startsWith('compositor-'))) {
    const dir = path.join(base, name);
    if (await exists(path.join(dir, exe('ffmpeg')))) return dir;
  }
  throw new Error('FFmpeg não encontrado no projeto. Clique em Instalar dependências.');
}
const exists = (file: string) => fs.access(file).then(() => true, () => false);
const total = (segments: Segment[]) => segments.reduce((sum, s) => sum + s.end - s.start, 0);
const digest = (value: unknown) => createHash('sha1').update(JSON.stringify(value)).digest('hex');
const publicFile = (root: string, file: string) => path.join(root, 'remotion/public', file);

export async function run(processes: Processes, dir: string, tool: 'ffmpeg' | 'ffprobe', args: string[], onJob?: (job?: Job) => void) {
  const env = {...environment(), LD_LIBRARY_PATH: dir, DYLD_LIBRARY_PATH: dir};
  const job = processes.start(path.join(dir, exe(tool)), args, dir, env);
  onJob?.(job);
  job.child.stdin?.end();
  let out = '';
  let err = '';
  job.child.stdout?.on('data', chunk => {out += chunk.toString();});
  job.child.stderr?.on('data', chunk => {err = (err + chunk.toString()).slice(-4000);});
  try {
    const code = await job.done;
    if (code !== 0) throw new Error(`${tool} falhou (${code ?? 'interrompido'}): ${err.trim().split('\n').slice(-3).join(' ')}`);
    return out;
  } finally {onJob?.(undefined);}
}

export interface Probe {duration: number; width: number; height: number; fps: number; audio: boolean}
export async function probe(processes: Processes, dir: string, file: string, onJob?: (job?: Job) => void): Promise<Probe> {
  const out = await run(processes, dir, 'ffprobe', ['-v', 'error', '-show_entries',
    'format=duration:stream=codec_type,width,height,avg_frame_rate,r_frame_rate:stream_tags=rotate:stream_side_data=rotation', '-of', 'json', file], onJob);
  const json = JSON.parse(out);
  const streams: any[] = json.streams ?? [];
  const video = streams.find(s => s.codec_type === 'video');
  if (!video) throw new Error(`${path.basename(file)} não contém vídeo.`);
  const rotation = Number(video.side_data_list?.find((d: any) => d.rotation !== undefined)?.rotation ?? video.tags?.rotate ?? 0);
  const sideways = Math.abs(rotation) % 180 === 90;
  const rate = (r: string) => {const [a, b] = String(r).split('/').map(Number); return a && b ? a / b : 0;};
  return {duration: Number(json.format?.duration) || 0, width: sideways ? video.height : video.width, height: sideways ? video.width : video.height,
    fps: rate(video.avg_frame_rate) || rate(video.r_frame_rate) || 30, audio: streams.some(s => s.codec_type === 'audio')};
}

const MATERIAL_VERSION = 2;

interface Cut {file: string; start: number; end: number; audio: boolean}
// Every cut is re-encoded with identical audio/video parameters and joined back to back: no gaps, no black frames.
async function encode(processes: Processes, dir: string, cuts: Cut[], output: string, fps: number, onJob?: (job?: Job) => void) {
  const args = ['-hide_banner', '-y', '-loglevel', 'error'];
  for (const c of cuts) args.push('-ss', c.start.toFixed(6), '-t', (c.end - c.start).toFixed(6), '-i', c.file);
  const audio = cuts.map((c, i) => {
    const length = (c.end - c.start).toFixed(6);
    return c.audio
      ? `[${i}:a:0]aformat=sample_rates=48000:channel_layouts=stereo,apad,atrim=end=${length},asetpts=PTS-STARTPTS[a${i}]`
      : `anullsrc=r=48000:cl=stereo,atrim=end=${length}[a${i}]`;
  });
  const graph = `${audio.join(';')};${cuts.map((_, i) => `[${i}:v:0][a${i}]`).join('')}concat=n=${cuts.length}:v=1:a=1[v][a]`;
  args.push('-filter_complex', graph, '-map', '[v]', '-map', '[a]', '-r', String(fps), '-c:v', 'libx264', '-preset', 'fast', '-crf', '17',
    // One keyframe per second keeps seeks cheap in the Studio preview; render quality is unchanged.
    '-g', String(Math.max(1, Math.round(fps))), '-keyint_min', String(Math.max(1, Math.round(fps))),
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output);
  await run(processes, dir, 'ffmpeg', args, onJob);
}

/** Renders the kept ranges into remotion/public. Returns true when the material changed. */
export async function prepareMaterial(root: string, project: Project, processes: Processes, log: (text: string) => void, onJob?: (job?: Job) => void) {
  const fps = project.brief.fps;
  const mains = project.assets.filter(a => a.kind === 'main');
  const cuts = project.assets.filter(a => a.kind === 'video' && a.segments?.length);
  // v bumps when the encoding changes, so existing material is prepared again once.
  const key = digest({v: MATERIAL_VERSION, fps, mains: mains.map(a => [a.path, a.segments ?? null]), cuts: cuts.map(a => [a.path, a.segments])});
  const old = project.material;
  if ((old?.key ?? digest({v: MATERIAL_VERSION, fps, mains: [], cuts: []})) === key
    && (await Promise.all((old?.parts ?? []).map(p => exists(publicFile(root, p.file))))).every(Boolean)) return false;
  const parts: MaterialPart[] = [];
  if (mains.length || cuts.length) {
    const dir = await ffmpegDir(root);
    const info = new Map<string, Probe>();
    for (const a of [...mains, ...cuts]) {
      const p = await probe(processes, dir, path.join(root, a.path), onJob);
      info.set(a.id, p);
      Object.assign(a, {duration: p.duration, width: p.width, height: p.height, fps: p.fps});
    }
    const ranges = (a: Asset) => {
      const d = info.get(a.id)!.duration;
      const kept = (a.segments?.length ? a.segments : [{start: 0, end: d}])
        .map(s => ({start: Math.max(0, s.start), end: Math.min(d, s.end)})).filter(s => s.end - s.start > 0.001);
      if (!kept.length) throw new Error(`Nenhum trecho válido em ${a.name}.`);
      return kept;
    };
    // Consecutive main videos with the same size share one file; a size change starts a new part.
    const groups: Asset[][] = [];
    for (const a of mains) {
      const last = groups.at(-1);
      const p = info.get(a.id)!;
      const q = last && info.get(last[0].id)!;
      if (last && q && q.width === p.width && q.height === p.height) last.push(a); else groups.push([a]);
    }
    const build = async (kind: 'main' | 'aux', group: Asset[]) => {
      const sources: MaterialSource[] = [];
      let offset = 0;
      for (const a of group) {
        const segments = ranges(a);
        sources.push({assetId: a.id, name: a.name, path: a.path, originalDuration: info.get(a.id)!.duration, segments, offset});
        offset += total(segments);
      }
      const hash = digest({v: MATERIAL_VERSION, fps, sources: sources.map(s => [s.path, s.segments])}).slice(0, 10);
      const file = kind === 'main' ? `main/material-${hash}.mp4` : `assets/${group[0].id.slice(0, 8)}-recorte-${hash}.mp4`;
      const output = publicFile(root, file);
      if (!await exists(output)) {
        await fs.mkdir(path.dirname(output), {recursive: true});
        const temp = `${output}.tmp.mp4`;
        log(`Preparando ${kind === 'main' ? 'vídeo principal' : group[0].name} (${offset.toFixed(1)}s)…`);
        try {
          // Always re-encoded, even untrimmed MP4s: originals often have sparse keyframes that make preview seeks slow.
          await encode(processes, dir, sources.flatMap(s => s.segments.map(seg => ({file: path.join(root, s.path), ...seg, audio: info.get(s.assetId)!.audio}))), temp, fps, onJob);
          await fs.rename(temp, output);
        } finally {await fs.rm(temp, {force: true}).catch(() => {});}
      }
      const p = info.get(group[0].id)!;
      parts.push({file, kind, assetId: kind === 'aux' ? group[0].id : undefined, duration: offset, width: p.width, height: p.height,
        fps, sources});
    };
    for (const group of groups) await build('main', group);
    for (const a of cuts) await build('aux', [a]);
  }
  const keep = new Set(parts.map(p => p.file));
  for (const p of old?.parts ?? []) if (!keep.has(p.file)) await fs.rm(publicFile(root, p.file), {force: true}).catch(() => {});
  project.material = parts.length ? {key, parts} : undefined;
  if (parts.length) log('Material de vídeo preparado.');
  return true;
}
