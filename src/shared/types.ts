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
export interface ChatMessage {id: string; role: 'user' | 'assistant' | 'system'; text: string; at: string}
export interface Project {
  version: 1;
  id: string;
  brief: Brief;
  assets: Asset[];
  changes: ContextChange[];
  session: {id?: string; initialSent: boolean};
  messages: ChatMessage[];
  material?: Material;
  /** Summary of the aligned Whisper transcripts, written by the harness. */
  transcript?: string;
  /** Summary of the extracted video frames, written by the harness. */
  frames?: string;
}
export interface ProjectSummary {root: string; name: string; width: number; height: number; duration: number; messages: number; hasSession: boolean; updatedAt: string}
export interface Settings {claudePath: string; nodePath: string; npmPath: string; transcribe: boolean; frames: boolean}
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
}
export type AppEvent = {type: 'state'; state: State} | {type: 'log'; text: string} | {type: 'delta'; text: string};
export interface API {
  state(): Promise<State>;
  create(brief: Brief): Promise<void>;
  open(root?: string): Promise<void>;
  close(): Promise<void>;
  showLibrary(): Promise<void>;
  save(brief: Brief): Promise<void>;
  importAsset(kind: AssetKind, note: string, relevant: boolean): Promise<void>;
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
  settings(settings: Settings): Promise<void>;
  check(): Promise<string>;
  onEvent(callback: (event: AppEvent) => void): () => void;
}
