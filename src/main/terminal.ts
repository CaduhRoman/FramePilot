import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {existsSync, promises as fs} from 'node:fs';
import {randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';
import type {IPty} from 'node-pty';
import type {AppEvent, CommandOutput, CommandRecord} from '../shared/types';
import {environment, Processes, type Job} from './processes';
import {reviewCommand} from './command-policy';
import {ffmpegDir} from './media';

const OUTPUT_LIMIT = 256_000; // Per stream, kept in memory while the app runs.
const SAVED_OUTPUT = 16_000; // Per stream, written to the project's history file.
const RETURNED_OUTPUT = 30_000; // Per stream, returned to the agent in one tool result.
const HISTORY_LIMIT = 200;
const SCROLLBACK_LIMIT = 200_000;
const tail = (text: string, size: number) => text.length > size ? text.slice(-size) : text;
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms).unref());
const historyFile = (root: string) => path.join(root, '.framepilot', 'terminal-history.json');

/** Local socket the MCP server (child of Claude Code) uses to reach the main process. Token changes every launch. */
export interface Bridge {path: string; token: string}
interface Entry {record: CommandRecord; output: CommandOutput; job?: Job; done: Promise<void>; stopping?: boolean}

/** Non-interactive shell for agent commands: PowerShell on Windows, bash/sh elsewhere. Exit code mirrors the last command. */
function shell(command: string): [string, string[]] {
  if (process.platform !== 'win32') return [existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh', ['-c', command]];
  const script = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8; $ProgressPreference = 'SilentlyContinue'\n${command}\n`
    + 'if (-not $?) { if ($LASTEXITCODE) { exit $LASTEXITCODE } else { exit 1 } }\nif ($LASTEXITCODE) { exit $LASTEXITCODE }\nexit 0';
  return ['powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]];
}

export class Terminal {
  entries: Entry[] = [];
  root: string | null = null;
  bridge?: Bridge;
  private server?: net.Server;
  private pty?: IPty;
  private scrollback = '';
  private saving = Promise.resolve();

  constructor(private processes: Processes, private emit: (event: AppEvent) => void, private changed: () => void,
    private approve: (record: CommandRecord) => Promise<boolean>) {}

  commands(): CommandRecord[] {return this.entries.map(e => e.record);}

  /** Switches to another project (or none): stops its commands and shell, then loads that project's history. */
  async open(root: string | null) {
    if (root === this.root) return;
    await this.stopAll();
    this.killPty();
    this.root = root;
    this.entries = [];
    if (root) {
      try {
        const saved = JSON.parse(await fs.readFile(historyFile(root), 'utf8')) as {record: CommandRecord; output: CommandOutput}[];
        this.entries = saved.filter(s => s?.record?.id && s.output).map(s => ({...s, done: Promise.resolve(),
          record: {...s.record, status: s.record.status === 'running' || s.record.status === 'pending' ? 'stopped' : s.record.status}}));
      } catch {}
    }
    this.changed();
  }

  private env(root: string | null) {
    const env = environment();
    env.PYTHONIOENCODING = 'utf-8';
    env.PYTHONUNBUFFERED = '1';
    if (root) env.FRAMEPILOT_PROJECT = root;
    return ffmpegDir(root ?? '').then(dir => {env.PATH = dir + path.delimiter + env.PATH; return env;}, () => env);
  }

  private save() {
    const root = this.root;
    if (!root) return;
    const data = this.entries.map(e => ({record: e.record, output: {stdout: tail(e.output.stdout, SAVED_OUTPUT), stderr: tail(e.output.stderr, SAVED_OUTPUT)}}));
    this.saving = this.saving.then(async () => {
      await fs.mkdir(path.dirname(historyFile(root)), {recursive: true});
      await fs.writeFile(historyFile(root), JSON.stringify(data));
    }).catch(() => {});
  }

  /** Runs an agent command after the main-process permission review. */
  async run(root: string, input: any) {
    if (!this.root || path.resolve(root) !== path.resolve(this.root)) throw new Error('O projeto aberto no FramePilot mudou; comando recusado.');
    const command = typeof input?.command === 'string' ? input.command.trim() : '';
    if (!command || command.length > 20_000 || command.includes('\0')) throw new Error('Comando vazio, inválido ou longo demais.');
    if (input.cwd !== undefined && typeof input.cwd !== 'string') throw new Error('cwd inválido.');
    const cwd = path.resolve(this.root, input.cwd?.trim() || '.');
    const reasons = reviewCommand(command, cwd, this.root);
    const record: CommandRecord = {id: randomUUID().slice(0, 8), source: 'agent', command, cwd, status: reasons.length ? 'pending' : 'running',
      exitCode: null, startedAt: new Date().toISOString(), reasons};
    const entry: Entry = {record, output: {stdout: '', stderr: ''}, done: Promise.resolve()};
    this.entries.push(entry);
    if (this.entries.length > HISTORY_LIMIT) this.entries.splice(0, this.entries.length - HISTORY_LIMIT);
    this.changed();
    if (reasons.length && !await this.approve(record).catch(() => false)) {
      Object.assign(record, {status: 'denied', endedAt: new Date().toISOString()});
      this.changed();
      this.save();
      return this.result(entry);
    }
    record.status = 'running';
    const timeout = Math.min(600, Math.max(1, Number(input.timeout_seconds) || 120));
    this.start(entry, await this.env(this.root));
    await Promise.race([entry.done, sleep(input.background ? 1500 : timeout * 1000)]);
    return this.result(entry);
  }

  private start(entry: Entry, env: NodeJS.ProcessEnv) {
    const {record, output} = entry;
    const append = (stream: 'stdout' | 'stderr', text: string) => {
      output[stream] = tail(output[stream] + text, OUTPUT_LIMIT);
      this.emit({type: 'command-output', id: record.id, stream, text});
    };
    const finish = (status: CommandRecord['status'], code: number | null) => {
      Object.assign(record, {status: entry.stopping ? 'stopped' : status, exitCode: code, endedAt: new Date().toISOString()});
      entry.job = undefined;
      this.changed();
      this.save();
    };
    if (!existsSync(record.cwd)) {append('stderr', `Pasta não encontrada: ${record.cwd}\n`); finish('failed', null); return;}
    try {
      const [program, args] = shell(record.command);
      entry.job = this.processes.start(program, args, record.cwd, env);
    } catch (error) {append('stderr', `${(error as Error).message}\n`); finish('failed', null); return;}
    entry.job.child.stdin?.end();
    entry.job.child.stdout?.setEncoding('utf8').on('data', (text: string) => append('stdout', text));
    entry.job.child.stderr?.setEncoding('utf8').on('data', (text: string) => append('stderr', text));
    entry.done = entry.job.done.then(code => finish(code === 0 ? 'done' : 'failed', code),
      error => {append('stderr', `${(error as Error).message}\n`); finish('failed', null);});
    this.changed();
  }

  private find(id: unknown) {
    const entry = this.entries.find(e => e.record.id === id);
    if (!entry) throw new Error(`Comando "${String(id)}" não encontrado no histórico.`);
    return entry;
  }

  private result(entry: Entry) {
    const {record, output} = entry;
    const running = record.status === 'running';
    return {id: record.id, status: record.status, exit_code: record.exitCode, running, cwd: record.cwd,
      stdout: tail(output.stdout, RETURNED_OUTPUT), stderr: tail(output.stderr, RETURNED_OUTPUT),
      truncated: output.stdout.length > RETURNED_OUTPUT || output.stderr.length > RETURNED_OUTPUT,
      note: record.status === 'denied' ? `O usuário negou este comando (${record.reasons.join('; ')}). Não tente contorná-lo; explique ou peça outra abordagem.`
        : running ? `Ainda em execução. Use command_status com id "${record.id}" para acompanhar ou stop_command para interromper.` : undefined};
  }

  async status(input: any) {
    const entry = this.find(input?.id);
    const wait = Math.min(600, Math.max(0, Number(input?.wait_seconds) || 0));
    if (wait && entry.record.status === 'running') await Promise.race([entry.done, sleep(wait * 1000)]);
    return this.result(entry);
  }

  async stop(id: unknown) {
    const entry = this.find(id);
    if (!entry.job) return this.result(entry);
    entry.stopping = true;
    entry.job.stop();
    await Promise.race([entry.done, sleep(5000)]);
    return this.result(entry);
  }

  /** Stops every command still running (Interromper, project switch). */
  async stopAll() {
    const running = this.entries.filter(e => e.job);
    running.forEach(e => {e.stopping = true; e.job!.stop();});
    await Promise.allSettled(running.map(e => e.done));
  }

  output(id: unknown): CommandOutput {return {...this.find(id).output};}

  clear() {
    this.entries = this.entries.filter(e => e.job);
    this.changed();
    this.save();
  }

  list() {
    return this.entries.slice(-30).map(({record}) => ({id: record.id, status: record.status, exit_code: record.exitCode, command: record.command.slice(0, 300), started_at: record.startedAt}));
  }

  // User's interactive shell. It is the user's own terminal, so it is not filtered; only the main window can drive it.
  async ptyStart(cols: number, rows: number) {
    // Concurrent mounts share one shell.
    this.ptyReady ??= this.spawnPty(cols, rows).finally(() => {this.ptyReady = undefined;});
    await this.ptyReady;
    return this.scrollback;
  }
  private ptyReady?: Promise<void>;
  private async spawnPty(cols: number, rows: number) {
    if (!this.pty) {
      const {spawn} = await import('node-pty');
      const program = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash';
      const root = this.root;
      const pty = spawn(program, process.platform === 'win32' ? ['-NoLogo'] : [], {name: 'xterm-256color', cols, rows,
        cwd: root && existsSync(root) ? root : os.homedir(), env: await this.env(root) as Record<string, string>});
      this.pty = pty;
      pty.onData(data => {
        this.scrollback = tail(this.scrollback + data, SCROLLBACK_LIMIT);
        this.emit({type: 'pty', data});
      });
      pty.onExit(() => {
        if (this.pty !== pty) return;
        this.pty = undefined;
        const notice = '\r\n[Terminal encerrado. Clique em Reiniciar para abrir outro.]\r\n';
        this.scrollback += notice;
        this.emit({type: 'pty', data: notice});
      });
    } else this.pty.resize(cols, rows);
  }
  ptyWrite(data: string) {this.pty?.write(data);}
  ptyResize(cols: number, rows: number) {try {this.pty?.resize(cols, rows);} catch {}}
  killPty() {
    const pty = this.pty;
    this.pty = undefined;
    this.scrollback = '';
    try {pty?.kill();} catch {}
  }

  async listen() {
    const token = randomBytes(24).toString('hex');
    const name = `framepilot-${randomUUID()}`;
    const address = process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : path.join(os.tmpdir(), `${name}.sock`);
    const expected = Buffer.from(token);
    this.server = net.createServer(socket => {
      socket.setEncoding('utf8');
      let buffer = '';
      socket.on('error', () => {});
      socket.on('data', (chunk: string) => {
        buffer += chunk;
        if (buffer.length > 1_000_000) {socket.destroy(); return;}
        let index: number;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          let message: any;
          try {message = JSON.parse(line);} catch {socket.destroy(); return;}
          const given = Buffer.from(String(message?.token ?? ''));
          if (given.length !== expected.length || !timingSafeEqual(given, expected)) {socket.destroy(); return;}
          void this.call(message.method, message.params ?? {}, String(message.root ?? ''))
            .then(result => ({id: message.id, result}), error => ({id: message.id, error: (error as Error).message}))
            .then(reply => {if (!socket.destroyed) socket.write(JSON.stringify(reply) + '\n');});
        }
      });
    });
    await new Promise<void>((resolve, reject) => {this.server!.once('error', reject); this.server!.listen(address, () => resolve());});
    if (process.platform !== 'win32') await fs.chmod(address, 0o600);
    this.bridge = {path: address, token};
  }

  private async call(method: string, params: any, root: string) {
    if (!this.root || path.resolve(root) !== path.resolve(this.root)) throw new Error('Este projeto não está aberto no FramePilot.');
    if (method === 'run') return this.run(root, params);
    if (method === 'status') return this.status(params);
    if (method === 'stop') {
      if (this.find(params.id).record.source !== 'agent') throw new Error('Somente comandos do agente podem ser interrompidos por ele.');
      return this.stop(params.id);
    }
    if (method === 'list') return this.list();
    throw new Error(`Método desconhecido: ${method}`);
  }

  async dispose() {
    this.killPty();
    await this.saving;
    const server = this.server;
    this.server = undefined;
    await new Promise<void>(resolve => server ? server.close(() => resolve()) : resolve());
  }
}
