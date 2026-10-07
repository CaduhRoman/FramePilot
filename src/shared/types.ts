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
export type AssetKind = 'logo' | 'image' | 'video' | 'audio' | 'font' | 'reference' | 'document';
export interface Asset {id: string; name: string; path: string; kind: AssetKind; note: string; publicPath?: string}
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
}
export interface Settings {claudePath: string; nodePath: string; npmPath: string}
export interface State {
  project: Project | null;
  root: string | null;
  previewUrl: string | null;
  claudeBusy: boolean;
  task: string | null;
  settings: Settings;
  logs: string[];
  lastRender: string | null;
}
export type AppEvent = {type: 'state'; state: State} | {type: 'log'; text: string} | {type: 'delta'; text: string};
export interface API {
  state(): Promise<State>;
  create(brief: Brief): Promise<void>;
  open(): Promise<void>;
  save(brief: Brief): Promise<void>;
  importAsset(kind: AssetKind, note: string, relevant: boolean): Promise<void>;
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
