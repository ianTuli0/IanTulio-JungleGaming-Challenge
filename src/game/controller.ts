// Owns one match: Pixi app + ticker, fixed-step simulation, input, audio and the HUD store.
import { Application, type Ticker } from 'pixi.js';
import { createStore, type Store } from '../store.ts';
import { ARENA_HEIGHT, ARENA_WIDTH, arenaBounds, type Bounds } from './arena.ts';
import type { GameAssets } from './assets.ts';
import { audio } from './audio.ts';
import { createMatchConfig, type EndReason, type MatchSettings } from './config.ts';
import { InputController } from './input.ts';
import { PerfMonitor } from './perf.ts';
import { GameRenderer } from './renderer.ts';
import { Simulation, type SimEvent } from './simulation.ts';

const STEP = 1 / 60; // simulation rate, independent of the display rate
const MAX_FRAME = 0.1; // long frames (tab throttling) never fast-forward the match

export type PauseReason = 'manual' | 'focus' | 'hidden' | 'orientation';

/** Only what the React HUD displays; replaced when one of these values changes. */
export interface HudState {
  hp: number;
  maxHp: number;
  score: number;
  /** Whole seconds left (ceil), so React re-renders at most once per second for the clock. */
  remaining: number;
  phase: 'running' | 'paused' | 'ended';
  pauseReason: PauseReason | null;
  endReason: EndReason | null;
  /** Polite screen-reader message for state changes (never per frame). */
  announcement: string;
}

export interface MatchOutcome {
  score: number;
  durationMs: number;
  endReason: EndReason;
  settings: MatchSettings;
  seed: number;
}

/**
 * Test hook, exposed as `window.__pirateBattle` only with `?debug` or `?perf`: a read-only state snapshot and
 * a clock control. `advance` feeds the real simulation (rules, collisions, held input) whole fixed steps
 * without drawing between them, so E2E tests can play minutes of battle in milliseconds.
 */
export interface DebugHandle {
  advance(seconds: number): void;
  state(): {
    status: string;
    paused: boolean;
    elapsed: number;
    score: number;
    player: { x: number; y: number; angle: number; hp: number };
    enemies: { id: number; kind: string; x: number; y: number; angle: number; hp: number }[];
    projectiles: number;
    /** Current island colliders (peripheral islands move during the match). */
    islands: { cx: number; cy: number; hw: number; hh: number; r: number }[];
    bounds: Bounds;
  };
}

declare global {
  interface Window {
    __pirateBattle?: DebugHandle;
  }
}

export interface ControllerOptions {
  host: HTMLElement;
  assets: GameAssets;
  settings: MatchSettings;
  seed: number;
  onEnd: (outcome: MatchOutcome) => void;
  debug?: boolean;
  perf?: boolean;
}

export class GameController {
  readonly hud: Store<HudState>;
  readonly input: InputController;
  private readonly opts: ControllerOptions;
  private sim: Simulation;
  private app: Application | null = null;
  private view: GameRenderer | null = null;
  private perf: PerfMonitor | null = null;
  private dprQuery: MediaQueryList | null = null;
  private acc = 0;
  private paused = false;
  private pauseReason: PauseReason | null = null;
  private disposed = false;
  private lowHealthWarned = false;
  private timeWarned = false;
  private announcement = '';

  constructor(opts: ControllerOptions) {
    this.opts = opts;
    // Snapshot: later changes to Options only affect the next match.
    this.sim = this.newSim();
    this.input = new InputController(() => this.pause('manual'));
    this.hud = createStore<HudState>(this.snapshot());
  }

