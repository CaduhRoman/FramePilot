import {ensureProjectSkills, skillReminder} from './skills';
import {randomUUID} from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import type {AgentEngine, AppEvent, Project, Settings} from '../shared/types';
import {persist, promptFor} from './project';
import {claudeExecutable, environment, jsonLines, opencodeExecutable, Processes, type Job} from './processes';
import type {Bridge} from './terminal';

export const FRAME_TOOL = 'mcp__framepilot__extract_frames';
export const TERMINAL_TOOLS = ['run_command', 'command_status', 'stop_command', 'list_commands'].map(name => `mcp__framepilot__${name}`);
const terminalReminder = (tool: string) => `Para executar comandos reais (python, ffmpeg/ffprobe, git, npm, scripts) use ${tool}; `
  + 'o diretório padrão é a raiz do projeto. Comandos destrutivos ou fora do projeto pedem confirmação do usuário: se ele negar, não contorne.';
const SESSION_ID: Record<AgentEngine, RegExp> = {claude: /^[a-f0-9-]{36}$/i, opencode: /^ses_[A-Za-z0-9]{8,64}$/};
const NAMES: Record<AgentEngine, string> = {claude: 'Claude', opencode: 'OpenCode'};

/** The FramePilot MCP server (frames + terminal tools). Electron runs the bundled frame-tool in Node mode. */
function mcpServer(root: string, bridge?: Bridge) {
  return {command: process.execPath, args: [path.join(__dirname, 'frame-tool.js'), root],
    env: {ELECTRON_RUN_AS_NODE: '1', ...(bridge ? {FRAMEPILOT_BRIDGE: bridge.path, FRAMEPILOT_TOKEN: bridge.token} : {})}};
}
async function frameToolConfig(root: string, bridge?: Bridge) {
  const file = path.join(root, '.claude', 'framepilot-mcp.json');
  await fs.mkdir(path.dirname(file), {recursive: true});
  await fs.writeFile(file, JSON.stringify({mcpServers: {framepilot: {type: 'stdio', ...mcpServer(root, bridge)}}}, null, 2));
  return file;
}
/** OpenCode config passed through OPENCODE_CONFIG, so the user's project root stays clean. Shell access goes
 *  through FramePilot's run_command (reviewed and confirmed), mirroring the tool set given to Claude Code. */
async function opencodeConfig(root: string, bridge?: Bridge) {
  const file = path.join(root, '.framepilot', 'opencode.json');
  const server = mcpServer(root, bridge);
  await fs.mkdir(path.dirname(file), {recursive: true});
  await fs.writeFile(file, JSON.stringify({$schema: 'https://opencode.ai/config.json',
    instructions: [path.join(root, 'CLAUDE.md')],
    mcp: {framepilot: {type: 'local', command: [server.command, ...server.args], environment: server.env, enabled: true}},
    permission: {bash: 'deny', webfetch: 'deny', websearch: 'deny', external_directory: 'deny', question: 'deny', edit: 'allow', read: 'allow'}}, null, 2));
  return file;
}

/** Runs one request through the selected agent CLI (Claude Code or OpenCode) and records it in the project. */
export class Claude {
  job?: Job;
  constructor(private processes: Processes, private event: (event: AppEvent) => void,
    private log: (text: string) => void, private changed: () => void, private bridge: () => Bridge | undefined = () => undefined) {}

