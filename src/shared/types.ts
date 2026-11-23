/**
 * Motor de composição do projeto. Ausente = remotion: todo projeto criado antes desta opção
 * continua sendo Remotion, sem migração.
 */
export type ProjectKind = 'remotion' | 'hyperframes';
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
// ---------------------------------------------------------------------------
// Marcas (Brand): um nível acima do projeto. Guardam a identidade visual e os
// assets globais em <library>/<id>/brand/. Projetos dentro da pasta herdam tudo.
// ---------------------------------------------------------------------------
export interface BrandColors {primary: string; secondary: string; background: string; text: string; accent?: string}
/** Uma fonte da marca. `asset` aponta para uma chave de `assets` em vez de repetir o caminho. */
export interface BrandFont {family: string; weight?: string; asset?: string}
export interface BrandSafeArea {top: number; right: number; bottom: number; left: number}
export interface BrandDefaults {width: number; height: number; fps: number; durationInSeconds: number; safeArea?: BrandSafeArea}
export type BrandAssetKind = 'image' | 'video' | 'audio' | 'font' | 'other';
/** `file` é relativo à pasta brand/ da marca, ou à raiz pública do projeto quando `local`. */
export interface BrandAsset {file: string; label: string; kind: BrandAssetKind; local?: boolean}
/** Esqueleto de projeto oferecido pela marca na tela de novo projeto. */
export interface BrandTemplate {id: string; name: string; description?: string; width: number; height: number; fps: number; duration: number; style?: string}
export interface BrandKit {
  id: string;
  name: string;
  /** Incrementa a cada alteração no kit; é o número que o snapshot do projeto registra. */
  version: number;
  colors: BrandColors;
  fonts: Record<string, BrandFont>;
  defaults: BrandDefaults;
  assets: Record<string, BrandAsset>;
  templates: BrandTemplate[];
}
/** Ajustes pontuais de um projeto, sem copiar o resto do kit. */
export interface BrandOverrides {
  colors?: Partial<BrandColors>;
  fonts?: Record<string, Partial<BrandFont>>;
  defaults?: Partial<BrandDefaults>;
  /** Troca o arquivo de uma chave só neste projeto; com `local`, aponta para um asset do próprio projeto. */
  assets?: Record<string, BrandAsset>;
}
/** O vínculo do projeto com a marca. Sem `lock`, o projeto acompanha a marca ao vivo. */
export interface ProjectBrand {id: string; overrides?: BrandOverrides; lock?: {version: number; at: string}}
export interface BrandPatch {name?: string; colors?: Partial<BrandColors>; fonts?: Record<string, BrandFont>; defaults?: Partial<BrandDefaults>; guide?: string}
export interface BrandInput {name: string; colors?: Partial<BrandColors>; defaults?: Partial<BrandDefaults>; guide?: string}
/** Marca lida do disco, com o guia e a contagem de projetos, para a home e a página da marca. */
export interface BrandDetail {root: string; kit: BrandKit; guide: string; projects: number}

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
  /** engine: which CLI owns the session ID; absent means Claude Code (older projects). */
  session: {id?: string; initialSent: boolean; engine?: AgentEngine};
  messages: ChatMessage[];
  /** Persistent asset queue. Removing an ID does not remove the actual file. */
  pendingAssetIds?: string[];
  /** Requeue these references when starting a new session. */
  essentialAssetIds?: string[];
  material?: Material;
  /** Motor do projeto; ausente = remotion. */
  kind?: ProjectKind;
  /** Vínculo com a marca; ausente em projetos avulsos, que seguem funcionando como antes. */
  brand?: ProjectBrand;
  /** Summary of the aligned Whisper transcripts, written by the harness. */
  transcript?: string;
  /** Summary of the extracted video frames, written by the harness. */
  frames?: string;
}
export interface ProjectSummary {root: string; name: string; width: number; height: number; duration: number; messages: number; hasSession: boolean; updatedAt: string;
  kind?: ProjectKind;
  /** Pasta da marca que contém o projeto; ausente em "Avulsos". */
  brandId?: string;
  /** Versão da marca congelada no último export, quando houver. */
  brandLock?: number}
/** '' until the user picks a provider on the first-run connect screen. */
export type Engine = '' | AgentEngine;
export type AgentEngine = 'claude' | 'opencode' | 'antigravity';
/** Free model served by OpenCode Zen; no account needed. */
/** Modelo padrão do Antigravity: Gemini 4 Neon com reasoning médio. */
export const ANTIGRAVITY_MODEL = 'gemini-4-neon-medium';
export const FREE_MODEL = 'opencode/deepseek-v4.1-flash-free';
export interface Settings {
  claudePath: string; nodePath: string; npmPath: string; transcribe: boolean; frames: boolean; model: string; effort: string;
  engine: Engine; opencodePath: string; opencodeModel: string;
  /** Antigravity (Gemini 4 e outros). O binário vem do runtime que o OpenBot instala; vazio = procurar sozinho. */
  antigravityPath: string; antigravityModel: string;
  /** ElevenLabs hosted MCP (narration, voices, sound effects) offered to the agent once the user signs in. */
  elevenlabs: boolean;
  /** Modo Auto: the agent works without asking (Claude Code's auto mode, OpenCode with every permission, FramePilot commands pre-approved). */
  autoMode: boolean;
  /**
   * Quantos frames o Remotion renderiza em paralelo. '' = automático (o Remotion decide pelos núcleos).
   * Cada frame paralelo é uma aba de Chromium: em máquinas com pouca RAM, baixar isto evita swap.
   */
  concurrency: string;
  /**
   * Render pela GPU: troca o chrome-headless-shell (que não tem GPU) pelo Chrome for Testing com --gl angle,
   * e pede encode por hardware quando disponível. Ajuda em blur, sombras e transformações;
   * filtros SVG como feTurbulence podem continuar na CPU.
   */
  gpu: boolean;
}
export const DEFAULT_SETTINGS: Settings = {claudePath: '', nodePath: '', npmPath: '', transcribe: true, frames: true, model: '', effort: '',
  engine: '', opencodePath: '', opencodeModel: FREE_MODEL, antigravityPath: '', antigravityModel: ANTIGRAVITY_MODEL, elevenlabs: false, autoMode: false, concurrency: '', gpu: false};
