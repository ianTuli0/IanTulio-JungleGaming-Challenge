import type { InputState } from './simulation.ts';

export type Control = keyof InputState;

/** Single source for both the key handling and the controls legend in the UI. */
export const KEY_BINDINGS: Record<Control, string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  turnLeft: ['KeyA', 'ArrowLeft'],
  turnRight: ['KeyD', 'ArrowRight'],
  fireFront: ['Space', 'KeyK'],
  fireLeft: ['KeyQ', 'KeyJ'],
  fireRight: ['KeyE', 'KeyL'],
};
export const PAUSE_KEYS = ['Escape', 'KeyP'];

const BOUND = new Set(Object.values(KEY_BINDINGS).flat());

export class InputController {
  readonly state: InputState = { forward: false, turnLeft: false, turnRight: false, fireFront: false, fireLeft: false, fireRight: false };
  /** True only while gameplay runs; otherwise keys keep their normal page behaviour. */
  enabled = false;
  private readonly keys = new Set<string>();
  private readonly touches = new Set<Control>();
  private readonly onPause: () => void;

  constructor(onPause: () => void) {
    this.onPause = onPause;
  }

  attach(): void {
    window.addEventListener('keydown', this.down);
    window.addEventListener('keyup', this.up);
  }

  detach(): void {
    window.removeEventListener('keydown', this.down);
    window.removeEventListener('keyup', this.up);
    this.reset();
  }

  setTouch(control: Control, pressed: boolean): void {
    if (pressed && !this.enabled) return;
    if (pressed) this.touches.add(control);
    else this.touches.delete(control);
    this.sync();
  }

  /** Drops every held key/finger: nothing pressed before a pause leaks into the resume. */
  reset(): void {
    this.keys.clear();
    this.touches.clear();
    this.sync();
  }

  private readonly down = (e: KeyboardEvent) => {
    if (!this.enabled || e.ctrlKey || e.metaKey || e.altKey) return;
    if (PAUSE_KEYS.includes(e.code)) {
      e.preventDefault();
      this.onPause();
      return;
    }
    if (!BOUND.has(e.code)) return;
    e.preventDefault(); // no page scroll on Space/arrows while sailing
    this.keys.add(e.code);
    this.sync();
  };

  private readonly up = (e: KeyboardEvent) => {
    if (this.keys.delete(e.code)) this.sync();
  };

  private sync(): void {
    for (const control of Object.keys(this.state) as Control[]) {
      this.state[control] = this.touches.has(control) || KEY_BINDINGS[control].some((code) => this.keys.has(code));
    }
  }
}