  async send(root: string, project: Project, request: string, settings: Settings) {
    if (this.job) throw new Error('Aguarde ou interrompa a resposta atual.');
    if (typeof request !== 'string' || !request.trim() || request.length > 100_000) throw new Error('Pedido vazio ou muito longo.');
    const engine: AgentEngine = settings.engine === 'opencode' ? 'opencode' : 'claude';
    const name = NAMES[engine];
    await ensureProjectSkills(root);
    // Session IDs belong to one CLI. After switching providers, start over with the full briefing.
    if ((project.session.engine ?? 'claude') !== engine) {
      if (project.session.id || project.session.initialSent) {
        project.pendingAssetIds = [...new Set([...(project.pendingAssetIds ?? []), ...(project.essentialAssetIds ?? [])])];
        project.messages.push({id: randomUUID(), role: 'system', at: new Date().toISOString(),
          text: `Nova sessão: provedor de IA trocado para ${name}. O briefing e as referências essenciais serão reapresentados.`});
      }
      project.session = {initialSent: false, engine};
    }
    const {prompt, changeIds, assetIds} = promptFor(project, request.trim());
    const bridge = this.bridge();
    const reminder = bridge ? `${skillReminder}\n${terminalReminder(engine === 'claude' ? 'mcp__framepilot__run_command' : 'framepilot_run_command')}` : skillReminder;
    let command: string, args: string[], input = prompt, env = environment();
    if (engine === 'claude') {
      command = claudeExecutable(settings.claudePath);
      args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
        '--permission-mode', 'acceptEdits', '--tools', 'Read,Write,Edit,Glob,Grep,Skill',
        '--allowedTools', [`Read,Write,Edit,Glob,Grep,Skill,${FRAME_TOOL}`, ...(bridge ? TERMINAL_TOOLS : [])].join(','),
        '--append-system-prompt', reminder,
        '--mcp-config', await frameToolConfig(root, bridge), '--strict-mcp-config'];
      if (settings.model) args.push('--model', settings.model);
      if (settings.effort) args.push('--effort', settings.effort);
    } else {
      command = opencodeExecutable(settings.opencodePath);
      // --auto approves only what the config does not deny (bash, web and outside-project access are denied).
      args = ['run', '--format', 'json', '--auto', '--model', settings.opencodeModel];
      env = {...env, OPENCODE_CONFIG: await opencodeConfig(root, bridge)};
      // OpenCode has no appended system prompt; the reminder travels with the request.
      input = `[FRAMEPILOT]\n${reminder}\n\n${prompt}`;
    }
    if (project.session.id) args.push(engine === 'claude' ? '--resume' : '--session', project.session.id);
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
    let failure = '';
    let interrupted = false;
    this.changed();
    const remember = async (id: unknown) => {
      if (typeof id !== 'string' || !SESSION_ID[engine].test(id) || project.session.id === id) return;
      project.session.id = id;
      await persist(root, project);
    };
    const onClaude = async (value: any) => {
      await remember(value.session_id);
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
        if (value.is_error) failure = value.result || value.errors?.join('\n') || '';
        if (value.permission_denials?.length) this.log('Claude encontrou uma operação sem permissão. Veja a resposta; comandos de terminal passam por mcp__framepilot__run_command.');
      }
      if (value.type === 'system' && value.subtype === 'api_retry') this.log(`Claude: nova tentativa (${value.error}).`);
    };
    // OpenCode's JSON events carry whole parts (no token deltas): text, tool_use, step_start/step_finish, error.
    const onOpencode = async (value: any) => {
      await remember(value.sessionID);
      const part = value.part ?? {};
      if (value.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
        output += part.text + '\n';
        this.event({type: 'delta', text: part.text + '\n'});
      }
      if (value.type === 'tool_use') {
        const input = part.state?.input ?? {};
        const target = input.filePath ?? input.file_path ?? input.path ?? input.pattern ?? '';
        this.log(`Ferramenta: ${part.tool}${target ? ` — ${target}` : ''}${part.state?.status === 'error' ? ` (erro: ${String(part.state.error ?? '').slice(0, 300)})` : ''}`);
      }
      if (value.type === 'step_finish') result = value;
      if (value.type === 'error') {
        const error = value.error ?? {};
        failure = error.data?.message || error.message || error.name || 'Erro do OpenCode.';
      }
    };
    try {
      this.job = this.processes.start(command, args, root, env);
      const originalStop = this.job.stop;
      this.job.stop = () => {interrupted = true; originalStop();};
      this.changed();
      this.log(project.session.id ? `Retomando a sessão ${name} existente…` : `Iniciando ${name} com o contexto do projeto…`);
      this.job.child.stdin?.end(input);
      const code = await jsonLines(this.job, engine === 'claude' ? onClaude : onOpencode, this.log);
      if (interrupted) throw new Error('Solicitação interrompida. Arquivos já editados foram mantidos.');
      if (code !== 0 || !result || result.is_error || failure) {
        throw new Error(failure || `${name} não concluiu. Verifique instalação/autenticação e os logs. Se a sessão não existir mais, clique em Nova sessão.`);
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
        ? engine === 'claude'
          ? 'Claude Code não encontrado. Instale o CLI e faça login uma vez com claude. Se necessário, configure o caminho do executável em Ferramentas.'
          : 'OpenCode não encontrado. Instale pela tela "Conectar IA" (Configurações) ou com npm install -g opencode-ai.'
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
