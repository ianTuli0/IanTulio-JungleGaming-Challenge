import { useSyncExternalStore } from 'react';
import { RoundButton } from './kit.tsx';

/**
 * Fullscreen in landscape: no browser bars over the arena. Only from the player's tap on the button
 * (browsers only allow it after a gesture). iPhone Safari has no element fullscreen; there the
 * home-screen shortcut opens without bars.
 */
async function enterFullscreen(): Promise<void> {
  if (!document.fullscreenEnabled || document.fullscreenElement) return;
  try {
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    await screen.orientation.lock('landscape');
  } catch {
    // refused, or no orientation lock (iPad, desktop): play as it is
  }
}

const subscribe = (onChange: () => void) => {
  document.addEventListener('fullscreenchange', onChange);
  return () => document.removeEventListener('fullscreenchange', onChange);
};

/** Fullscreen toggle (HUD and main menu), shown on touch screens only (CSS). */
export function FullscreenButton({ className = '' }: { className?: string }) {
  const on = useSyncExternalStore(subscribe, () => !!document.fullscreenElement);
  if (!document.fullscreenEnabled) return null;
  return (
    <RoundButton className={`fullscreen-btn ${className}`} label={on ? 'Exit fullscreen' : 'Fullscreen'} onClick={() => (on ? void document.exitFullscreen() : void enterFullscreen())}>
      <svg className="icon" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {[
          ['#9a5418', 6],
          ['#fbe6bd', 3],
        ].map(([stroke, width]) => (
          <path key={stroke} stroke={String(stroke)} strokeWidth={width} d={on ? 'M9 4v5H4M15 4v5h5M20 15h-5v5M4 15h5v5' : 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5'} />
        ))}
      </svg>
    </RoundButton>
  );
}
