import spawn from 'cross-spawn';
import type {ChildProcess} from 'node:child_process';
import {createInterface} from 'node:readline';
import {homedir} from 'node:os';
import {existsSync} from 'node:fs';
import path from 'node:path';

export function environment() {
  const env = {...process.env};
  // Electron's Node mode is only for Remotion, never for an external CLI.
  delete env.ELECTRON_RUN_AS_NODE;
  env.PATH = [path.join(homedir(), '.local', 'bin'), path.join(homedir(), '.npm-global', 'bin'),
    ...(process.platform === 'win32' ? [path.join(process.env.APPDATA || '', 'npm')] : ['/usr/local/bin', '/opt/homebrew/bin']),
    process.env.PATH || ''].join(path.delimiter);
  return env;
}
export function claudeExecutable(custom: string) {
  if (custom.trim()) return custom.trim();
  const native = path.join(homedir(), '.local/bin', process.platform === 'win32' ? 'claude.exe' : 'claude');
  return existsSync(native) ? native : 'claude';
}
export interface Job {
  child: ChildProcess;
  done: Promise<number | null>;
  stop: () => void;
}
export class Processes {
  jobs = new Set<Job>();
  closing = false;
  start(command: string, args: string[], cwd: string, env = environment()): Job {
    if (this.closing) throw new Error('FramePilot está encerrando.');
    const child = spawn(command, args, {cwd, env, windowsHide: true, detached: process.platform !== 'win32', stdio: 'pipe'});
    let escalation: NodeJS.Timeout | undefined;
    const done = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    // The caller can attach its error handler after the spawn without an unhandled rejection.
    void done.catch(() => {});
    const job: Job = {child, done, stop: () => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
      const kill = (signal: NodeJS.Signals) => {
        if (process.platform === 'win32') {
          const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {windowsHide: true});
          killer.on('error', () => child.kill());
        } else {
          try {process.kill(-child.pid!, signal);} catch {child.kill(signal);}
        }
      };
      kill('SIGTERM');
      escalation = setTimeout(() => kill('SIGKILL'), 3000);
      escalation.unref();
    }};
    this.jobs.add(job);
    void done.finally(() => {clearTimeout(escalation); this.jobs.delete(job);}).catch(() => {});
    child.stdin?.on('error', () => {}); // EPIPE is reported through process exit/status.
    return job;
  }
  async stopAll() {
    this.closing = true;
    const jobs = [...this.jobs];
    jobs.forEach(j => j.stop());
    await Promise.allSettled(jobs.map(j => j.done));
  }
}
export async function logJob(job: Job, log: (text: string) => void) {
  job.child.stdout?.on('data', chunk => log(chunk.toString()));
  job.child.stderr?.on('data', chunk => log(chunk.toString()));
  const code = await job.done;
  if (code !== 0) throw new Error(`Processo encerrado (código ${code ?? 'interrompido'}). Consulte os logs.`);
}
export async function jsonLines(job: Job, onMessage: (value: any) => Promise<void>, log: (text: string) => void) {
  job.child.stderr?.on('data', chunk => log(chunk.toString()));
  if (!job.child.stdout) throw new Error('Claude não abriu stdout.');
  const lines = createInterface({input: job.child.stdout, crlfDelay: Infinity});
  for await (const line of lines) {
    if (!line.trim()) continue;
    let value: unknown;
    try {value = JSON.parse(line);} catch {log(line); continue;}
    await onMessage(value);
  }
  return await job.done;
}
