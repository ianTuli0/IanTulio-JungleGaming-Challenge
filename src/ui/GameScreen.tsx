import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import { assetStatus, loadGameAssets } from '../game/assets.ts';
import { GameController, type HudState, type MatchOutcome } from '../game/controller.ts';
import type { Control } from '../game/input.ts';
import { stickControls } from '../game/stick.ts';
import { settingsStore } from '../settings.ts';
import { useStore } from '../store.ts';
import { ControlsLegend } from './MainMenu.tsx';
import { FullscreenButton } from './fullscreen.tsx';
import { OptionsForm } from './Options.tsx';
import { Button, Dialog, Icon, RoundButton, formatClock, uiImage } from './kit.tsx';

const params = new URLSearchParams(window.location.search);
const FILL = { x: 30, w: 196, total: 256 }; // health_fill_* fill_rect from ui_sheet.json

/** Phone held upright: the battle cannot be played like this. */
const PORTRAIT_PHONE = '(orientation: portrait) and (any-pointer: coarse)';
const watchPortrait = (onChange: () => void) => {
  const query = window.matchMedia(PORTRAIT_PHONE);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
const usePortraitPhone = () => useSyncExternalStore(watchPortrait, () => window.matchMedia(PORTRAIT_PHONE).matches);

function Hud({ hud, onPause }: { hud: HudState; onPause: () => void }) {
  const ratio = hud.hp / hud.maxHp;
  const fill = ratio > 0.6 ? 'health_fill_green' : ratio > 0.3 ? 'health_fill_amber' : 'health_fill_red';
  const rightInset = ((FILL.total - FILL.x - FILL.w * ratio) / FILL.total) * 100;
  return (
    <header className="hud" aria-label="Match status">
      <div className="hud-health" role="meter" aria-label="Ship health" aria-valuemin={0} aria-valuemax={hud.maxHp} aria-valuenow={hud.hp} aria-valuetext={`${hud.hp} of ${hud.maxHp}`}>
        <Icon name="icon_heart" className="hud-heart" />
        <span className="health-bar">
          <img {...uiImage(fill)} alt="" className="health-fill" style={{ clipPath: `inset(0 ${rightInset}% 0 0)` }} />
          <span className="health-text">
            {hud.hp} / {hud.maxHp}
          </span>
        </span>
      </div>
      <div className="hud-right">
        <p className="counter">
          <Icon name="icon_score" />
          <span className="sr-only">Score:</span>
          <span>{hud.score}</span>
        </p>
        <p className={`counter ${hud.remaining <= 10 ? 'warning' : ''}`}>
          <Icon name="icon_time" />
          <span className="sr-only">Time left:</span>
          <span>{formatClock(hud.remaining)}</span>
        </p>
        <FullscreenButton />
        <RoundButton icon="icon_pause" label="Pause" onClick={onPause} disabled={hud.phase !== 'running'} />
      </div>
    </header>
  );
}

const TOUCH: { control: Control; icon: string; label: string }[][] = [
  [
    { control: 'turnLeft', icon: 'icon_turn_left', label: 'Turn left' },
    { control: 'forward', icon: 'icon_forward', label: 'Sail forward' },
    { control: 'turnRight', icon: 'icon_turn_right', label: 'Turn right' },
  ],
  [
    { control: 'fireLeft', icon: 'icon_fire_left', label: 'Fire left broadside' },
    { control: 'fireFront', icon: 'icon_fire_front', label: 'Fire bow cannon' },
    { control: 'fireRight', icon: 'icon_fire_right', label: 'Fire right broadside' },
  ],
];

/** Hold-to-act buttons; each finger is tracked by its own pointer capture, so several work at once. */
function TouchControls({ game }: { game: GameController }) {
  return (
    <div className="touch-controls">
      {TOUCH.map((cluster, i) => (
        <div key={i} className={`touch-cluster ${i ? 'right' : 'left'}`}>
          {!i && <MoveStick game={game} />}
          {cluster.map(({ control, icon, label }) => {
            const release = () => game.input.setTouch(control, false);
            return (
              <button
                key={control}
                type="button"
                tabIndex={-1}
                className={`round-btn touch-btn touch-${control}`}
                aria-label={label}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  game.input.setTouch(control, true);
                }}
                onPointerUp={release}
                onPointerCancel={release}
                onLostPointerCapture={release}
                onContextMenu={(e) => e.preventDefault()}
              >
                <Icon name={icon} />
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

const STICK_RADIUS = 60; // px: how far the knob can travel from the centre of the ring (the ring is 102px in radius, see .stick-base)
const STICK_DEADZONE = 18; // px from the center before the ship reacts

/**
 * Stick for sailing. Its zone is exactly the box of the left button cluster (behind the buttons): hold the
 * empty part of it and a semi-transparent ring appears, centred on the three movement buttons and covering
 * all of them (size and position come from CSS). The knob moves with the finger's drag.
 */
function MoveStick({ game }: { game: GameController }) {
  const [stick, setStick] = useState<{ dx: number; dy: number } | null>(null);
  const origin = useRef<{ id: number; x: number; y: number } | null>(null); // where the finger landed, in client px

  const release = (e: ReactPointerEvent) => {
    if (e.pointerId !== origin.current?.id) return;
    origin.current = null;
    setStick(null);
    game.input.setStick([]);
  };

  return (
    <div
      className="stick-zone"
      aria-hidden="true"
      onPointerDown={(e) => {
        if (origin.current) return; // a second finger does not move the stick
        e.currentTarget.setPointerCapture(e.pointerId);
        origin.current = { id: e.pointerId, x: e.clientX, y: e.clientY }; // the drag is measured from the finger, wherever in the zone it landed
        setStick({ dx: 0, dy: 0 });
      }}
      onPointerMove={(e) => {
        const o = origin.current;
        if (!o || e.pointerId !== o.id) return;
        let dx = e.clientX - o.x;
        let dy = e.clientY - o.y;
        const length = Math.hypot(dx, dy);
        if (length > STICK_RADIUS) {
          dx *= STICK_RADIUS / length;
          dy *= STICK_RADIUS / length;
        }
        setStick((s) => s && { ...s, dx, dy });
        game.input.setStick(stickControls(dx, dy, STICK_DEADZONE));
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(e) => e.preventDefault()}
    >
      {stick && (
        <div className="stick-base">
          <div className="stick-knob" style={{ transform: `translate(${stick.dx}px, ${stick.dy}px)` }} />
        </div>
      )}
    </div>
  );
}

function PauseDialog({ game, hud, onRestart, onExit }: { game: GameController; hud: HudState; onRestart: () => void; onExit: () => void }) {
  const [view, setView] = useState<'menu' | 'options' | 'controls'>('menu');
  const open = hud.phase === 'paused';
  // Upright phone: only the way out (options, controls, menu) and a big "rotate" message; Continue/Restart need landscape.
  const rotate = usePortraitPhone() && view === 'menu';
  const reason = hud.pauseReason === 'focus' || hud.pauseReason === 'hidden' ? 'Paused while the game was in the background.' : 'Ready when you are.';
  const resume = () => {
    setView('menu');
    game.resume();
  };
  return (
    <Dialog open={open} onCancel={view === 'menu' ? resume : () => setView('menu')} labelledBy="pause-title" className={`pause-dialog ${rotate ? 'rotate' : ''}`}>
      <h2 id="pause-title">{view === 'options' ? 'Options' : view === 'controls' ? 'Controls' : rotate ? 'Rotate your phone to play' : 'Paused'}</h2>
      {rotate && (
        <>
          <Icon name="icon_restart" className="rotate-icon" />
          <div className="stack">
            <Button onClick={() => setView('options')}>Options</Button>
            <Button onClick={() => setView('controls')}>Controls</Button>
            <Button variant="secondary" onClick={onExit}>
              Main Menu
            </Button>
          </div>
        </>
      )}
      {view === 'menu' && !rotate && (
        <>
          <p className="muted">{reason}</p>
          <div className="stack">
            <Button onClick={resume}>Resume</Button>
            <Button onClick={() => setView('options')}>Options</Button>
            <Button onClick={() => setView('controls')}>Controls</Button>
            <Button onClick={onRestart}>Restart</Button>
            <Button variant="secondary" onClick={onExit}>
              Main Menu
            </Button>
          </div>
          <p className="hint">Restart or leaving abandons this battle: it is not recorded.</p>
        </>
      )}
      {view === 'options' && (
        <>
          <p className="muted small">Changes apply to your next battle; this one keeps its settings.</p>
          <OptionsForm onDone={() => setView('menu')} doneLabel="Back" />
        </>
      )}
      {view === 'controls' && (
        <>
          <ControlsLegend />
          <div className="stack">
            <Button variant="secondary" onClick={() => setView('menu')}>
              Back
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}

function Match({ game, onRestart, onExit, onFinished }: { game: GameController; onRestart: () => void; onExit: () => void; onFinished: () => void }) {
  const hud = useStore(game.hud);
  const finished = useEffectEvent(onFinished);

  // Short beat on the final explosion, then the result screen.
  useEffect(() => {
    if (hud.phase !== 'ended') return;
    const timer = window.setTimeout(() => finished(), 1800);
    return () => window.clearTimeout(timer);
  }, [hud.phase]);

  // Portrait on a phone is not supported: pause until the player rotates and resumes
  // (re-checked on every phase change, so resuming while still in portrait pauses again).
  useEffect(() => {
    const portrait = window.matchMedia(PORTRAIT_PHONE);
    const check = () => {
      if (portrait.matches) game.pause('orientation');
    };
    check();
    portrait.addEventListener('change', check);
    return () => portrait.removeEventListener('change', check);
  }, [game, hud.phase]);

  return (
    <>
      <h1 className="sr-only">Battle in progress</h1>
      <Hud hud={hud} onPause={() => game.pause('manual')} />
      <TouchControls game={game} />
      <p className="sr-only" role="status" aria-live="polite">
        {hud.announcement}
      </p>
      {hud.phase === 'ended' && (
        <div className="end-banner" aria-hidden="true">
          {hud.endReason === 'time-up' ? 'Time up!' : 'Ship sunk!'}
        </div>
      )}
      <PauseDialog game={game} hud={hud} onRestart={onRestart} onExit={onExit} />
    </>
  );
}

export default function GameScreen({
  onMatchEnd,
  onFinished,
  onRestart,
  onExit,
}: {
  onMatchEnd: (outcome: MatchOutcome) => void;
  onFinished: () => void;
  onRestart: () => void;
  onExit: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const assets = useStore(assetStatus);
  const [game, setGame] = useState<GameController | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const matchEnded = useEffectEvent(onMatchEnd);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let controller: GameController | null = null;
    let cancelled = false;
    loadGameAssets()
      .then((loaded) => {
        if (cancelled) return;
        controller = new GameController({
          host,
          assets: loaded,
          settings: settingsStore.get(),
          seed: Number(params.get('seed')) || Math.floor(Math.random() * 2 ** 31),
          onEnd: (outcome) => matchEnded(outcome),
          debug: params.has('debug'),
          perf: params.has('perf'),
        });
        return controller.init().then(() => {
          if (!cancelled) setGame(controller);
        });
      })
      .catch((error: unknown) => {
        // Asset failures are shown from the asset store; renderer failures here.
        if (!cancelled && assetStatus.get().status !== 'error') setFailure(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
      controller?.destroy();
    };
  }, [attempt]);

  const retry = () => {
    setFailure(null);
    setGame(null);
    setAttempt((a) => a + 1);
  };

  return (
    <main className="game-screen">
      <div ref={hostRef} className="game-host" />
      {game && <Match game={game} onRestart={onRestart} onExit={onExit} onFinished={onFinished} />}
      {!game && (
        <div className="overlay">
          <section className="panel loading-panel" aria-labelledby="loading-title">
            {assets.status === 'error' || failure ? (
              <>
                <h1 id="loading-title">Could not load the battle</h1>
                <p className="error" role="alert">
                  {failure ?? 'Some game assets failed to load. Check your connection and try again.'}
                </p>
                <div className="stack">
                  <Button onClick={retry}>Retry</Button>
                  <Button variant="secondary" onClick={onExit}>
                    Main Menu
                  </Button>
                </div>
              </>
            ) : (
              <>
                <h1 id="loading-title">Preparing the fleet…</h1>
                <label className="progress">
                  <span>Loading assets {Math.round(assets.progress * 100)}%</span>
                  <progress max={1} value={assets.progress} />
                </label>
              </>
            )}
          </section>
        </div>
      )}
      <div className="rotate-overlay" aria-hidden="true">
        <Icon name="icon_restart" />
        <p>Rotate your phone to play</p>
      </div>
    </main>
  );
}
