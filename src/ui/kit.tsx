import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { audio } from '../game/audio.ts';

const images = import.meta.glob('../../assets/png/{default,retina}/ui/**/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

/** UI sprite by atlas name (e.g. "icon_pause"), with the retina file as 2x candidate. */
export function uiImage(name: string): { src: string; srcSet: string } {
  const find = (density: string) => Object.entries(images).find(([path]) => path.includes(`/${density}/`) && path.endsWith(`/${name}.png`))?.[1] ?? '';
  const src = find('default');
  return { src, srcSet: `${src} 1x, ${find('retina')} 2x` };
}

export const Icon = ({ name, className }: { name: string; className?: string }) => <img {...uiImage(name)} alt="" className={className ?? 'icon'} draggable={false} />;

/** Moves focus to a screen's heading when it appears, so keyboard and screen-reader users land in context. */
export const focusOnMount = (el: HTMLElement | null) => el?.focus({ preventScroll: true });

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary'; size?: 'md' | 'sm' };

export function Button({ variant = 'primary', size = 'md', className = '', onClick, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`btn btn-${variant} btn-${size} ${className}`}
      onClick={(e) => {
        audio.play('ui_click', 0.6);
        onClick?.(e);
      }}
      {...rest}
    />
  );
}

/** Round wooden button with an atlas icon, or `children` in its place. */
export function RoundButton({ icon, label, className = '', onClick, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: string; label: string }) {
  return (
    <button
      type="button"
      className={`round-btn ${className}`}
      aria-label={label}
      title={label}
      onClick={(e) => {
        audio.play('ui_click', 0.6);
        onClick?.(e);
      }}
      {...rest}
    >
      {children ?? <Icon name={icon ?? ''} />}
    </button>
  );
}

export function Panel({ children, className = '', labelledBy }: { children: ReactNode; className?: string; labelledBy?: string }) {
  return (
    <section className={`panel ${className}`} aria-labelledby={labelledBy}>
      {children}
    </section>
  );
}

export function Dialog({ open, onCancel, labelledBy, className = '', children }: { open: boolean; onCancel: () => void; labelledBy: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      audio.play('ui_open', 0.5);
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`dialog panel ${className}`}
      aria-labelledby={labelledBy}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      {open && children}
    </dialog>
  );
}

export const formatClock = (totalSeconds: number) => {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const pad = (n: number) => String(n).padStart(2, '0');
/** "08 SEP" + "19:36" in the player's local time. */
export const formatPlayedAt = (iso: string) => {
  const d = new Date(iso);
  return { day: `${pad(d.getDate())} ${MONTHS[d.getMonth()]}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
};

export const endReasonLabel = (reason: 'time-up' | 'destroyed') => (reason === 'time-up' ? 'Time up' : 'Defeated');
