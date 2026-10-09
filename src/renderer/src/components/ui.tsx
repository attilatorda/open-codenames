import { useEffect, useRef, type ReactNode } from 'react';
import type { TeamId } from '@core/types';
import { play } from '../audio/sfx';

export function Dots() {
  return (
    <span className="dots" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      className="toggle"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => {
        play('click');
        onChange(!checked);
      }}
    />
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  gold,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  gold?: boolean;
  label?: string;
}) {
  return (
    <div className={`segmented${gold ? ' gold' : ''}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          title={o.title}
          aria-pressed={o.value === value}
          onClick={() => {
            play('click');
            onChange(o.value);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ children, onClose, width }: { children: ReactNode; onClose?: () => void; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) onClose();
    };
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('button, input, select')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" ref={ref} role="dialog" aria-modal="true" style={width ? { width: `min(${width}px, calc(100vw - 48px))` } : undefined}>
        {children}
      </div>
    </div>
  );
}

/** Player avatar: initial on the team color, like a player board avatar. */
export function Avatar({
  name,
  team,
  human,
  size,
  active,
}: {
  name?: string;
  team?: TeamId;
  human?: boolean;
  size?: 'sm' | 'lg';
  active?: boolean;
}) {
  return (
    <div
      className={`avatar${size ? ` ${size}` : ''}${team ? ` ${team === 'A' ? 'green' : 'red'}` : ''}${human ? ' human' : ''}${active ? ' active' : ''}`}
      aria-hidden="true"
    >
      {human ? 'You' : (name ?? '?').charAt(0)}
    </div>
  );
}

export function TechDetails({ detail }: { detail?: string }) {
  if (!detail) return null;
  return (
    <details className="tech">
      <summary>Technical details</summary>
      <pre>{detail}</pre>
    </details>
  );
}
