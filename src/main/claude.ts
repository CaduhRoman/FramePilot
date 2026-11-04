import {ensureProjectSkills, skillReminder} from './skills';
import {randomUUID} from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import type {AppEvent, Project} from '../shared/types';
import {persist, promptFor} from './project';
import {claudeExecutable, jsonLines, Processes, type Job} from './processes';
import type {Bridge} from './terminal';

export const FRAME_TOOL = 'mcp__framepilot__extract_frames';
export const TERMINAL_TOOLS = ['run_command', 'command_status', 'stop_command', 'list_commands'].map(name => `mcp__framepilot__${name}`);
const terminalReminder = 'Para executar comandos reais (python, ffmpeg/ffprobe, git, npm, scripts) use mcp__framepilot__run_command; '
  + 'o diretório padrão é a raiz do projeto. Comandos destrutivos ou fora do projeto pedem confirmação do usuário: se ele negar, não contorne.';
/** Writes the MCP config that lets Claude request frames on demand: Electron runs the bundled frame-tool in Node mode. */
async function frameToolConfig(root: string, bridge?: Bridge) {
  const file = path.join(root, '.claude', 'framepilot-mcp.json');
  await fs.mkdir(path.dirname(file), {recursive: true});
  await fs.writeFile(file, JSON.stringify({mcpServers: {framepilot: {type: 'stdio', command: process.execPath,
    args: [path.join(__dirname, 'frame-tool.js'), root], env: {ELECTRON_RUN_AS_NODE: '1', ...(bridge ? {FRAMEPILOT_BRIDGE: bridge.path, FRAMEPILOT_TOKEN: bridge.token} : {})}}}}, null, 2));
  return file;
}

export class Claude {
  job?: Job;
  constructor(private processes: Processes, private event: (event: AppEvent) => void,
    private log: (text: string) => void, private changed: () => void, private bridge: () => Bridge | undefined = () => undefined) {}

  async send(root: string, project: Project, request: string, executable: string, model = '', effort = '') {
    if (this.job) throw new Error('Aguarde ou interrompa a resposta atual.');
    if (typeof request !== 'string' || !request.trim() || request.length > 100_000) throw new Error('Pedido vazio ou muito longo.');
    await ensureProjectSkills(root);
    const {prompt, changeIds, assetIds} = promptFor(project, request.trim());
    const bridge = this.bridge();
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--permission-mode', 'acceptEdits', '--tools', 'Read,Write,Edit,Glob,Grep,Skill',
      '--allowedTools', [`Read,Write,Edit,Glob,Grep,Skill,${FRAME_TOOL}`, ...(bridge ? TERMINAL_TOOLS : [])].join(','),
      '--append-system-prompt', bridge ? `${skillReminder}\n${terminalReminder}` : skillReminder,
      '--mcp-config', await frameToolConfig(root, bridge), '--strict-mcp-config'];
    if (model) args.push('--model', model);
    if (effort) args.push('--effort', effort);
    if (project.session.id) args.push('--resume', project.session.id);
    const message = {id: randomUUID(), role: 'user' as const, text: request, at: new Date().toISOString(),
      context: {assets: assetIds.map(id => {
        const a = project.assets.find(asset => asset.id === id)!;
        return {id: a.id, name: a.name, kind: a.kind, path: a.path, note: a.note};
      }), status: 'sending' as 'sending' | 'shared' | 'failed', sessionId: project.session.id}};
    project.messages.push(message);
    await persist(root, project);
    let output = '';
    let streamed = false;
    let result: any;
    let interrupted = false;
    this.changed();
    try {
      this.job = this.processes.start(claudeExecutable(executable), args, root);
      const originalStop = this.job.stop;
      this.job.stop = () => {interrupted = true; originalStop();};
      this.changed();
      this.log(project.session.id ? 'Retomando a sessão Claude existente…' : 'Iniciando Claude com o contexto do projeto…');
      this.job.child.stdin?.end(prompt);
      const code = await jsonLines(this.job, async value => {
        if (typeof value.session_id === 'string' && /^[a-f0-9-]{36}$/i.test(value.session_id)) {
          if (project.session.id !== value.session_id) {
            project.session.id = value.session_id;
            await persist(root, project);
          }
        }
        if (value.type === 'stream_event') {
          const delta = value.event?.delta;
          if (delta?.type === 'text_delta') {
            streamed = true;
            this.event({type: 'delta', text: delta.text});
          }
          if (value.event?.content_block?.type === 'tool_use') this.log(`Claude: ${value.event.content_block.name}`);
        }
        if (value.type === 'assistant') {
          for (const block of value.message?.content ?? []) {
            if (block.type === 'text') {
              output += block.text + '\n';
              if (!streamed) this.event({type: 'delta', text: block.text + '\n'});
            }
            if (block.type === 'tool_use') this.log(`Ferramenta: ${block.name}${block.input?.file_path ? ` — ${block.input.file_path}` : ''}`);
          }
        }
        if (value.type === 'result') {
          result = value;
          if (value.permission_denials?.length) this.log('Claude encontrou uma operação sem permissão. Veja a resposta; comandos de terminal passam por mcp__framepilot__run_command.');
        }
        if (value.type === 'system' && value.subtype === 'api_retry') this.log(`Claude: nova tentativa (${value.error}).`);
      }, this.log);
      if (interrupted) throw new Error('Solicitação interrompida. Arquivos já editados foram mantidos.');
      if (code !== 0 || !result || result.is_error) {
        throw new Error(result?.result || result?.errors?.join('\n') || 'Claude não concluiu. Verifique instalação/autenticação e os logs. Se a sessão não existir mais, clique em Nova sessão.');
      }
      message.context.status = 'shared';
      message.context.sessionId = project.session.id;
      project.session.initialSent = true;
      project.pendingAssetIds = (project.pendingAssetIds ?? []).filter(id => !assetIds.includes(id));
      project.changes = project.changes.filter(c => !changeIds.includes(c.id));
      project.messages.push({id: randomUUID(), role: 'assistant', text: output.trim() || result.result || 'Concluído.', at: new Date().toISOString()});
    } catch (error) {
      message.context.status = 'failed';
      this.job?.stop();
      await this.job?.done.catch(() => {});
      const errorText = (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? 'Claude Code não encontrado. Instale o CLI e faça login uma vez com claude. Se necessário, configure o caminho do executável em Ferramentas.'
        : (error as Error).message;
      project.messages.push({id: randomUUID(), role: 'system', text: errorText, at: new Date().toISOString()});
      if (output.trim()) project.messages.push({id: randomUUID(), role: 'assistant', text: output.trim() + '\n[Resposta incompleta]', at: new Date().toISOString()});
      this.log(errorText);
    } finally {
      this.job = undefined;
      await persist(root, project);
      this.changed();
    }
  }
}
