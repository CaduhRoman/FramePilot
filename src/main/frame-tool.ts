// Minimal MCP stdio server started by Claude Code for each FramePilot request (no SDK dependency).
// Run by Electron in Node mode: `<electron> frame-tool.js <project root>`.
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createInterface} from 'node:readline';
import type {Project} from '../shared/types';
import {framesAt, sources} from './frames';
import {Processes} from './processes';

const root = path.resolve(process.argv[2] ?? '');
const processes = new Processes();
const MAX_PER_CALL = 12;
const TOOL = 'extract_frames'; // Allowed in claude.ts as mcp__framepilot__extract_frames.

const tool = {
  name: TOOL,
  description: 'Extrai frames (JPEG 640 px) de um vídeo do projeto em timestamps específicos e devolve as imagens. '
    + 'Use para ver momentos que a amostragem automática de frames/index.md não cobre. Tempos em segundos na timeline do arquivo '
    + 'usado na edição (o mesmo do staticFile e da transcrição), não do original. Frames já extraídos vêm do cache.',
  inputSchema: {type: 'object', properties: {
    video: {type: 'string', description: 'Vídeo listado em frames/index.md: a chave da pasta (ex.: "material-ab12cd34ef") ou o caminho do staticFile (ex.: "main/material-ab12cd34ef.mp4").'},
    timestamps: {type: 'array', items: {type: 'number', minimum: 0}, minItems: 1, maxItems: MAX_PER_CALL, description: `Segundos na timeline do vídeo; até ${MAX_PER_CALL} por chamada.`}
  }, required: ['video', 'timestamps']}
};

async function extract(args: any) {
  const project = JSON.parse(await fs.readFile(path.join(root, 'project.json'), 'utf8')) as Project;
  const list = await sources(root, project, processes, () => {});
  const wanted = String(args?.video ?? '').trim().replace(/^staticFile\(["']?|["']?\)$/g, '');
  const source = list.find(s => s.key === wanted || s.file.replace(/\\/g, '/').replace(/^remotion\/public\//, '') === wanted || path.basename(s.file, path.extname(s.file)) === wanted);
  if (!source) throw new Error(`Vídeo "${wanted}" não encontrado. Disponíveis: ${list.map(s => s.key).join(', ') || 'nenhum (o material ainda não foi preparado)'}.`);
  const times = Array.isArray(args?.timestamps) ? [...new Set(args.timestamps.map(Number))] as number[] : [];
  if (!times.length || times.length > MAX_PER_CALL) throw new Error(`Informe de 1 a ${MAX_PER_CALL} timestamps.`);
  const frames = await framesAt(root, source, times, processes);
  const content: any[] = [];
  for (const f of frames) {
    const data = await fs.readFile(f.file).catch(() => undefined);
    const name = path.relative(root, f.file).replace(/\\/g, '/');
    if (!data) {content.push({type: 'text', text: `${f.t}s: nenhum frame decodificado neste ponto.`}); continue;}
    content.push({type: 'text', text: `${source.key} @ ${f.t}s (${name})`}, {type: 'image', data: data.toString('base64'), mimeType: 'image/jpeg'});
  }
  return content;
}

const send = (message: object) => process.stdout.write(JSON.stringify({jsonrpc: '2.0', ...message}) + '\n');
async function handle(message: any) {
  const {id, method, params} = message;
  if (id === undefined) return; // Notifications need no reply.
  if (method === 'initialize') return send({id, result: {protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: {tools: {}}, serverInfo: {name: 'framepilot', version: '1.0.0'}}});
  if (method === 'ping') return send({id, result: {}});
  if (method === 'tools/list') return send({id, result: {tools: [tool]}});
  if (method === 'tools/call') {
    if (params?.name !== TOOL) return send({id, error: {code: -32602, message: `Ferramenta desconhecida: ${params?.name}`}});
    try {return send({id, result: {content: await extract(params.arguments)}});}
    catch (error) {return send({id, result: {isError: true, content: [{type: 'text', text: (error as Error).message}]}});}
  }
  send({id, error: {code: -32601, message: `Método não suportado: ${method}`}});
}

const pending = new Set<Promise<void>>();
const lines = createInterface({input: process.stdin, crlfDelay: Infinity});
lines.on('line', line => {
  if (!line.trim()) return;
  let message: any;
  try {message = JSON.parse(line);} catch {return send({id: null, error: {code: -32700, message: 'JSON inválido.'}});}
  const call = handle(message).catch(error => send({id: message.id, error: {code: -32603, message: (error as Error).message}})).then(() => {});
  pending.add(call);
  void call.finally(() => pending.delete(call));
});
// Finish in-flight calls before exiting when Claude closes stdin.
lines.on('close', () => void Promise.allSettled([...pending]).then(() => processes.stopAll()).finally(() => process.exit(0)));
