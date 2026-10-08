import { useState } from 'react';
import { KEY_BINDINGS, PAUSE_KEYS, type Control } from '../game/input.ts';
import { lastResultStore } from '../settings.ts';
import { useStore } from '../store.ts';
import { FullscreenButton } from './fullscreen.tsx';
import { Button, Dialog, Icon, Panel, RoundButton, endReasonLabel, focusOnMount, formatClock, uiImage } from './kit.tsx';
import { navigate } from './router.ts';

const KEY_LABELS: Record<string, string> = { ArrowUp: '↑', ArrowLeft: '←', ArrowRight: '→', Space: 'Space', Escape: 'Esc' };
const keyLabel = (code: string) => KEY_LABELS[code] ?? code.replace('Key', '');

const ROWS: { action: string; keys: string[]; icon: string }[] = (
  [
    ['Sail forward', 'forward', 'icon_forward'],
    ['Turn left', 'turnLeft', 'icon_turn_left'],
    ['Turn right', 'turnRight', 'icon_turn_right'],
    ['Fire bow cannon', 'fireFront', 'icon_fire_front'],
    ['Left broadside (3 balls)', 'fireLeft', 'icon_fire_left'],
    ['Right broadside (3 balls)', 'fireRight', 'icon_fire_right'],
  ] as [string, Control, string][]
)
  .map(([action, control, icon]) => ({ action, keys: KEY_BINDINGS[control], icon }))
  .concat({ action: 'Pause', keys: PAUSE_KEYS, icon: 'icon_pause' });

/** Keyboard table on computers; on touch screens a grid of the on-screen buttons, big enough to read. */
export function ControlsLegend() {
  return (
    <>
      <ul className="touch-legend" aria-label="Touch controls">
        {ROWS.map((row) => (
          <li key={row.action}>
            <span className="touch-icon">
              <Icon name={row.icon} />
            </span>
            {row.action}
          </li>
        ))}
      </ul>
      <ControlsTable />
    </>
  );
}

function ControlsTable() {
  return (
    <table className="controls">
      <caption className="sr-only">Controls</caption>
      <thead>
        <tr>
          <th scope="col">Action</th>
          <th scope="col" className="controls-keys">Keyboard</th>
          <th scope="col" className="controls-touch">Touch</th>
        </tr>
      </thead>
      <tbody>
        {ROWS.map((row) => (
          <tr key={row.action}>
            <th scope="row">{row.action}</th>
            <td className="controls-keys">
              {row.keys.map((k, i) => (
                <span key={k}>
                  {i > 0 && ' / '}
                  <kbd>{keyLabel(k)}</kbd>
                </span>
              ))}
            </td>
            <td className="controls-touch">
              <span className="touch-icon">
                <Icon name={row.icon} />
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const Goal = () => (
  <p className="small">
    Navigate the islands and sink as many ships as you can before the clock runs out. Red <strong>Chasers</strong> ram you; black{' '}
    <strong>Shooters</strong> fire from range. Each sinking scores 1 point.
  </p>
);

export function MainMenu({ onPlay }: { onPlay: () => void }) {
  const last = useStore(lastResultStore)?.record;
  // Touch screens: the how-to opens from a button, so the menu fits a phone without scrolling.
  const [tutorial, setTutorial] = useState(false);
  return (
    <main className="screen menu-screen">
      <Panel className="menu-panel" labelledBy="menu-title">
        <div className="menu-main">
          <h1 id="menu-title" className="title" ref={focusOnMount} tabIndex={-1}>
            <img {...uiImage('title_pirate_battle')} alt="Pirate Battle" />
          </h1>
          <p className="tagline">Set sail. Take command.</p>
          <div className="stack">
            <Button onClick={onPlay}>Play</Button>
            <Button onClick={() => navigate('options')}>Options</Button>
            <Button className="how-to-btn" onClick={() => setTutorial(true)}>
              How to play
            </Button>
          </div>
          <nav className="row" aria-label="Captain's log">
            <Button variant="secondary" size="sm" onClick={() => navigate('log/ranking')}>
              Ranking
            </Button>
            <Button variant="secondary" size="sm" onClick={() => navigate('log/history')}>
              Match History
            </Button>
          </nav>
          {last && (
            <p className="muted small">
              Last battle: <strong className="gold">{last.score} points</strong> · {formatClock(last.durationMs / 1000)} · {endReasonLabel(last.endReason)}
            </p>
          )}
        </div>
        <section className="how-to" aria-labelledby="how-to-title">
          <h2 id="how-to-title">How to play</h2>
          <Goal />
          <ControlsLegend />
        </section>
      </Panel>
      <FullscreenButton className="menu-fullscreen" />
      <Dialog open={tutorial} onCancel={() => setTutorial(false)} labelledBy="tutorial-title" className="tutorial-dialog">
        <RoundButton icon="icon_close" label="Close" className="dialog-close" onClick={() => setTutorial(false)} />
        <h2 id="tutorial-title">How to play</h2>
        <Goal />
        <ControlsLegend />
      </Dialog>
    </main>
  );
}
