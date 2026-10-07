import React, {useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';

type Option = {value: string; label: string};
export function Select({label, value, options, onChange, placeholder = 'Selecionar'}: {
  label: string; value: string; options: Option[]; onChange: (value: string) => void; placeholder?: string;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({left: 0, top: 0, width: 0, maxHeight: 280});
  const selected = options.findIndex(option => option.value === value);
  function show() {setActive(Math.max(0, selected)); setOpen(true);}
  function choose(index: number) {
    if (!options[index]) return;
    onChange(options[index].value); setOpen(false); trigger.current?.focus();
  }
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const rect = trigger.current!.getBoundingClientRect();
      const height = Math.min(options.length * 38 + 12, 280);
      const below = window.innerHeight - rect.bottom - 14;
      const above = rect.top - 14;
      const flip = below < height && above > below;
      const maxHeight = Math.min(height, Math.max(80, flip ? above : below));
      setPosition({left: rect.left, top: flip ? rect.top - maxHeight - 6 : rect.bottom + 6, width: rect.width, maxHeight});
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true);};
  }, [open, options.length]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    return () => {document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside);};
  }, [open]);
  useEffect(() => {
    if (open) document.getElementById(id + '-' + active)?.scrollIntoView({block: 'nearest'});
  }, [open, active, id]);
  return <>
    <button ref={trigger} type="button" className="select-trigger" role="combobox" aria-label={label}
      aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined}
      aria-activedescendant={open ? id + '-' + active : undefined}
      onClick={() => open ? setOpen(false) : show()}
      onKeyDown={event => {
        if (event.key === 'Tab') {setOpen(false); return;}
        if (event.key === 'Escape') {setOpen(false); event.preventDefault(); return;}
        if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
          event.preventDefault();
          if (!open) {show(); return;}
          if (event.key === 'Enter' || event.key === ' ') choose(active);
          else setActive(index => event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
        } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const index = options.findIndex(option => option.label.toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()));
          if (index >= 0) {event.preventDefault(); setActive(index); setOpen(true);}
        }
      }}>
      <span>{options[selected]?.label || placeholder}</span><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </button>
    {open && createPortal(<div ref={menu} id={id} className="select-menu" role="listbox" aria-label={label} style={position}>
      {options.map((option, index) => <div key={option.value} id={id + '-' + index} role="option" aria-selected={value === option.value}
        className={'select-option' + (index === active ? ' is-active' : '')}
        onPointerMove={() => setActive(index)} onPointerDown={event => event.preventDefault()} onClick={() => choose(index)}>
        <span>{option.label}</span>{value === option.value && <span aria-hidden="true">✓</span>}
      </div>)}
    </div>, document.body)}
  </>;
}
