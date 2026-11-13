import React, {useEffect, useRef, useState} from 'react';
import {Terminal as XTerm} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type {AgentEngine, API, LoginKind, ProviderStatus, Settings} from '../shared/types';
import {FREE_MODEL} from '../shared/types';
import {Button, Icon, IconButton, StatusBadge} from './ui';
import {Select} from './Select';
import {BrandMark, type Brand} from './brands';

type Act = (action: () => Promise<unknown>) => Promise<void>;
const appLogo = new URL('../../favicon.png', import.meta.url).href;

/** Subscriptions reached through OpenCode, keyed by OpenCode's provider ID. */
const OPENCODE_PLANS = [
  {provider: 'openai', login: 'opencode-openai' as const, brand: 'openai' as Brand, name: 'ChatGPT', plan: 'Codex · Plus ou Pro'},
  {provider: 'github-copilot', login: 'opencode-copilot' as const, brand: 'copilot' as Brand, name: 'GitHub Copilot', plan: 'Pro, Pro+ ou Business'}
];
const LOGIN_TITLES: Record<LoginKind, [Brand, string]> = {
  'claude': ['claude', 'Entrando com Claude'],
  'opencode-openai': ['openai', 'Entrando com ChatGPT'],
  'opencode-copilot': ['copilot', 'Entrando com GitHub Copilot'],
  'opencode-other': ['other', 'Conectar outro provedor'],
  'install-opencode': ['deepseek', 'Instalando o OpenCode']
};

/** Interactive login in a pseudo-terminal: the CLI opens the official sign-in page in the browser. */
function LoginView({api, kind, onClose}: {api: API; kind: LoginKind; onClose: (code: number | null) => void}) {
  const host = useRef<HTMLDivElement>(null);
  const [exit, setExit] = useState<number | null>(null);
  useEffect(() => {
    const term = new XTerm({fontSize: 12, fontFamily: 'Consolas, "Cascadia Mono", Menlo, monospace', cursorBlink: true, scrollback: 2000,
      theme: {background: '#0b0c0f', foreground: '#e6e6e6'}});
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current!);
    fit.fit();
    term.focus();
    const off = api.onEvent(event => {
      if (event.type === 'login') term.write(event.data);
      if (event.type === 'login-exit') setExit(event.code);
    });
    api.loginStart(kind, term.cols, term.rows).catch(error => term.write(`\r\nNão foi possível iniciar: ${error.message}\r\n`));
    const input = term.onData(data => void api.loginWrite(data));
    const observer = new ResizeObserver(() => {try {fit.fit(); void api.loginResize(term.cols, term.rows);} catch {}});
    observer.observe(host.current!);
    return () => {observer.disconnect(); input.dispose(); off(); term.dispose(); void api.loginStop();};
  }, [api, kind]);
  const [brand, title] = LOGIN_TITLES[kind];
  const done = exit !== null;
  return <div className="auth-login">
    <header className="auth-login-head">
      <IconButton label="Voltar" icon="back" onClick={() => onClose(exit)} />
      <BrandMark brand={brand} size={32} />
      <h2 id="auth-title">{title}</h2>
      {done && <StatusBadge tone={exit === 0 ? 'success' : 'error'}>{exit === 0 ? 'Concluído' : `Código ${exit}`}</StatusBadge>}
    </header>
    <p className="auth-hint">{kind === 'install-opencode'
      ? 'Instalando pelo npm. Leva cerca de um minuto.'
      : 'Uma página de login abre no navegador. Se o terminal pedir, escolha com as setas e Enter.'}</p>
    <div className="auth-terminal" ref={host} />
    <Button variant={done ? 'primary' : 'ghost'} className="auth-wide" onClick={() => onClose(exit)}>{done ? 'Continuar' : 'Cancelar'}</Button>
  </div>;
}

/** One sign-in row: brand tile, name, plan, and the connection state. */
function Provider({brand, name, plan, state, account, disabled, onClick, onSwitch, children}: {
  brand: Brand; name: string; plan: string; state: 'checking' | 'connected' | 'signin' | 'missing'; account?: string;
  disabled: boolean; onClick: () => void; onSwitch?: () => void; children?: React.ReactNode;
}) {
  return <div className={`auth-provider ${state === 'connected' ? 'is-connected' : ''}`}>
    <button className="auth-provider-main" disabled={disabled || state === 'checking'} onClick={onClick}>
      <BrandMark brand={brand} />
      <span className="auth-provider-text">
        <strong>{state === 'connected' ? `Continuar com ${name}` : state === 'missing' ? name : `Entrar com ${name}`}</strong>
        <small>{state === 'connected' && account ? account : plan}</small>
      </span>
      <span className="auth-provider-state">
        {state === 'checking' ? <span className="spinner" aria-label="Verificando" />
          : state === 'connected' ? <span className="auth-dot">Conectado</span>
          : state === 'missing' ? <small>Instalar</small>
          : <Icon name="open" />}
      </span>
    </button>
    {children}
    {onSwitch && <button className="auth-switch" disabled={disabled} onClick={onSwitch}>Trocar conta</button>}
  </div>;
}