  /** Async because Pixi's init is; safe if `destroy()` runs first (React Strict Mode). */
  async init(): Promise<void> {
    const app = new Application();
    await app.init({
      resizeTo: this.opts.host,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      antialias: true,
      background: 0x0e3d57,
      preference: 'webgl',
    });
    if (this.disposed) {
      app.destroy({ removeView: true, releaseGlobalResources: true }, { children: true });
      return;
    }
    this.app = app;
    app.canvas.setAttribute('aria-hidden', 'true');
    this.opts.host.appendChild(app.canvas);
    this.view = new GameRenderer(this.opts.assets, this.sim, this.opts.debug);
    app.stage.addChild(this.view.world);
    this.layout();
    app.renderer.on('resize', this.layout);
    this.watchDensity();
    if (this.opts.perf) this.perf = new PerfMonitor(this.opts.host);
    if (this.opts.debug || this.opts.perf) window.__pirateBattle = this.debugHandle;

    // Warm-up render while the loading panel is still up: uploads the atlases to this new WebGL
    // context and compiles shaders. Waiting two frames lets that work land before the match
    // (and its clock) starts, so the first frames of the battle do not stutter.
    this.view.render(this.sim, 1, 0);
    app.render();
    for (let i = 0; i < 2; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
    if (this.disposed) return; // destroy() already released everything
    app.ticker.lastTime = performance.now();

    this.input.attach();
    this.input.enabled = true;
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
    app.ticker.add(this.tick);

    audio.play('game_start', 0.8);
    audio.setLoop('ocean_ambience_loop', 0.35);
    this.announce(`Battle started. ${this.sim.config.sessionSeconds} seconds on the clock.`);
    if (document.hidden) this.pause('hidden');
    else if (!document.hasFocus()) this.pause('focus');
  }

  pause(reason: PauseReason): void {
    if (this.paused || this.sim.status !== 'running' || !this.app) return;
    this.paused = true;
    this.pauseReason = reason;
    this.input.enabled = false;
    this.input.reset();
    audio.play('game_pause', 0.7);
    audio.setLoop('ship_sailing_loop', 0);
    this.announce('Game paused.');
  }

  /** Only called from an explicit player action. */
  resume(): void {
    if (!this.paused || this.sim.status !== 'running') return;
    this.paused = false;
    this.pauseReason = null;
    this.refit();
    this.acc = 0; // nothing from the paused period is simulated
    this.input.reset();
    this.input.enabled = true;
    audio.play('game_resume', 0.7);
    this.announce('Game resumed.');
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.input.detach();
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.dprQuery?.removeEventListener('change', this.watchDensity);
    audio.stopLoops();
    this.perf?.destroy();
    if (window.__pirateBattle === this.debugHandle) delete window.__pirateBattle;
    if (!this.app) return;
    this.app.ticker.remove(this.tick);
    this.app.renderer.off('resize', this.layout);
    this.view?.destroy();
    // Atlas textures stay in the Assets cache for the next match; everything else goes.
    this.app.destroy({ removeView: true, releaseGlobalResources: true }, { children: true });
    this.app = null;
    this.view = null;
  }

  private readonly tick = (ticker: Ticker) => {
    const sim = this.sim;
    const view = this.view;
    if (!view) return;
    const dt = Math.min(ticker.deltaMS / 1000, MAX_FRAME);
    const running = !this.paused && sim.status === 'running';
    if (running) {
      this.acc += dt;
      this.drain(view);
      this.perf?.record(ticker.deltaMS, 1 + sim.enemies.length + sim.projectiles.length, view.effectCount);
    }
    // Effects keep animating after the end, but freeze with the simulation while paused.
    view.render(sim, running ? this.acc / STEP : 1, this.paused ? 0 : dt);
    const sailing = running ? Math.round((sim.player.speed / sim.config.player.maxSpeed) * 10) / 25 : 0;
    audio.setLoop('ship_sailing_loop', sailing);
    this.hud.set(this.snapshot());
  };

  /** Runs the whole fixed steps waiting in the accumulator (shared by the ticker and the `?debug` time hook). */
  private drain(view: GameRenderer): void {
    const sim = this.sim;
    while (this.acc >= STEP && sim.status === 'running') {
      sim.step(STEP, this.input.state);
      this.acc -= STEP;
      const events = sim.drainEvents();
      view.handle(events);
      this.react(events);
    }
  }

  /** Sounds, warnings and the end-of-match hand-off. */
  private react(events: SimEvent[]): void {
    const sim = this.sim;
    for (const e of events) {
      switch (e.type) {
        case 'shot':
          if (e.owner === 'enemy') audio.play(audio.variant('cannon_fire', 3), 0.3, 1.1);
          else audio.play(e.weapon === 'front' ? audio.variant('cannon_fire', 3) : 'cannon_broadside', 0.65);
          break;
        case 'hit':
          audio.play(audio.variant('ship_wood_hit', 2), e.kind === 'player' ? 0.9 : 0.5);
          if (e.kind === 'player' && !this.lowHealthWarned && e.hp > 0 && e.hp / sim.player.maxHp <= sim.config.player.lowHealthRatio) {
            this.lowHealthWarned = true;
            audio.play('health_low', 0.8);
            this.announce(`Low health: ${e.hp} left.`);
          }
          break;
        case 'splash':
          audio.play(audio.variant('cannonball_water_hit', 2), 0.2);
          break;
        case 'wall-hit':
          // stone crumbling vs. a dull thud on a tower
          audio.play(e.broken ? 'ship_collision' : 'ship_wood_hit_2', e.broken ? 0.45 : 0.3, e.broken ? 0.8 : 0.6);
          break;
        case 'destroyed':
          audio.play(e.cause === 'ram' ? 'ship_collision' : audio.variant('ship_explosion', 2), 0.75);
          if (e.kind !== 'player') audio.play('ship_sinking', 0.3);
          break;
        case 'score':
          audio.play('score_point', 0.5);
          break;
        case 'island-moved':
          audio.play('cannonball_water_hit_1', 0.5, 0.5);
          if (e.island === 0) this.announce('The edge islands sank and resurfaced elsewhere.');
          break;
        case 'ended':
          this.finish(e.reason);
          break;
        default:
          break;
      }
    }
    if (!this.timeWarned && sim.status === 'running' && sim.remaining <= 10) {
      this.timeWarned = true;
      audio.play('time_warning', 0.8);
      this.announce('10 seconds left.');
    }
  }

  private finish(reason: EndReason): void {
    const sim = this.sim;
    this.input.enabled = false;
    this.input.reset();
    audio.setLoop('ship_sailing_loop', 0);
    audio.play(reason === 'time-up' ? 'game_complete' : 'game_over', 0.9);
    this.announce(`${reason === 'time-up' ? 'Time up' : 'Your ship was sunk'}. Final score ${sim.score}.`);
    this.perf?.report();
    this.opts.onEnd({
      score: sim.score,
      durationMs: Math.round(sim.elapsed * 1000),
      endReason: reason,
      settings: { sessionSeconds: sim.config.sessionSeconds, spawnIntervalSeconds: sim.config.spawnIntervalSeconds },
      seed: this.opts.seed,
    });
  }

  private announce(text: string): void {
    this.announcement = text;
    this.hud.set(this.snapshot());
  }

  private snapshot(): HudState {
    const s = this.sim;
    const next: HudState = {
      hp: Math.ceil(s.player.hp),
      maxHp: s.player.maxHp,
      score: s.score,
      remaining: Math.ceil(s.remaining),
      phase: s.status === 'ended' ? 'ended' : this.paused ? 'paused' : 'running',
      pauseReason: this.pauseReason,
      endReason: s.endReason,
      announcement: this.announcement,
    };
    const prev = this.hud?.get();
    const same = prev && (Object.keys(next) as (keyof HudState)[]).every((k) => prev[k] === next[k]);
    return same ? prev : next;
  }

  /** The sea is sized to the screen the match starts on, so the arena fills it edge to edge. */
  private newSim(bounds = this.screenBounds()): Simulation {
    return new Simulation(createMatchConfig(this.opts.settings), this.opts.seed, bounds);
  }

  private screenBounds(): Bounds {
    const { clientWidth: w, clientHeight: h } = this.opts.host;
    return arenaBounds(w && h ? w / h : ARENA_WIDTH / ARENA_HEIGHT);
  }

  /**
   * A phone that starts the match upright pauses at once with the arena sized for that shape; turned
   * sideways, the map would show small with invisible walls. If nothing has happened yet, the match is
   * built again for the shape the screen has now.
   */
  private refit(): void {
    if (!this.app || !this.view || this.sim.elapsed >= 1) return;
    const bounds = this.screenBounds();
    const { x1, y1 } = this.sim.bounds;
    if (bounds.x1 === x1 && bounds.y1 === y1) return;
    this.sim = this.newSim(bounds);
    this.view.destroy();
    this.view = new GameRenderer(this.opts.assets, this.sim, this.opts.debug);
    this.app.stage.addChild(this.view.world);
    this.layout();
    this.view.render(this.sim, 1, 0);
  }

  private readonly layout = () => {
    if (this.app && this.view) this.view.layout(this.app.screen.width, this.app.screen.height);
  };

  /** Re-render at the new density when the window moves to another screen or the page is zoomed. */
  private readonly watchDensity = () => {
    this.dprQuery?.removeEventListener('change', this.watchDensity);
    if (this.app && this.dprQuery) this.app.renderer.resize(this.app.screen.width, this.app.screen.height, Math.min(window.devicePixelRatio || 1, 2));
    this.dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    this.dprQuery.addEventListener('change', this.watchDensity);
  };

  private readonly debugHandle: DebugHandle = {
    advance: (seconds) => {
      if (this.paused || this.sim.status !== 'running' || !this.view) return;
      this.acc += seconds + 1e-9; // float dust must not cost a step
      this.drain(this.view);
      this.hud.set(this.snapshot());
    },
    state: () => {
      const s = this.sim;
      const pose = ({ id, kind, x, y, angle, hp }: { id: number; kind: string; x: number; y: number; angle: number; hp: number }) => ({ id, kind, x, y, angle, hp });
      return {
        status: s.status,
        paused: this.paused,
        elapsed: s.elapsed,
        score: s.score,
        player: pose(s.player),
        enemies: s.enemies.map(pose),
        projectiles: s.projectiles.length,
        islands: s.colliders,
        bounds: s.bounds,
      };
    },
  };

  private readonly onBlur = () => this.pause('focus');
  private readonly onVisibility = () => {
    if (document.hidden) this.pause('hidden');
  };
}
