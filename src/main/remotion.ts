import {promises as fs} from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {Processes, environment, logJob, type Job} from './processes';
import {homedir} from 'node:os';
import type {ProjectKind, Settings} from '../shared/types';
import {HYPERFRAMES_VERSION} from './project';

export class Remotion {
  studio?: Job;
  operation?: Job;
  url: string | null = null;
  constructor(private processes: Processes, private log: (text: string) => void, private changed: () => void) {}
  /**
   * O HyperFrames exige ffmpeg e ffprobe no PATH, e o FramePilot não os instala: eles vêm
   * dentro do pacote compositor do Remotion. Procura no próprio projeto e, não achando (que é
   * o caso de um projeto HyperFrames), em qualquer projeto Remotion da biblioteca.
   */
  /**
   * O HyperFrames precisa de um FFmpeg COMPLETO no PATH, com ffprobe. O que vem no compositor
   * do Remotion não serve: é uma build reduzida, sem filtros que o HyperFrames usa (setparams,
   * gblur). Emprestá-la faz o render morrer no meio com "No such filter", o que é pior que
   * falhar na largada, então aqui só vale um FFmpeg do sistema.
   */
  async systemFfmpeg(): Promise<boolean> {
    for (const tool of ['ffmpeg', 'ffprobe']) {
      try {
        const job = this.processes.start(tool, ['-version'], homedir());
        job.child.stdin?.end();
        job.child.stdout?.resume();
        job.child.stderr?.resume();
        const timeout = setTimeout(job.stop, 10000);
        try {if (await job.done !== 0) return false;} finally {clearTimeout(timeout);}
      } catch {return false;}
    }
    return true;
  }
  /**
   * HyperFrames roda por npx, sem node_modules no projeto, então não há "instalar dependências":
   * o próprio preview/render baixa a versão fixada no package.json na primeira vez.
   */
  async hyperframesEnv() {
    if (!await this.systemFfmpeg()) {
      throw new Error('Projetos HyperFrames precisam do FFmpeg completo (com ffprobe) instalado no sistema. '
        + 'No Windows: winget install --id Gyan.FFmpeg -e, e reabra o FramePilot. '
        + 'O FFmpeg que acompanha o Remotion é uma build reduzida e não atende o HyperFrames. Projetos Remotion não são afetados.');
    }
    return environment();
  }
  hyperframesArgs(kind: 'preview' | 'render', port: number, output: string, settings: Settings): string[] {
    const args = ['--yes', `hyperframes@${HYPERFRAMES_VERSION}`, kind];
    if (kind === 'preview') return [...args, '--port', String(port), '--no-open'];
    const workers = settings.concurrency?.trim();
    return [...args, '--output', output, '--format', 'mp4', ...(workers ? ['--workers', workers] : [])];
  }
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
  async preview(root: string, settings: Settings, kind: ProjectKind = 'remotion', library = '') {
    await this.stopStudio();
    const cli = kind === 'hyperframes' ? '' : await this.cli(root);
    const port = await new Promise<number>((resolve, reject) => {
      const server = net.createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {const port = (server.address() as net.AddressInfo).port; server.close(() => resolve(port));});
    });
    const job = kind === 'hyperframes'
      ? this.processes.start(settings.npmPath ? path.join(path.dirname(settings.npmPath), 'npx') : 'npx', this.hyperframesArgs('preview', port, '', settings), root, await this.hyperframesEnv())
      : this.processes.start(settings.nodePath || 'node', [cli, 'studio', 'src/index.ts', '--no-open', '--port', String(port), '--ipv4'], path.join(root, 'remotion'));
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
  /**
   * Argumentos do render. A concorrência fica a cargo do Remotion por padrão (ele usa os núcleos
   * disponíveis); forçar 1 thread deixava o export várias vezes mais lento sem necessidade.
   */
  renderArgs(settings: Settings): string[] {
    const args = ['--codec', 'h264'];
    const concurrency = settings.concurrency?.trim();
    if (concurrency) args.push('--concurrency', concurrency);
    if (settings.gpu) {
      // O chrome-headless-shell padrão não expõe GPU: só o Chrome for Testing com ANGLE usa a placa.
      args.push('--chrome-mode', 'chrome-for-testing', '--gl', 'angle');
      // Encode por NVENC/QuickSync quando houver; cai para x264 sozinho se não houver.
      args.push('--hardware-acceleration', 'if-possible');
    }
    return args;
  }
  async render(root: string, output: string, settings: Settings, kind: ProjectKind = 'remotion', library = '') {
    if (kind === 'hyperframes') {
      const args = this.hyperframesArgs('render', 0, output, settings);
      this.log(`Renderizando com HyperFrames: ${args.slice(2).join(' ')}`);
      this.operation = this.processes.start(settings.npmPath ? path.join(path.dirname(settings.npmPath), 'npx') : 'npx', args, root, await this.hyperframesEnv());
      this.operation.child.stdin?.end();
      try {await logJob(this.operation, this.log); await fs.access(output);} finally {this.operation = undefined;}
      return;
    }
    const cli = await this.cli(root);
    const args = this.renderArgs(settings);
    this.log(`Renderizando com: ${args.join(' ')}${settings.concurrency?.trim() ? '' : ' (concorrência automática)'}`);
    this.operation = this.processes.start(settings.nodePath || 'node',
      [cli, 'render', 'src/index.ts', 'Main', output, ...args], path.join(root, 'remotion'));
    this.operation.child.stdin?.end();
    try {await logJob(this.operation, this.log); await fs.access(output);} finally {this.operation = undefined;}
  }
}
