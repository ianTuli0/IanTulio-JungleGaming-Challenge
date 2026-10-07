// Local persistence: player options, identity and the last completed match.
import { isMatchRecord, type MatchRecord } from './api/contracts.ts';
import { GAME_CONFIG, type MatchSettings } from './game/config.ts';
import { createStore, storage } from './store.ts';

export interface Settings extends MatchSettings {
  soundEnabled: boolean;
}

export type SettingsErrors = Partial<Record<keyof MatchSettings, string>>;

const KEYS = {
  settings: 'pirate-battle:settings',
  player: 'pirate-battle:player',
  lastResult: 'pirate-battle:last-result',
};

const { session, spawn } = GAME_CONFIG;

export const DEFAULT_SETTINGS: Settings = {
  sessionSeconds: session.defaultSeconds,
  spawnIntervalSeconds: spawn.defaultIntervalSeconds,
  soundEnabled: true,
};

export function validateSettings(s: MatchSettings): SettingsErrors {
  const errors: SettingsErrors = {};
  if (!Number.isInteger(s.sessionSeconds)) errors.sessionSeconds = 'Enter a whole number of seconds.';
  else if (s.sessionSeconds < session.minSeconds || s.sessionSeconds > session.maxSeconds)
    errors.sessionSeconds = `Choose between ${session.minSeconds} and ${session.maxSeconds} seconds.`;

  const spawnTenths = s.spawnIntervalSeconds * 10;
  if (!Number.isFinite(s.spawnIntervalSeconds) || s.spawnIntervalSeconds <= 0) errors.spawnIntervalSeconds = 'Enter a positive number of seconds.';
  else if (s.spawnIntervalSeconds < spawn.minIntervalSeconds || s.spawnIntervalSeconds > spawn.maxIntervalSeconds)
    errors.spawnIntervalSeconds = `Choose between ${spawn.minIntervalSeconds} and ${spawn.maxIntervalSeconds} seconds.`;
  else if (Math.abs(spawnTenths - Math.round(spawnTenths)) > 1e-9) errors.spawnIntervalSeconds = 'Use at most one decimal place.';
  return errors;
}

function parseSettings(raw: unknown): Settings | null {
  const s = raw as Settings;
  if (!s || typeof s.soundEnabled !== 'boolean') return null;
  return Object.keys(validateSettings(s)).length ? null : { sessionSeconds: s.sessionSeconds, spawnIntervalSeconds: s.spawnIntervalSeconds, soundEnabled: s.soundEnabled };
}

export const settingsStore = createStore<Settings>(storage.read(KEYS.settings, parseSettings) ?? DEFAULT_SETTINGS);

export function saveSettings(next: Settings): void {
  settingsStore.set(next);
  storage.write(KEYS.settings, next);
}

/** randomUUID only exists in secure contexts; LAN testing over plain http needs the fallback. */
export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export interface Player {
  id: string;
  name: string;
}

export const player: Player =
  storage.read(KEYS.player, (raw) => {
    const p = raw as Player;
    return p && typeof p.id === 'string' && typeof p.name === 'string' ? p : null;
  }) ??
  (() => {
    const fresh = { id: uuid(), name: 'Captain Jack' };
    storage.write(KEYS.player, fresh);
    return fresh;
  })();

export const lastResultStore = createStore<MatchRecord | null>(storage.read(KEYS.lastResult, (r) => (isMatchRecord(r) ? r : null)));

export function saveLastResult(record: MatchRecord | null): void {
  lastResultStore.set(record);
  storage.write(KEYS.lastResult, record);
}