/** Sign-in popup shown over the app on first run (and from Configurações → Trocar IA). */
export function ConnectDialog({api, act, settings, busy, onClose, onDone}: {api: API; act: Act; settings: Settings; busy: boolean; onClose?: () => void; onDone: () => void}) {
  const [status, setStatus] = useState<ProviderStatus>();
  const [models, setModels] = useState<string[]>([]);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [login, setLogin] = useState<LoginKind | null>(null);
  const [freeAfterInstall, setFreeAfterInstall] = useState(false);
  const refresh = async () => {
    const next = await api.providers();
    setStatus(next);
    setModels(next.opencode.installed ? await api.opencodeModels().catch(() => []) : []);
    return next;
  };
  useEffect(() => {void act(refresh);}, []);
  useEffect(() => {
    if (!onClose || login) return;
    const key = (event: KeyboardEvent) => {if (event.key === 'Escape') onClose();};
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose, login]);
  const connect = (engine: AgentEngine, model?: string) => void act(async () => {await api.connect(engine, model); onDone();});
  const closeLogin = (code: number | null) => {
    const wasInstall = login === 'install-opencode';
    setLogin(null);
    void act(async () => {
      const next = await refresh();
      if (wasInstall && freeAfterInstall && code === 0 && next.opencode.installed) {await api.connect('opencode', FREE_MODEL); onDone();}
      setFreeAfterInstall(false);
    });
  };
  const checking = !status;
  const claude = status?.claude;
  const opencode = status?.opencode;
  const startFree = () => {
    if (opencode?.installed) connect('opencode', FREE_MODEL);
    else {setFreeAfterInstall(true); setLogin('install-opencode');}
  };
  return <div className="overlay auth-overlay">
    <section className={`auth-dialog ${login ? 'is-login' : ''}`} role="dialog" aria-modal="true" aria-labelledby="auth-title">
      {login ? <LoginView api={api} kind={login} onClose={closeLogin} /> : <>
        {onClose && <IconButton className="auth-close" label="Fechar" icon="close" onClick={onClose} />}
        <header className="auth-head">
          <img className="auth-logo" src={appLogo} alt="" />
          <h2 id="auth-title">Conecte sua IA</h2>
          <p>Use a assinatura que você já tem. O login acontece na página oficial de cada serviço.</p>
        </header>

        <div className="auth-providers">
          <Provider brand="claude" name="Claude" plan="Pro, Max, Team ou Console" account={claude?.account ?? claude?.method}
            state={checking ? 'checking' : claude?.loggedIn ? 'connected' : claude?.installed ? 'signin' : 'missing'} disabled={busy}
            onClick={() => claude?.loggedIn ? connect('claude') : claude?.installed ? setLogin('claude')
              : void act(async () => {throw new Error('Instale o Claude Code (npm install -g @anthropic-ai/claude-code) e clique em Verificar de novo.');})}
            onSwitch={claude?.loggedIn ? () => setLogin('claude') : undefined} />
          {OPENCODE_PLANS.map(plan => {
            const connected = Boolean(opencode?.providers.includes(plan.provider));
            const options = models.filter(m => m.startsWith(`${plan.provider}/`));
            const model = chosen[plan.provider]
              ?? (settings.engine === 'opencode' && settings.opencodeModel.startsWith(`${plan.provider}/`) ? settings.opencodeModel : options[0] ?? '');
            return <Provider key={plan.provider} brand={plan.brand} name={plan.name} plan={plan.plan}
              state={checking ? 'checking' : connected ? 'connected' : opencode?.installed ? 'signin' : 'missing'} disabled={busy || (connected && !model)}
              onClick={() => connected ? connect('opencode', model) : setLogin(opencode?.installed ? plan.login : 'install-opencode')}
              onSwitch={connected ? () => setLogin(plan.login) : undefined}>
              {connected && options.length > 1 && <div className="auth-model"><span>Modelo</span>
                <Select label={`Modelo ${plan.name}`} value={model} options={options.map(value => ({value, label: value.slice(plan.provider.length + 1)}))}
                  onChange={value => setChosen(c => ({...c, [plan.provider]: value}))} /></div>}
            </Provider>;
          })}
        </div>
        <div className="auth-links">
          <button disabled={busy || !opencode?.installed} onClick={() => setLogin('opencode-other')}>Outro provedor</button>
          <span aria-hidden="true">·</span>
          <button disabled={busy} onClick={() => void act(refresh)}>Verificar de novo</button>
        </div>

        <div className="auth-or" role="separator"><span>ou</span></div>

        <button className="auth-free" disabled={busy || checking} onClick={startFree}>
          <BrandMark brand="deepseek" />
          <span className="auth-provider-text">
            <strong>Começar grátis</strong>
            <small>DeepSeek V4.1 Flash · sem conta, sem cartão</small>
          </span>
          <span className="auth-free-tag">{checking ? '…' : opencode?.installed ? 'Grátis' : 'Instalar'}</span>
        </button>
        <p className="auth-foot">O modo grátis usa o OpenCode Zen e tem limites de uso. Para edições complexas, uma assinatura dá resultados melhores. Você pode trocar depois em Configurações.</p>
      </>}
    </section>
  </div>;
}
