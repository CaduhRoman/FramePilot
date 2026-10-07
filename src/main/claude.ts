import {ensureProjectSkills, skillReminder} from './skills';
import {randomUUID} from 'node:crypto';
import type {AppEvent, Project} from '../shared/types';
import {persist, promptFor} from './project';
import {claudeExecutable, jsonLines, Processes, type Job} from './processes';

export class Claude {
  job?: Job;
  constructor(private processes: Processes, private event: (event: AppEvent) => void,
    private log: (text: string) => void, private changed: () => void) {}

  async send(root: string, project: Project, request: string, executable: string) {
    if (this.job) throw new Error('Aguarde ou interrompa a resposta atual.');
    if (typeof request !== 'string' || !request.trim() || request.length > 100_000) throw new Error('Pedido vazio ou muito longo.');
    await ensureProjectSkills(root);
    const {prompt, changeIds} = promptFor(project, request.trim());
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--permission-mode', 'acceptEdits', '--tools', 'Read,Write,Edit,Glob,Grep,Skill',
      '--allowedTools', 'Read,Write,Edit,Glob,Grep,Skill', '--append-system-prompt', skillReminder];
    if (project.session.id) args.push('--resume', project.session.id);
    project.messages.push({id: randomUUID(), role: 'user', text: request, at: new Date().toISOString()});
    await persist(root, project);
    let accepted = false;
    let output = '';
    let streamed = false;
    let result: any;
    let interrupted = false;
    const accept = async () => {
      if (accepted) return;
      accepted = true;
      project.session.initialSent = true;
      project.changes = project.changes.filter(c => !changeIds.includes(c.id));
      await persist(root, project);
    };
    this.job = this.processes.start(claudeExecutable(executable), args, root);
    const originalStop = this.job.stop;
    this.job.stop = () => {interrupted = true; originalStop();};
    this.changed();
    this.log(project.session.id ? 'Retomando a sessão Claude existente…' : 'Iniciando Claude com o contexto do projeto…');
    this.job.child.stdin?.end(prompt);
    try {
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
          await accept();
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
          if (!value.is_error) await accept();
          if (value.permission_denials?.length) this.log('Claude encontrou uma operação sem permissão. Veja a resposta; comandos de terminal não estão habilitados neste MVP.');
        }
        if (value.type === 'system' && value.subtype === 'api_retry') this.log(`Claude: nova tentativa (${value.error}).`);
      }, this.log);
      if (interrupted) throw new Error('Solicitação interrompida. Arquivos já editados foram mantidos.');
      if (code !== 0 || !result || result.is_error) {
        throw new Error(result?.result || result?.errors?.join('\n') || 'Claude não concluiu. Verifique instalação/autenticação e os logs. Se a sessão não existir mais, clique em Nova sessão.');
      }
      project.messages.push({id: randomUUID(), role: 'assistant', text: output.trim() || result.result || 'Concluído.', at: new Date().toISOString()});
    } catch (error) {
      this.job?.stop();
      await this.job?.done.catch(() => {});
      const message = (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? 'Claude Code não encontrado. Instale o CLI e faça login uma vez com claude. Se necessário, configure o caminho do executável em Ferramentas.'
        : (error as Error).message;
      project.messages.push({id: randomUUID(), role: 'system', text: message, at: new Date().toISOString()});
      if (output.trim()) project.messages.push({id: randomUUID(), role: 'assistant', text: output.trim() + '\n[Resposta incompleta]', at: new Date().toISOString()});
      this.log(message);
    } finally {
      this.job = undefined;
      await persist(root, project);
      this.changed();
    }
  }
}