/** What the connect screen needs to know about each CLI. */
export interface ProviderStatus {
  claude: {installed: boolean; loggedIn: boolean; account?: string; method?: string};
  opencode: {installed: boolean; version?: string; providers: string[]};
  /** `models` vem de `antigravity models`, que só responde autenticado: lista vazia = sem acesso. */
  antigravity: {installed: boolean; path?: string; models: string[]};
  /** ElevenLabs sign-in per agent CLI (each keeps its own OAuth token). */
  /** Login da ElevenLabs por CLI. O Antigravity ainda não registra o MCP dela: sempre false. */
  elevenlabs: {claude: boolean; opencode: boolean; antigravity: boolean};
}
/** Interactive logins and installs run in a pseudo-terminal shown on the connect screen. */
export type LoginKind = 'claude' | 'opencode-openai' | 'opencode-copilot' | 'opencode-other' | 'install-opencode' | 'elevenlabs';
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
  brands: BrandDetail[];
  commands: CommandRecord[];
  /** Agent commands waiting for the user's answer, oldest first. */
  approvals: CommandRecord[];
}
export type AppEvent = {type: 'state'; state: State} | {type: 'log'; text: string} | {type: 'delta'; text: string}
  | {type: 'pty'; data: string} | {type: 'login'; data: string} | {type: 'login-exit'; code: number} | {type: 'command-output'; id: string; stream: 'stdout' | 'stderr'; text: string};
export interface API {
  state(): Promise<State>;
  create(brief: Brief, brandId?: string, kind?: ProjectKind): Promise<void>;
  open(root?: string): Promise<void>;
  close(): Promise<void>;
  showLibrary(): Promise<void>;
  save(brief: Brief): Promise<void>;
  // --- Marcas ---
  /** Cria a pasta da marca com brand/brand.json, BRAND.md e as subpastas do kit. */
  createBrand(input: BrandInput): Promise<void>;
  /** Nome, cores, fontes, defaults e BRAND.md. Toda alteração incrementa brand.version. */
  updateBrand(id: string, patch: BrandPatch): Promise<void>;
  /** Adiciona ou substitui o asset de uma chave. Substituir mantém a chave e incrementa a versão. */
  putBrandAsset(id: string, key: string, label: string, source?: string): Promise<void>;
  removeBrandAsset(id: string, key: string): Promise<void>;
  /** Move um projeto para a pasta de uma marca, ou para "Avulsos" com brandId vazio. */
  moveProject(root: string, brandId: string): Promise<void>;
  /** Caminhos de logo hardcoded que o projeto poderia trocar por brand:<chave>. */
  brandCandidates(root: string): Promise<{file: string; line: number; text: string; key: string}[]>;
  /** Aplica as trocas confirmadas pelo usuário em remotion/src. */
  applyBrandKeys(root: string, files: string[]): Promise<void>;
  /** Desfaz o lock: o projeto volta a acompanhar a marca ao vivo. */
  refreshBrand(): Promise<void>;
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
  providers(): Promise<ProviderStatus>;
  /** Models OpenCode can use with the credentials on this machine (free models included). */
  opencodeModels(): Promise<string[]>;
  /** Saves the chosen engine (and OpenCode model) and leaves the connect screen. */
  connect(engine: AgentEngine, model?: string): Promise<void>;
  loginStart(kind: LoginKind, cols: number, rows: number): Promise<void>;
  /** Turns ElevenLabs on for the agent (only after sign-in for the current engine) or off. */
  elevenlabs(enabled: boolean): Promise<void>;
  /** Modo Auto on or off; applies from the next request and answers commands already waiting. */
  autoMode(enabled: boolean): Promise<void>;
  loginWrite(data: string): Promise<void>;
  loginResize(cols: number, rows: number): Promise<void>;
  loginStop(): Promise<void>;
  /** Starts (or reattaches to) the user's interactive shell; returns its scrollback. */
  ptyStart(cols: number, rows: number): Promise<string>;
  ptyWrite(data: string): Promise<void>;
  ptyResize(cols: number, rows: number): Promise<void>;
  ptyRestart(): Promise<void>;
  commandOutput(id: string): Promise<CommandOutput>;
  stopCommand(id: string): Promise<void>;
  /** Answers the approval popup for an agent command. */
  approveCommand(id: string, allow: boolean): Promise<void>;
  clearCommands(): Promise<void>;
  onEvent(callback: (event: AppEvent) => void): () => void;
}
