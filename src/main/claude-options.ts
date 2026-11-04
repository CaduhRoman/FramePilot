import {homedir} from 'node:os';
import type {ClaudeOptions} from '../shared/types';
import {claudeExecutable, Processes} from './processes';

/** CLI help is the public capability surface; account entitlements aren't exposed here. */
export async function claudeOptions(processes: Processes, configuredPath: string): Promise<ClaudeOptions> {
  const unavailable: ClaudeOptions = {models: [{value: '', label: 'Padrão'}], efforts: [''],
    notice: 'Claude Code indisponível. Configure o executável nas ferramentas.'};
  try {
    const job = processes.start(claudeExecutable(configuredPath), ['--help'], homedir());
    let output = '';
    job.child.stdout?.on('data', chunk => {output += chunk.toString().slice(0, 50000);});
    job.child.stderr?.on('data', chunk => {output += chunk.toString().slice(0, 50000);});
    const timeout = setTimeout(job.stop, 8000);
    let code: number | null;
    try {code = await job.done;} finally {clearTimeout(timeout);}
    if (code !== 0) return unavailable;
    const description = output.match(/--model <model>([\s\S]*?)(?=\n\s+-[a-z-]+, |\n\s+--[a-z-]+|\n\s+Commands:)/i)?.[1] ?? '';
    const aliases = [...description.matchAll(/'([a-z][a-z-]*)'/g)].map(m => m[1]);
    const models = [{value: '', label: 'Padrão'}, ...[...new Set(aliases)].map(value => ({value, label: value.charAt(0).toUpperCase() + value.slice(1)}))];
    const supported = output.match(/--effort <level>([^\n]*(?:\n\s{20,}[^\n]*)?)/i)?.[1] ?? '';
    const efforts = ['', ...['low', 'medium', 'high', 'xhigh', 'max'].filter(e => new RegExp(`\\b${e}\\b`).test(supported))];
    return {models, efforts, notice: 'Aliases e esforços anunciados pelo CLI. A disponibilidade na conta e no modelo é confirmada ao executar.'};
  } catch {return unavailable;}
}
