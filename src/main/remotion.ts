import {promises as fs} from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {Processes, environment, logJob, type Job} from './processes';
import type {Settings} from '../shared/types';

export class Remotion {
  studio?: Job;
  operation?: Job;
  url: string | null = null;
  constructor(private processes: Processes, private log: (text: string) => void, private changed: () => void) {}
  async install(root: string, settings: Settings) {
    this.log('Instalando dependências do projeto Remotion…');
    const env = environment();
    if (settings.nodePath) env.PATH = path.dirname(settings.nodePath) + path.delimiter + env.PATH;
    this.operation = this.processes.start(settings.npmPath || 'npm', ['install', '--no-audit', '--no-fund'], path.join(root, 'remotion'), env);
    this.operation.child.stdin?.end();
    try {await logJob(this.operation, this.log);} catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('npm não encontrado. Instale Node.js 22 LTS ou configure npm/Node em Ferramentas.');
      throw error;
    } finally {this.operation = undefined;}
  }
  async cli(root: string) {
    const base = path.join(root, 'remotion/node_modules/@remotion/cli');
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(base, 'package.json'), 'utf8'));
      const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.remotion;
      return path.join(base, bin);
    } catch {throw new Error('Dependências ausentes. Clique em Instalar dependências.');}
  }
  async stopStudio() {
    const job = this.studio;
    this.studio = undefined;
    this.url = null;
    if (job) {job.stop(); await job.done.catch(() => {});}
    this.changed();
  }
  async preview(root: string, settings: Settings) {
    await this.stopStudio();
    const cli = await this.cli(root);
    const port = await new Promise<number>((resolve, reject) => {
      const server = net.createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {const port = (server.address() as net.AddressInfo).port; server.close(() => resolve(port));});
    });
    const job = this.processes.start(settings.nodePath || 'node', [cli, 'studio', 'src/index.ts', '--no-open', '--port', String(port), '--ipv4'], path.join(root, 'remotion'));
    this.studio = job;
    job.child.stdin?.end();
    job.child.stdout?.on('data', chunk => this.log(chunk.toString()));
    job.child.stderr?.on('data', chunk => this.log(chunk.toString()));
    let exited = false;
    let startupError = '';
    void job.done.then(code => {exited = true; startupError = `Remotion encerrou (${code}).`;}, error => {
      exited = true;
      startupError = error.code === 'ENOENT' ? 'Node.js não encontrado. Instale Node.js 22 LTS ou configure seu caminho em Ferramentas.' : error.message;
    }).finally(() => {
      if (this.studio === job) {this.studio = undefined; this.url = null; this.changed();}
    });
    const url = `http://127.0.0.1:${port}`;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (exited) throw new Error(startupError);
      if (this.studio !== job) throw new Error('Inicialização do preview interrompida.');
      try {
        const response = await fetch(url, {signal: AbortSignal.timeout(1000)});
        if (response.ok) {this.url = url; this.changed(); return;}
      } catch {}
      await delay(500);
    }
    await this.stopStudio();
    throw new Error('Preview não iniciou em 60 segundos. Verifique os logs e tente novamente.');
  }
  async render(root: string, output: string, settings: Settings) {
    const cli = await this.cli(root);
    this.operation = this.processes.start(settings.nodePath || 'node', [cli, 'render', 'src/index.ts', 'Main', output, '--codec', 'h264', '--concurrency', '1'], path.join(root, 'remotion'));
    this.operation.child.stdin?.end();
    try {await logJob(this.operation, this.log); await fs.access(output);} finally {this.operation = undefined;}
  }
}
