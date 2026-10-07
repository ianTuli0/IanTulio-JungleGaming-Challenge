// Every gameplay number lives here. Systems read from the per-match snapshot,
// so balancing never requires touching simulation code.

export type ShipKind = 'player' | 'chaser' | 'shooter';
export type EnemyKind = Exclude<ShipKind, 'player'>;
export type EndReason = 'time-up' | 'destroyed';

export interface HullConfig {
  /** Half beam: radius of the capsule used for every collision. */
  radius: number;
  /** Distance from the centre to the bow/stern capsule end points. */
  halfLength: number;
  /** Sprite scale (sprites are 66x113 px). */
  spriteScale: number;
}

export interface MotionConfig {
  maxHp: number;
  maxSpeed: number; // units/s
  acceleration: number; // units/s²
  drag: number; // units/s² when not sailing
  turnSpeed: number; // rad/s
  hull: HullConfig;
}

export interface WeaponConfig {
  damage: number;
  speed: number; // units/s
  range: number; // units travelled before the ball sinks
  cooldown: number; // s
}

export interface GameConfig {
  session: { defaultSeconds: number; minSeconds: number; maxSeconds: number; step: number };
  spawn: {
    defaultIntervalSeconds: number;
    minIntervalSeconds: number;
    maxIntervalSeconds: number;
    step: number;
    firstSpawnDelaySeconds: number;
    /** Spawns are deferred (not dropped) while this many enemies are alive. */
    maxAlive: number;
    minPlayerDistance: number;
    /** Forced order of the first spawns, so both kinds show up in every match. */
    opening: EnemyKind[];
    weights: Record<EnemyKind, number>;
  };
  projectileRadius: number;
  player: MotionConfig & {
    front: WeaponConfig;
    broadside: WeaponConfig & { count: number; spacing: number };
    lowHealthRatio: number;
  };
  chaser: MotionConfig & { ramDamage: number };
  shooter: MotionConfig & {
    attackRange: number;
    /** Stops closing in below this distance (keeps firing). */
    holdRange: number;
    /** Max bow misalignment (rad) to pull the trigger. */
    aimTolerance: number;
    cannon: WeaponConfig;
  };
}

export const GAME_CONFIG: GameConfig = {
  session: { defaultSeconds: 120, minSeconds: 60, maxSeconds: 180, step: 10 },
  spawn: {
    defaultIntervalSeconds: 3,
    minIntervalSeconds: 1,
    maxIntervalSeconds: 10,
    step: 0.5,
    firstSpawnDelaySeconds: 2,
    maxAlive: 10,
    minPlayerDistance: 420,
    opening: ['chaser', 'shooter'],
    weights: { chaser: 0.55, shooter: 0.45 },
  },
  projectileRadius: 5,
  player: {
    maxHp: 100,
    maxSpeed: 140,
    acceleration: 160,
    drag: 120,
    turnSpeed: 2.4,
    hull: { radius: 16, halfLength: 22, spriteScale: 0.75 },
    front: { damage: 25, speed: 520, range: 460, cooldown: 0.35 },
    broadside: { damage: 20, speed: 440, range: 320, cooldown: 1.2, count: 3, spacing: 20 },
    lowHealthRatio: 0.3,
  },
  chaser: {
    maxHp: 25,
    maxSpeed: 100,
    acceleration: 140,
    drag: 140,
    turnSpeed: 2.2,
    hull: { radius: 13, halfLength: 18, spriteScale: 0.62 },
    ramDamage: 20,
  },
  shooter: {
    maxHp: 50,
    maxSpeed: 80,
    acceleration: 100,
    drag: 120,
    turnSpeed: 1.6,
    hull: { radius: 16, halfLength: 22, spriteScale: 0.75 },
    attackRange: 360,
    holdRange: 260,
    aimTolerance: 0.18,
    cannon: { damage: 6, speed: 340, range: 400, cooldown: 2.5 },
  },
};

/** What the player can tune in Options; stored with every match record. */
export interface MatchSettings {
  sessionSeconds: number;
  spawnIntervalSeconds: number;
}

export type MatchConfig = GameConfig & MatchSettings;

/** Snapshot taken when a match starts: later option changes only affect new matches. */
export function createMatchConfig(settings: MatchSettings, base: GameConfig = GAME_CONFIG): MatchConfig {
  return Object.freeze({ ...structuredClone(base), ...settings });
}
