import os from 'node:os';
import path from 'node:path';
import {promises as fs} from 'node:fs';
import type {IPty} from 'node-pty';
import type {AppEvent, LoginKind, ProviderStatus, Settings} from '../shared/types';
import {antigravityExecutable, claudeExecutable, environment, opencodeExecutable, Processes} from './processes';

/** Runs a short CLI command and returns its exit code and combined output; ENOENT becomes code null. */
export async function capture(processes: Processes, command: string, args: string[], timeout = 15000, env = environment()) {
  try {
    const job = processes.start(command, args, os.homedir(), env);
    job.child.stdin?.end();
    let output = '';
    job.child.stdout?.on('data', chunk => {output += chunk.toString().slice(0, 200_000);});
    job.child.stderr?.on('data', chunk => {output += chunk.toString().slice(0, 200_000);});
    const timer = setTimeout(job.stop, timeout);
    try {return {code: await job.done, output: output.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')};}
    finally {clearTimeout(timer);}
  } catch {return {code: null, output: ''};}
}

/** ElevenLabs' hosted MCP server. It signs in with OAuth, so FramePilot never sees an API key:
 *  each agent CLI stores its own token under the server name, which every session config reuses. */
export const ELEVENLABS = {name: 'elevenlabs', url: 'https://api.elevenlabs.io/v1/mcp'};
export const elevenlabsClaudeServer = () => ({type: 'http', url: ELEVENLABS.url});
export const elevenlabsOpencodeServer = () => ({type: 'remote', url: ELEVENLABS.url, enabled: true});
/** A config with only ElevenLabs, for OpenCode's sign-in and status commands. */
async function elevenlabsOpencodeEnv() {
  const file = path.join(os.tmpdir(), 'framepilot-opencode-elevenlabs.json');
  await fs.writeFile(file, JSON.stringify({$schema: 'https://opencode.ai/config.json', mcp: {[ELEVENLABS.name]: elevenlabsOpencodeServer()}}));
  return {...environment(), OPENCODE_CONFIG: file};
}
async function elevenlabsStatus(processes: Processes, settings: Settings) {
  const [claude, opencode] = await Promise.all([
    capture(processes, claudeExecutable(settings.claudePath), ['mcp', 'get', ELEVENLABS.name], 30000),
    capture(processes, opencodeExecutable(settings.opencodePath), ['mcp', 'auth', 'list'], 30000, await elevenlabsOpencodeEnv())
  ]);
  const line = opencode.output.split(/\r?\n/).find(l => l.includes(ELEVENLABS.name)) ?? '';
  return {antigravity: false, claude: claude.code === 0 && /Status:.*Connected/i.test(claude.output),
    opencode: opencode.code === 0 && /✓|authenticated/i.test(line) && !/not authenticated|expired/i.test(line)};
}

/** Providers with saved OpenCode credentials (names only; secrets are never read into the app). */
async function opencodeProviders() {
  const data = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  try {return Object.keys(JSON.parse(await fs.readFile(path.join(data, 'opencode', 'auth.json'), 'utf8')));}
  catch {return [];}
}

/** `antigravity models` só responde autenticado, então ele serve de teste de instalação e de login ao mesmo tempo. */
export async function antigravityModels(processes: Processes, settings: Settings) {
  const executable = antigravityExecutable(settings.antigravityPath);
  const {code, output} = await capture(processes, executable, ['models'], 60000);
  if (code !== 0) return {installed: code !== null, path: executable, models: []};
  // Cada linha é "id<TAB>Rótulo"; fica só o id, que é o que vai em --model.
  const models = output.split(/\r?\n/).map(line => line.split('\t')[0].trim())
    .filter(id => /^[a-z0-9][a-z0-9.-]{1,80}$/.test(id));
  return {installed: true, path: executable, models};
}

export async function providerStatus(processes: Processes, settings: Settings): Promise<ProviderStatus> {
  const [claude, opencode, providers, elevenlabs, antigravity] = await Promise.all([
    capture(processes, claudeExecutable(settings.claudePath), ['auth', 'status']),
    capture(processes, opencodeExecutable(settings.opencodePath), ['--version']),
    opencodeProviders(),
    elevenlabsStatus(processes, settings),
    antigravityModels(processes, settings)
  ]);
  let auth: {loggedIn?: boolean; email?: string; authMethod?: string} = {};
  try {auth = JSON.parse(claude.output.slice(claude.output.indexOf('{')));} catch {}
  return {
    // `auth status` exits non-zero when logged out, so a parsed answer is what proves the CLI exists.
    claude: {installed: claude.code !== null && (claude.code === 0 || 'loggedIn' in auth), loggedIn: auth.loggedIn === true,
      account: auth.email, method: auth.authMethod},
    opencode: {installed: opencode.code === 0, version: opencode.output.trim().split('\n').pop(), providers},
    antigravity,
    elevenlabs
  };
}

/** `opencode models` already lists only models usable with the configured credentials. Free models first. */
export async function opencodeModels(processes: Processes, settings: Settings) {
  const {code, output} = await capture(processes, opencodeExecutable(settings.opencodePath), ['models'], 60000);
  if (code !== 0) throw new Error('OpenCode não respondeu. Verifique a instalação.');
  const models = [...new Set(output.split(/\r?\n/).map(l => l.trim()).filter(l => /^[\w.-]+\/[\w.:@/-]+$/.test(l)))];
  const free = (m: string) => m.startsWith('opencode/') && m.endsWith('-free');
  return models.sort((a, b) => Number(free(b)) - Number(free(a)) || a.localeCompare(b));
}

/** Registers ElevenLabs with Claude Code (user scope) so `claude mcp login` can sign in to it. */
export async function registerElevenlabsForClaude(processes: Processes, settings: Settings) {
  const claude = claudeExecutable(settings.claudePath);
  const existing = await capture(processes, claude, ['mcp', 'get', ELEVENLABS.name], 30000);
  if (existing.code === 0 && existing.output.includes(ELEVENLABS.url)) return;
  // Never replace a server the user configured by hand under the same name.
  if (existing.code === 0) throw new Error(`Já existe um servidor MCP "${ELEVENLABS.name}" no Claude Code apontando para outro endereço. Remova-o com "claude mcp remove ${ELEVENLABS.name}" e tente de novo.`);
  const added = await capture(processes, claude, ['mcp', 'add', '--scope', 'user', '--transport', 'http', ELEVENLABS.name, ELEVENLABS.url]);
  if (added.code !== 0) throw new Error(`Não foi possível registrar a ElevenLabs no Claude Code: ${added.output.trim().slice(0, 300) || 'Claude Code não encontrado.'}`);
}

/** One interactive login (or install) at a time, in a pseudo-terminal the connect screen renders. */
export class LoginShell {
  private pty?: IPty;
  constructor(private emit: (event: AppEvent) => void) {}

  private async command(kind: LoginKind, settings: Settings): Promise<[string, string[], NodeJS.ProcessEnv?]> {
    const opencode = opencodeExecutable(settings.opencodePath);
    switch (kind) {
      // Signs in the CLI of the current engine. Claude needs the server registered (user scope) before login.
      case 'elevenlabs': if (settings.engine === 'opencode') return [opencode, ['mcp', 'auth', ELEVENLABS.name], await elevenlabsOpencodeEnv()];
        return [claudeExecutable(settings.claudePath), ['mcp', 'login', ELEVENLABS.name]];
      case 'claude': return [claudeExecutable(settings.claudePath), ['auth', 'login']];
      case 'opencode-openai': return [opencode, ['providers', 'login', '--provider', 'openai']];
      case 'opencode-copilot': return [opencode, ['providers', 'login', '--provider', 'github-copilot']];
      case 'opencode-other': return [opencode, ['providers', 'login']];
      case 'install-opencode': return [settings.npmPath || 'npm', ['install', '-g', 'opencode-ai@latest']];
    }
  }

  async start(kind: LoginKind, settings: Settings, cols: number, rows: number) {
    this.stop();
    const [program, args, env = environment()] = await this.command(kind, settings);
    const {spawn} = await import('node-pty');
    // On Windows the CLIs are often .cmd/.ps1 shims that CreateProcess cannot start directly; PowerShell resolves them.
    const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
    const [file, argv] = process.platform === 'win32'
      ? ['powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `& ${[program, ...args].map(quote).join(' ')}; exit $LASTEXITCODE`]]
      : [program, args];
    const pty = spawn(file, argv, {name: 'xterm-256color', cols, rows, cwd: os.homedir(), env: env as Record<string, string>});
    this.pty = pty;
    pty.onData(data => {if (this.pty === pty) this.emit({type: 'login', data});});
    pty.onExit(({exitCode}) => {
      if (this.pty !== pty) return;
      this.pty = undefined;
      this.emit({type: 'login-exit', code: exitCode});
    });
  }
  write(data: string) {this.pty?.write(data);}
  resize(cols: number, rows: number) {try {this.pty?.resize(cols, rows);} catch {}}
  stop() {
    const pty = this.pty;
    this.pty = undefined;
    try {pty?.kill();} catch {}
  }
}
