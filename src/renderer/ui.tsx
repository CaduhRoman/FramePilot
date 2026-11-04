import React, {useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';

/** Small shared building blocks. All visual values come from the tokens in style.css. */

const icons = {
  play: <path d="M8 5.5v13l11-6.5Z" fill="currentColor" stroke="none" />,
  pause: <><rect x="6.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" /><rect x="13.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" /></>,
  more: <><circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" /></>,
  send: <><path d="M12 19V5" /><path d="m6 11 6-6 6 6" /></>,
  stop: <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  error: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5v.01" /></>,
  warning: <><path d="M12 4 2.5 20h19Z" /><path d="M12 10v4.5M12 17.5v.01" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.5v.01" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  upload: <><path d="M12 15V4" /><path d="m7 9 5-5 5 5" /><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></>,
  sliders: <><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></>,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />,
  film: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="m10 9 5 3-5 3Z" /></>,
  video: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m10 9 5 3-5 3Z" /></>,
  audio: <><path d="M9 18V6l10-2v12" /><circle cx="7" cy="18" r="2" /><circle cx="17" cy="16" r="2" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="2" /><path d="m21 16-5-5-9 9" /></>,
  file: <><path d="M6 3h8l4 4v14H6Z" /><path d="M14 3v4h4" /></>,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16Z" /><path d="m13.5 6.5 4 4" /></>,
  trim: <><circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><path d="M8 7.5 20 17M8 16.5 20 7" /></>,
  resend: <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 5v6h-6" /></>,
  star: <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8Z" />,
  starFilled: <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8Z" fill="currentColor" />,
  trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
  up: <path d="m6 15 6-6 6 6" />,
  down: <path d="m6 9 6 6 6-6" />,
  spark: <path d="M12 3c.6 4.6 3.4 7.4 8 8-4.6.6-7.4 3.4-8 8-.6-4.6-3.4-7.4-8-8 4.6-.6 7.4-3.4 8-8Z" />,
  pulse: <path d="M3 12h4l3-7 4 14 3-7h4" />,
  restart: <><path d="M4 12a8 8 0 1 0 2.3-5.7" /><path d="M4 4v5h5" /></>,
  package: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9" /></>,
  expand: <><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" /></>,
  open: <><path d="M14 4h6v6" /><path d="M20 4 11 13" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>,
  back: <path d="m15 6-6 6 6 6" />,
  chat: <><path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" /></>
};
export type IconName = keyof typeof icons;
export function Icon({name, size = 16}: {name: IconName; size?: number}) {
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name]}</svg>;
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; icon?: IconName};
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button({variant = 'secondary', icon, className = '', children, type = 'button', ...rest}, ref) {
  return <button ref={ref} type={type} className={`btn btn-${variant} ${className}`} {...rest}>{icon && <Icon name={icon} />}{children}</button>;
});

/** Icon-only button: the label is required and doubles as tooltip. */
export const IconButton = React.forwardRef<HTMLButtonElement, Omit<ButtonProps, 'children'> & {label: string; icon: IconName; tooltip?: string}>(function IconButton({label, icon, tooltip, variant = 'ghost', className = '', type = 'button', ...rest}, ref) {
  return <button ref={ref} type={type} className={`btn btn-icon btn-${variant} ${className}`} aria-label={label} title={tooltip ?? label} {...rest}><Icon name={icon} /></button>;
});

export function Card({className = '', children, ...rest}: React.HTMLAttributes<HTMLElement>) {
  return <article className={`card ${className}`} {...rest}>{children}</article>;
}

export type Tone = 'ready' | 'working' | 'success' | 'error' | 'warning';
const toneIcon: Record<Tone, IconName> = {ready: 'check', working: 'pulse', success: 'check', error: 'error', warning: 'warning'};
/** Status is always text plus icon, never color alone. */
export function StatusBadge({tone, children, title}: {tone: Tone; children: React.ReactNode; title?: string}) {
  return <span className={`status-badge tone-${tone}`} title={title}>{tone === 'working' ? <span className="spinner" aria-hidden="true" /> : <Icon name={toneIcon[tone]} size={14} />}<span className="status-text">{children}</span></span>;
}

export function Section({title, count, actions, children, className = ''}: {title: string; count?: number; actions?: React.ReactNode; children: React.ReactNode; className?: string}) {
  const id = useId();
  return <section className={`panel-section ${className}`} aria-labelledby={id}>
    <header className="section-head"><h2 id={id}>{title}{count !== undefined && <span className="count">{count}</span>}</h2>{actions}</header>
    {children}
  </section>;
}

export function EmptyState({icon, title, children}: {icon?: IconName; title: string; children?: React.ReactNode}) {
  return <div className="empty-state">{icon && <span className="empty-icon"><Icon name={icon} size={24} /></span>}<h2>{title}</h2>{children}</div>;
}

/** Popover anchored to a trigger. Closes on outside click and Escape, returning focus to the trigger. */
export function Menu({trigger, children, align = 'end', placement = 'below', className = ''}: {
  trigger: (props: {ref: React.Ref<HTMLButtonElement>; onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' | 'dialog'}) => React.ReactNode;
  children: (close: () => void) => React.ReactNode; align?: 'start' | 'end'; placement?: 'below' | 'above'; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});
  const close = () => {setOpen(false); anchor.current?.focus();};
  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const place = () => {
      const r = anchor.current!.getBoundingClientRect();
      const s: React.CSSProperties = {};
      if (align === 'end') s.right = window.innerWidth - r.right; else s.left = r.left;
      if (placement === 'above') s.bottom = window.innerHeight - r.top + 8; else s.top = r.bottom + 8;
      setStyle(s);
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, align, placement]);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>('button:not(:disabled), [tabindex="0"], input, select, textarea')?.focus();
    const outside = (event: Event) => {
      if (!anchor.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {if (event.key === 'Escape') {event.preventDefault(); close();}};
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    return () => {document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key);};
  }, [open]);
  return <>
    {trigger({ref: anchor, onClick: () => setOpen(o => !o), 'aria-expanded': open, 'aria-haspopup': 'menu'})}
    {open && createPortal(<div ref={panel} className={`popover ${className}`} style={style}>{children(close)}</div>, document.body)}
  </>;
}

export function MenuItem({icon, children, hint, ...rest}: React.ButtonHTMLAttributes<HTMLButtonElement> & {icon?: IconName; hint?: string}) {
  return <button type="button" className="menu-item" {...rest}>{icon && <Icon name={icon} />}<span><span className="menu-label">{children}</span>{hint && <small>{hint}</small>}</span></button>;
}

/** Keeps the start and the end (usually the extension) of a long name visible. */
export function MiddleTruncate({text}: {text: string}) {
  const tail = Math.min(10, Math.floor(text.length / 3));
  return <span className="middle-truncate" title={text}><span className="mt-head">{text.slice(0, text.length - tail)}</span><span className="mt-tail">{text.slice(text.length - tail)}</span></span>;
}

export const formatTime = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
