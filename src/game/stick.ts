import type { InputState } from './simulation.ts';

/** Virtual stick offset (screen px, y down) → movement: up sails, sideways turns, down does nothing (no reverse). */
export function stickControls(dx: number, dy: number, deadzone: number): (keyof InputState)[] {
  const controls: (keyof InputState)[] = [];
  if (dy < -deadzone) controls.push('forward');
  if (dx < -deadzone) controls.push('turnLeft');
  else if (dx > deadzone) controls.push('turnRight');
  return controls;
}
