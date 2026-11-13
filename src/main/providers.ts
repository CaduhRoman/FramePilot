import os from 'node:os';
import path from 'node:path';
import {promises as fs} from 'node:fs';
import type {IPty} from 'node-pty';
import type {AppEvent, LoginKind, ProviderStatus, Settings} from '../shared/types';
import {claudeExecutable, environment, opencodeExecutable, Processes} from './processes';

/** Runs a short CLI command and returns its exit code and combined output; ENOENT becomes code null. */
export async function capture(processes: Processes, command: string, args: string[], timeout = 15000) {
  try {
    const job = processes.start(command, args, os.homedir());
    job.child.stdin?.end();
    let output = '';
    job.child.stdout?.on('data', chunk => {output += chunk.toString().slice(0, 200_000);});
    job.child.stderr?.on('data', chunk => {output += chunk.toString().slice(0, 200_000);});
    const timer = setTimeout(job.stop, timeout);
    try {return {code: await job.done, output: output.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')};}
    finally {clearTimeout(timer);}
  } catch {return {code: null, output: ''};}
}

/** Providers with saved OpenCode credentials (names only; secrets are never read into the app). */
async function opencodeProviders() {
  const data = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  try {return Object.keys(JSON.parse(await fs.readFile(path.join(data, 'opencode', 'auth.json'), 'utf8')));}
  catch {return [];}
}

export async function providerStatus(processes: Processes, settings: Settings): Promise<ProviderStatus> {
  const [claude, opencode, providers] = await Promise.all([
    capture(processes, claudeExecutable(settings.claudePath), ['auth', 'status']),
    capture(processes, opencodeExecutable(settings.opencodePath), ['--version']),
    opencodeProviders()
  ]);
  let auth: {loggedIn?: boolean; email?: string; authMethod?: string} = {};
  try {auth = JSON.parse(claude.output.slice(claude.output.indexOf('{')));} catch {}
  return {
    // `auth status` exits non-zero when logged out, so a parsed answer is what proves the CLI exists.
    claude: {installed: claude.code !== null && (claude.code === 0 || 'loggedIn' in auth), loggedIn: auth.loggedIn === true,
      account: auth.email, method: auth.authMethod},
    opencode: {installed: opencode.code === 0, version: opencode.output.trim().split('\n').pop(), providers}
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

/** One interactive login (or install) at a time, in a pseudo-terminal the connect screen renders. */
export class LoginShell {
  private pty?: IPty;
  constructor(private emit: (event: AppEvent) => void) {}

  private command(kind: LoginKind, settings: Settings): [string, string[]] {
    const opencode = opencodeExecutable(settings.opencodePath);
    switch (kind) {
      case 'claude': return [claudeExecutable(settings.claudePath), ['auth', 'login']];
      case 'opencode-openai': return [opencode, ['providers', 'login', '--provider', 'openai']];
      case 'opencode-copilot': return [opencode, ['providers', 'login', '--provider', 'github-copilot']];
      case 'opencode-other': return [opencode, ['providers', 'login']];
      case 'install-opencode': return [settings.npmPath || 'npm', ['install', '-g', 'opencode-ai@latest']];
    }
  }

  async start(kind: LoginKind, settings: Settings, cols: number, rows: number) {
    this.stop();
    const [program, args] = this.command(kind, settings);
    const {spawn} = await import('node-pty');
    // On Windows the CLIs are often .cmd/.ps1 shims that CreateProcess cannot start directly; PowerShell resolves them.
    const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
    const [file, argv] = process.platform === 'win32'
      ? ['powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `& ${[program, ...args].map(quote).join(' ')}; exit $LASTEXITCODE`]]
      : [program, args];
    const pty = spawn(file, argv, {name: 'xterm-256color', cols, rows, cwd: os.homedir(), env: environment() as Record<string, string>});
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
