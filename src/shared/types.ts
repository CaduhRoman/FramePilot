export interface Brief {
  name: string;
  briefing: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  style: string;
  notes: string;
}
export type AssetKind = 'main' | 'logo' | 'image' | 'video' | 'audio' | 'font' | 'reference' | 'document';
/** Kept range of a source video, in seconds. */
export interface Segment {start: number; end: number}
export interface Asset {
  id: string; name: string; path: string; kind: AssetKind; note: string; publicPath?: string;
  duration?: number; width?: number; height?: number; fps?: number;
  /** Kept ranges; undefined means the whole video. */
  segments?: Segment[];
}
export interface AssetPatch {note?: string; kind?: AssetKind; segments?: Segment[]; duration?: number}
export interface MaterialSource {assetId: string; name: string; path: string; originalDuration: number; segments: Segment[]; offset: number}
/** A prepared file in remotion/public containing only the kept ranges, concatenated. */
export interface MaterialPart {file: string; kind: 'main' | 'aux'; assetId?: string; duration: number; width: number; height: number; fps: number; sources: MaterialSource[]}
export interface Material {key: string; parts: MaterialPart[]}
export interface ContextChange {id: string; text: string; relevant: boolean}
/** A snapshot of what was offered to the CLI, not proof that it read the file. */
export interface SharedAsset {id: string; name: string; kind: AssetKind; path: string; note: string}
export interface MessageContext {assets: SharedAsset[]; status: 'sending' | 'shared' | 'failed'; sessionId?: string}
export interface ChatMessage {id: string; role: 'user' | 'assistant' | 'system'; text: string; at: string; context?: MessageContext}
export interface Project {
  version: 1;
  id: string;
  brief: Brief;
  assets: Asset[];
  changes: ContextChange[];
  session: {id?: string; initialSent: boolean};
  messages: ChatMessage[];
  /** Persistent asset queue. Removing an ID does not remove the actual file. */
  pendingAssetIds?: string[];
  /** Requeue these references when starting a new session. */
  essentialAssetIds?: string[];
  material?: Material;
  /** Summary of the aligned Whisper transcripts, written by the harness. */
  transcript?: string;
  /** Summary of the extracted video frames, written by the harness. */
  frames?: string;
}
export interface ProjectSummary {root: string; name: string; width: number; height: number; duration: number; messages: number; hasSession: boolean; updatedAt: string}
export interface Settings {claudePath: string; nodePath: string; npmPath: string; transcribe: boolean; frames: boolean; model: string; effort: string}
export const EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max'];
export interface ClaudeOptions {models: {value: string; label: string}[]; efforts: string[]; notice: string}
/** A command run by an agent through FramePilot's terminal tools. Output is fetched separately. */
export interface CommandRecord {
  id: string; source: 'agent' | 'user'; command: string; cwd: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'stopped' | 'denied';
  exitCode: number | null; startedAt: string; endedAt?: string;
  /** Why approval was required; empty when the command ran without asking. */
  reasons: string[];
}
export interface CommandOutput {stdout: string; stderr: string}
export interface State {
  project: Project | null;
  root: string | null;
  previewUrl: string | null;
  claudeBusy: boolean;
  task: string | null;
  settings: Settings;
  logs: string[];
  lastRender: string | null;
  library: string;
  projects: ProjectSummary[];
  commands: CommandRecord[];
}
export type AppEvent = {type: 'state'; state: State} | {type: 'log'; text: string} | {type: 'delta'; text: string}
  | {type: 'pty'; data: string} | {type: 'command-output'; id: string; stream: 'stdout' | 'stderr'; text: string};
export interface API {
  state(): Promise<State>;
  create(brief: Brief): Promise<void>;
  open(root?: string): Promise<void>;
  close(): Promise<void>;
  showLibrary(): Promise<void>;
  save(brief: Brief): Promise<void>;
  importAsset(kind: AssetKind, note: string): Promise<void>;
  /** Opens the file picker and returns the chosen paths without importing them. */
  pickFiles(): Promise<string[]>;
  importFiles(kind: AssetKind, note: string, paths: string[]): Promise<void>;
  /** Local path of a file dropped on the window. */
  pathForFile(file: File): string;
  queueAsset(id: string, pending: boolean): Promise<void>;
  essentialAsset(id: string, essential: boolean): Promise<void>;
  updateAsset(id: string, patch: AssetPatch): Promise<void>;
  removeAsset(id: string): Promise<void>;
  moveAsset(id: string, delta: -1 | 1): Promise<void>;
  assetDuration(id: string, duration: number): Promise<void>;
  send(text: string): Promise<void>;
  stop(): Promise<void>;
  resetSession(): Promise<void>;
  preview(): Promise<void>;
  install(): Promise<void>;
  render(): Promise<void>;
  reveal(): Promise<void>;
  openRender(): Promise<void>;
  settings(settings: Settings): Promise<void>;
  claudePreference(model: string, effort: string): Promise<void>;
  claudeOptions(): Promise<ClaudeOptions>;
  check(): Promise<string>;
  /** Starts (or reattaches to) the user's interactive shell; returns its scrollback. */
  ptyStart(cols: number, rows: number): Promise<string>;
  ptyWrite(data: string): Promise<void>;
  ptyResize(cols: number, rows: number): Promise<void>;
  ptyRestart(): Promise<void>;
  commandOutput(id: string): Promise<CommandOutput>;
  stopCommand(id: string): Promise<void>;
  clearCommands(): Promise<void>;
  onEvent(callback: (event: AppEvent) => void): () => void;
}
