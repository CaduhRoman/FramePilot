// Minimal MCP stdio server started by Claude Code for each FramePilot request (no SDK dependency).
// Run by Electron in Node mode: `<electron> frame-tool.js <project root>`.
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createInterface} from 'node:readline';
import net from 'node:net';
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

// Terminal tools forward to the Electron main process, which reviews permissions, asks the user and runs the command.
const bridge = process.env.FRAMEPILOT_BRIDGE && process.env.FRAMEPILOT_TOKEN ? {path: process.env.FRAMEPILOT_BRIDGE, token: process.env.FRAMEPILOT_TOKEN} : undefined;
const terminalTools = [
  {name: 'run_command', method: 'run', description: 'Executa um comando real no shell local (PowerShell no Windows, bash no Linux/macOS) e devolve stdout, stderr e exit code. '
    + 'O diretório padrão é a raiz do projeto. Python, FFmpeg/ffprobe (o do Remotion entra no PATH), Git, npm e demais ferramentas instaladas estão disponíveis. '
    + 'Comandos destrutivos ou que mexem fora do projeto pedem confirmação ao usuário; se ele negar, não tente contornar. '
    + 'Sem stdin: use flags não interativas (-y, --yes). Para servidores ou processos longos use background: true e acompanhe com command_status.',
    inputSchema: {type: 'object', properties: {
      command: {type: 'string', description: 'Linha de comando completa.'},
      cwd: {type: 'string', description: 'Pasta de trabalho relativa à raiz do projeto (padrão ".").'},
      timeout_seconds: {type: 'number', minimum: 1, maximum: 600, description: 'Quanto esperar antes de devolver (padrão 120). O processo continua rodando depois disso e recebe um id.'},
      background: {type: 'boolean', description: 'Devolve após ~1,5 s com o id, deixando o processo rodando.'}
    }, required: ['command']}},
  {name: 'command_status', method: 'status', description: 'Status, exit code e saída (stdout/stderr, últimos 30 KB) de um comando iniciado por run_command.',
    inputSchema: {type: 'object', properties: {id: {type: 'string'}, wait_seconds: {type: 'number', minimum: 0, maximum: 600, description: 'Espera até o término por no máximo esse tempo.'}}, required: ['id']}},
  {name: 'stop_command', method: 'stop', description: 'Interrompe um comando em execução (inclui processos filhos).',
    inputSchema: {type: 'object', properties: {id: {type: 'string'}}, required: ['id']}},
  {name: 'list_commands', method: 'list', description: 'Histórico recente de comandos deste projeto com status e exit code.',
    inputSchema: {type: 'object', properties: {}}}
];
function callBridge(method: string, params: unknown) {
  return new Promise<any>((resolve, reject) => {
    const socket = net.createConnection(bridge!.path);
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(JSON.stringify({id: 1, token: bridge!.token, root, method, params}) + '\n'));
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const index = buffer.indexOf('\n');
      if (index < 0) return;
      socket.end();
      const reply = JSON.parse(buffer.slice(0, index));
      if (reply.error) reject(new Error(reply.error)); else resolve(reply.result);
    });
    socket.on('error', () => reject(new Error('FramePilot não está acessível. Abra o projeto no aplicativo para usar o terminal.')));
    socket.on('close', () => reject(new Error('FramePilot encerrou a conexão do terminal.')));
  });
}
function formatResult(value: any) {
  if (Array.isArray(value)) return value.length ? value.map(c => `${c.id}  ${c.status}${c.exit_code === null ? '' : ` (exit ${c.exit_code})`}  ${c.command}`).join('\n') : 'Nenhum comando no histórico.';
  const lines = [`id: ${value.id}`, `status: ${value.status}`, `exit_code: ${value.exit_code ?? 'n/a'}`, `cwd: ${value.cwd}`];
  if (value.note) lines.push(value.note);
  if (value.truncated) lines.push('(saída truncada: mostrando o final)');
  lines.push('--- stdout ---', value.stdout || '(vazio)', '--- stderr ---', value.stderr || '(vazio)');
  return lines.join('\n');
}

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
  if (method === 'tools/list') return send({id, result: {tools: [tool, ...(bridge ? terminalTools.map(({method, ...t}) => t) : [])]}});
  if (method === 'tools/call') {
    const terminal = bridge && terminalTools.find(t => t.name === params?.name);
    if (terminal) {
      try {
        const value = await callBridge(terminal.method, params.arguments ?? {});
        return send({id, result: {isError: value?.status === 'denied', content: [{type: 'text', text: formatResult(value)}]}});
      } catch (error) {return send({id, result: {isError: true, content: [{type: 'text', text: (error as Error).message}]}});}
    }
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
