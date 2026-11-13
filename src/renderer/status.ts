import type {State} from '../shared/types';
import type {Tone} from './ui';

export type StatusKind = 'ready' | 'claude' | 'preview' | 'render' | 'error' | 'busy';
export interface AppStatus {kind: StatusKind; tone: Tone; label: string; detail?: string}

const CLAUDE_TASKS = ['Claude', 'Preparando material de vídeo', 'Transcrevendo áudio', 'Extraindo frames'];
const PREVIEW_TASKS = ['Iniciando preview', 'Instalando dependências', 'Abrindo projeto', 'Criando projeto'];

/** First line of an error, short enough for the status indicator. */
export const errorSummary = (message: string) => {
  const line = message.split('\n').find(l => l.trim())?.trim() ?? 'Falha desconhecida';
  return line.length > 72 ? line.slice(0, 71) + '…' : line;
};

/** Maps the states the main process already exposes to one human status. */
export function appStatus(state: State, {error, submitting, previewBuilding}: {error: string; submitting: boolean; previewBuilding: boolean}): AppStatus {
  const task = state.task;
  if (error) return {kind: 'error', tone: 'error', label: `Erro: ${errorSummary(error)}`, detail: error};
  if (task === 'Renderizando MP4') return {kind: 'render', tone: 'working', label: 'Renderizando…'};
  if (state.claudeBusy || submitting || (task && CLAUDE_TASKS.includes(task))) {
    return {kind: 'claude', tone: 'working', label: `${state.settings.engine === 'opencode' ? 'OpenCode' : 'Claude'} está editando…`, detail: task && task !== 'Claude' ? task : undefined};
  }
  if (task && PREVIEW_TASKS.includes(task)) return {kind: 'preview', tone: 'working', label: 'Atualizando preview…', detail: task};
  if (task) return {kind: 'busy', tone: 'working', label: `${task}…`};
  if (previewBuilding) return {kind: 'preview', tone: 'working', label: 'Atualizando preview…'};
  return {kind: 'ready', tone: 'ready', label: 'Pronto'};
}

/** Progress from the Remotion CLI log ("Rendered 120/900"). Null while it has not reported frames. */
export function renderProgress(logs: string[]): number | null {
  for (let i = logs.length - 1; i >= Math.max(0, logs.length - 40); i--) {
    const lines = logs[i].split('\n').reverse();
    for (const line of lines) {
      // Lines from an earlier render end at its completion message.
      if (/^(Vídeo concluído|Interrupção solicitada)/.test(line)) return null;
      const m = /(Rendered|Rendering frames|Encoded|Stitched)\D*?(\d+)\s*\/\s*(\d+)/i.exec(line);
      if (m && Number(m[3]) > 0) return Math.min(1, Number(m[2]) / Number(m[3]));
    }
  }
  return null;
}
