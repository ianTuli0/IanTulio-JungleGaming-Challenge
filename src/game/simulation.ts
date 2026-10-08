// Pure game rules: no Pixi, no DOM. Advanced with fixed steps by the controller.
import {
  DEFAULT_BOUNDS,
  ISLAND_SHIFT_SECONDS,
  PERIPHERALS,
  PLAYER_START,
  WALLS,
  blobCollider,
  colliderDistance,
  insideArena,
  islandColliders,
  islandSpots,
  obstacleDistance,
  peripheralBlob,
  type Blob,
  type Bounds,
  type Collider,
} from './arena.ts';
import { createRng } from '../rng.ts';
import type { EndReason, EnemyKind, MatchConfig, MotionConfig, ShipKind, WeaponConfig } from './config.ts';

export interface InputState {
  forward: boolean;
  turnLeft: boolean;
  turnRight: boolean;
  fireFront: boolean;
  fireLeft: boolean;
  fireRight: boolean;
}

export type Weapon = 'front' | 'left' | 'right';
export type Owner = 'player' | 'enemy';

export interface Ship {
  id: number;
  kind: ShipKind;
  x: number;
  y: number;
  angle: number; // heading in radians, 0 = +x, clockwise on screen
  speed: number;
  prevX: number;
  prevY: number;
  prevAngle: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  motion: MotionConfig;
  cooldowns: Record<Weapon, number>;
}

export interface Projectile {
  id: number;
  owner: Owner;
  /** Ship that fired it: when an enemy sinks, its balls in flight go down with it. */
  shipId: number;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  damage: number;
  ttl: number;
}

export type SimEvent =
  | { type: 'shot'; owner: Owner; weapon: Weapon; muzzles: { x: number; y: number }[]; angle: number }
  | { type: 'hit'; shipId: number; kind: ShipKind; x: number; y: number; hp: number }
  | { type: 'splash'; x: number; y: number }
  /** A ball hit a fortress wall (which breaks) or tower (which never does). */
  | { type: 'wall-hit'; wall: number; x: number; y: number; broken: boolean }
  /** A peripheral island went under and surfaced with its top-left corner at x, y. */
  | { type: 'island-moved'; island: number; x: number; y: number }
  | { type: 'destroyed'; shipId: number; kind: ShipKind; x: number; y: number; angle: number; cause: 'shot' | 'ram' }
  | { type: 'spawn'; shipId: number; kind: EnemyKind }
  | { type: 'score'; score: number }
  | { type: 'ended'; reason: EndReason };

export type MatchStatus = 'running' | 'ended';

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const approach = (v: number, target: number, delta: number) =>
  v < target ? Math.min(target, v + delta) : Math.max(target, v - delta);

/** Squared distance from point P to segment AB. */
function segmentDistSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby || 1)));
  const dx = ax + abx * t - px;
  const dy = ay + aby * t - py;
  return dx * dx + dy * dy;
}

// ---------------------------------------------------------------------------
// Flow field: BFS distance from the player's cell over water cells, so enemies
// sail around islands instead of grinding against them.

const NAV_CELL = 32;
const NEIGHBOURS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
] as const;

class NavField {
  private readonly bounds: Bounds;
  private readonly cols: number;
  private readonly rows: number;
  private readonly blocked: Uint8Array;
  private readonly dist: Int32Array;
  private readonly queue: Int32Array;
  private readonly clearance: number;
  private target = -1;

  constructor(bounds: Bounds, clearance: number, colliders: readonly Collider[]) {
    this.bounds = bounds;
    this.cols = Math.ceil((bounds.x1 - bounds.x0) / NAV_CELL);
    this.rows = Math.ceil((bounds.y1 - bounds.y0) / NAV_CELL);
    this.blocked = new Uint8Array(this.cols * this.rows);
    this.dist = new Int32Array(this.cols * this.rows);
    this.queue = new Int32Array(this.cols * this.rows);
    this.clearance = clearance;
    this.rebuild(colliders);
  }

  private centre(i: number): { x: number; y: number } {
    const c = i % this.cols;
    return { x: this.bounds.x0 + (c + 0.5) * NAV_CELL, y: this.bounds.y0 + ((i - c) / this.cols + 0.5) * NAV_CELL };
  }

  /** Marks the cells a hull cannot use; called again whenever islands move. */
  rebuild(colliders: readonly Collider[]): void {
    for (let i = 0; i < this.blocked.length; i++) {
      const { x, y } = this.centre(i);
      this.blocked[i] = obstacleDistance(colliders, x, y) < this.clearance || !insideArena(this.bounds, x, y, this.clearance * 0.6) ? 1 : 0;
    }
    this.target = -1;
  }

  private cell(x: number, y: number): number {
    const c = Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.bounds.x0) / NAV_CELL)));
    const r = Math.min(this.rows - 1, Math.max(0, Math.floor((y - this.bounds.y0) / NAV_CELL)));
    return r * this.cols + c;
  }

  update(x: number, y: number): void {
    const start = this.cell(x, y);
    if (start === this.target) return;
    this.target = start;
    const cols = this.cols;
    this.dist.fill(-1);
    this.dist[start] = 0;
    let head = 0;
    let tail = 0;
    this.queue[tail++] = start;
    while (head < tail) {
      const i = this.queue[head++];
      const c = i % cols;
      const r = (i - c) / cols;
      for (const [dc, dr] of NEIGHBOURS) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= this.rows) continue;
        const n = nr * cols + nc;
        if (this.dist[n] !== -1 || this.blocked[n]) continue;
        // No corner cutting around island edges.
        if (dc && dr && (this.blocked[r * cols + nc] || this.blocked[nr * cols + c])) continue;
        this.dist[n] = this.dist[i] + 1;
        this.queue[tail++] = n;
      }
    }
  }

  /** Centre of the neighbouring cell that is closest to the player, or null if unknown. */
  next(x: number, y: number): { x: number; y: number } | null {
    const i = this.cell(x, y);
    const c = i % this.cols;
    const r = (i - c) / this.cols;
    let best = -1;
    let bestDist = this.dist[i] === -1 ? Infinity : this.dist[i];
    for (const [dc, dr] of NEIGHBOURS) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
      const n = nr * this.cols + nc;
      if (this.dist[n] !== -1 && this.dist[n] < bestDist) {
        bestDist = this.dist[n];
        best = n;
      }
    }
    return best === -1 ? null : this.centre(best);
  }

  /** Cell centres near the border: candidate spawn points (islands are checked at spawn time). */
  edgeCells(band: number, clearance: number): { x: number; y: number }[] {
    const { x0, y0, x1, y1 } = this.bounds;
    return Array.from(this.blocked, (_, i) => this.centre(i)).filter(({ x, y }) => {
      const edge = Math.min(x - x0, y - y0, x1 - x, y1 - y);
      return edge >= clearance && edge <= band;
    });
  }
}

// ---------------------------------------------------------------------------

export class Simulation {
  readonly config: MatchConfig;
  status: MatchStatus = 'running';
  endReason: EndReason | null = null;
  elapsed = 0;
  score = 0;
  /** One flag per WALLS entry: a broken wall lets every later ball through. */
  readonly wallBroken = WALLS.map(() => false);
  /** Navigable rectangle: the designed layout plus open sea to fill the player's screen. */
  readonly bounds: Bounds;
  /** Where peripheral islands can surface, and the spot index each one is at. */
  readonly islandSpots: { x: number; y: number }[];
  readonly islandSlots = PERIPHERALS.map((p) => p.slot);
  colliders: Collider[];
  readonly player: Ship;
  enemies: Ship[] = [];
  projectiles: Projectile[] = [];

  private events: SimEvent[] = [];
  private nextId = 1;
  private spawnTimer: number;
  private spawnCount = 0;
  private readonly rng: () => number;
  private readonly nav: NavField;
  private readonly spawnPoints: { x: number; y: number }[];
  private readonly spawnClearance: number;
  private islandTimer = ISLAND_SHIFT_SECONDS;

  constructor(config: MatchConfig, seed: number, bounds: Bounds = DEFAULT_BOUNDS) {
    this.config = config;
    this.bounds = bounds;
    this.islandSpots = islandSpots(bounds);
    this.colliders = islandColliders(PERIPHERALS.map((_, i) => this.peripheral(i)));
    this.rng = createRng(seed);
    this.player = this.createShip('player', PLAYER_START.x, PLAYER_START.y, PLAYER_START.angle);
    this.spawnTimer = Math.min(config.spawn.firstSpawnDelaySeconds, config.spawnIntervalSeconds);
    const largest = Math.max(config.chaser.hull.radius, config.shooter.hull.radius);
    this.nav = new NavField(bounds, largest + 4, this.colliders);
    const fit = Math.max(
      config.chaser.hull.radius + config.chaser.hull.halfLength,
      config.shooter.hull.radius + config.shooter.hull.halfLength,
    );
    this.spawnClearance = fit + 4;
    this.spawnPoints = this.nav.edgeCells(150, this.spawnClearance);
  }

  get remaining(): number {
    return Math.max(0, this.config.sessionSeconds - this.elapsed);
  }

  /** Events produced since the last call (consumed by renderer, audio and HUD). */
  drainEvents(): SimEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  step(dt: number, input: InputState): void {
    if (this.status !== 'running') return;
    this.elapsed += dt;
    for (const s of [this.player, ...this.enemies]) {
      s.prevX = s.x;
      s.prevY = s.y;
      s.prevAngle = s.angle;
    }
    for (const p of this.projectiles) {
      p.prevX = p.x;
      p.prevY = p.y;
    }

    this.updatePlayer(dt, input);
    this.islandTimer -= dt;
    if (this.islandTimer <= 0) {
      this.islandTimer += ISLAND_SHIFT_SECONDS;
      this.shiftIslands();
    }
    this.updateSpawner(dt);
    this.nav.update(this.player.x, this.player.y);
    for (const e of this.enemies) this.updateEnemy(e, dt);
    this.resolveContacts();
    this.updateProjectiles(dt);
    this.enemies = this.enemies.filter((e) => e.alive);

    if (this.status !== 'running') return;
    if (this.elapsed >= this.config.sessionSeconds) {
      this.elapsed = this.config.sessionSeconds;
      this.end('time-up');
    }
  }

  /** Adds an enemy at a given pose. Used by the spawner (and by the headless checks). */
  addEnemy(kind: EnemyKind, x: number, y: number, angle: number): Ship {
    const ship = this.createShip(kind, x, y, angle);
    this.enemies.push(ship);
    this.events.push({ type: 'spawn', shipId: ship.id, kind });
    return ship;
  }

  /** Signed distance to the nearest island at its current position (negative = on land). */
  obstacleDistance(x: number, y: number): number {
    return obstacleDistance(this.colliders, x, y);
  }

  /** Sand area of a peripheral island at its current spot. */
  peripheral(island: number): Blob {
    return peripheralBlob(island, this.islandSpots[this.islandSlots[island]]);
  }

  /** Each peripheral island goes under and surfaces at another free spot, never on a ship. */
  shiftIslands(): void {
    PERIPHERALS.forEach((_, i) => {
      const free = this.islandSpots.map((_, k) => k).filter((k) => {
        if (this.islandSlots.includes(k)) return false;
        const c = blobCollider(peripheralBlob(i, this.islandSpots[k]));
        return [this.player, ...this.enemies].every(
          (s) => !s.alive || this.circles(s).every(([x, y]) => colliderDistance(c, x, y) > s.motion.hull.radius + 12),
        );
      });
      if (!free.length) return; // every other slot has a ship on it: stays put until the next shift
      this.islandSlots[i] = free[Math.floor(this.rng() * free.length)];
      const { x, y } = this.peripheral(i);
      this.events.push({ type: 'island-moved', island: i, x, y });
    });
    this.colliders = islandColliders(PERIPHERALS.map((_, i) => this.peripheral(i)));
    this.nav.rebuild(this.colliders);
  }

  // -- ships -----------------------------------------------------------------

  private createShip(kind: ShipKind, x: number, y: number, angle: number): Ship {
    const motion = this.config[kind];
    return {
      id: this.nextId++,
      kind,
      x,
      y,
      angle,
      speed: 0,
      prevX: x,
      prevY: y,
      prevAngle: angle,
      hp: motion.maxHp,
      maxHp: motion.maxHp,
      alive: true,
      motion,
      cooldowns: { front: 0, left: 0, right: 0 },
    };
  }

  /** True if the ship's capsule at this pose overlaps an obstacle or leaves the arena. */
  private blocked(ship: Ship, x: number, y: number, angle: number): boolean {
    const { radius, halfLength } = ship.motion.hull;
    const ox = Math.cos(angle) * halfLength;
    const oy = Math.sin(angle) * halfLength;
    for (let k = -1; k <= 1; k++) {
      const px = x + ox * k;
      const py = y + oy * k;
      if (!insideArena(this.bounds, px, py, radius) || this.obstacleDistance(px, py) < radius) return true;
    }
    return false;
  }

  /**
   * Turns in place. Against a shore the swing of the bow or stern would overlap it (a hull lying along a
   * beach can never turn either way), so the hull turns anyway and is pushed out of what it swept into.
   */
  private rotate(ship: Ship, delta: number): void {
    const angle = wrapAngle(ship.angle + delta);
    const pose = this.blocked(ship, ship.x, ship.y, angle) ? this.pushedClear(ship, angle) : ship;
    if (!pose) return;
    ship.angle = angle;
    ship.x = pose.x;
    ship.y = pose.y;
  }

  /** The ship's position moved just far enough to clear every island and arena edge at this heading, or null if it cannot. */
  private pushedClear(ship: Ship, angle: number): { x: number; y: number } | null {
    const { radius, halfLength } = ship.motion.hull;
    const { x0, y0, x1, y1 } = this.bounds;
    let { x, y } = ship;
    for (let pass = 0; pass < 4; pass++) {
      for (let k = -1; k <= 1; k++) {
        const px = x + Math.cos(angle) * halfLength * k;
        const py = y + Math.sin(angle) * halfLength * k;
        const d = this.obstacleDistance(px, py);
        if (d < radius) {
          // the slope of the distance field points away from the island
          const gx = this.obstacleDistance(px + 1, py) - this.obstacleDistance(px - 1, py);
          const gy = this.obstacleDistance(px, py + 1) - this.obstacleDistance(px, py - 1);
          const g = Math.hypot(gx, gy) || 1;
          x += (gx / g) * (radius - d + 0.01);
          y += (gy / g) * (radius - d + 0.01);
        }
        x += Math.max(0, x0 + radius - px + 0.01) + Math.min(0, x1 - radius - px - 0.01);
        y += Math.max(0, y0 + radius - py + 0.01) + Math.min(0, y1 - radius - py - 0.01);
      }
    }
    return this.blocked(ship, x, y, angle) ? null : { x, y };
  }

  /** Moves forward, sliding along obstacles; a head-on bump kills the speed. */
  private move(ship: Ship, dt: number): void {
    if (ship.speed <= 0) return;
    const dx = Math.cos(ship.angle) * ship.speed * dt;
    const dy = Math.sin(ship.angle) * ship.speed * dt;
    if (!this.blocked(ship, ship.x + dx, ship.y + dy, ship.angle)) {
      ship.x += dx;
      ship.y += dy;
    } else if (Math.abs(dx) > 0.01 && !this.blocked(ship, ship.x + dx, ship.y, ship.angle)) {
      ship.x += dx;
    } else if (Math.abs(dy) > 0.01 && !this.blocked(ship, ship.x, ship.y + dy, ship.angle)) {
      ship.y += dy;
    } else {
      ship.speed = 0;
    }
  }

  private updatePlayer(dt: number, input: InputState): void {
    const p = this.player;
    const cfg = this.config.player;
    const turn = (input.turnRight ? 1 : 0) - (input.turnLeft ? 1 : 0);
    if (turn) this.rotate(p, turn * cfg.turnSpeed * dt);
    p.speed = approach(p.speed, input.forward ? cfg.maxSpeed : 0, (input.forward ? cfg.acceleration : cfg.drag) * dt);
    this.move(p, dt);

    this.tickCooldowns(p, dt);
    if (input.fireFront && p.cooldowns.front <= 0) {
      p.cooldowns.front = cfg.front.cooldown;
      this.fire(p, 'front', cfg.front, 1, 0);
    }
    for (const side of ['left', 'right'] as const) {
      if (!(side === 'left' ? input.fireLeft : input.fireRight) || p.cooldowns[side] > 0) continue;
      p.cooldowns[side] = cfg.broadside.cooldown;
      this.fire(p, side, cfg.broadside, cfg.broadside.count, cfg.broadside.spacing);
    }
  }

  private tickCooldowns(ship: Ship, dt: number): void {
    ship.cooldowns.front = Math.max(0, ship.cooldowns.front - dt);
    ship.cooldowns.left = Math.max(0, ship.cooldowns.left - dt);
    ship.cooldowns.right = Math.max(0, ship.cooldowns.right - dt);
  }

  /** Spawns `count` parallel balls from the bow (front) or along a side (broadside). */
  private fire(ship: Ship, weapon: Weapon, w: WeaponConfig, count: number, spacing: number): void {
    const { radius, halfLength } = ship.motion.hull;
    const fx = Math.cos(ship.angle);
    const fy = Math.sin(ship.angle);
    const dir = weapon === 'front' ? ship.angle : ship.angle + (weapon === 'left' ? -Math.PI / 2 : Math.PI / 2);
    const dx = Math.cos(dir);
    const dy = Math.sin(dir);
    const reach = (weapon === 'front' ? halfLength + radius : radius) + 4;
    const muzzles: { x: number; y: number }[] = [];
    for (let i = 0; i < count; i++) {
      const along = (i - (count - 1) / 2) * spacing;
      const x = ship.x + dx * reach + fx * along;
      const y = ship.y + dy * reach + fy * along;
      muzzles.push({ x, y });
      this.projectiles.push({
        id: this.nextId++,
        owner: ship.kind === 'player' ? 'player' : 'enemy',
        shipId: ship.id,
        x,
        y,
        prevX: x,
        prevY: y,
        vx: dx * w.speed,
        vy: dy * w.speed,
        damage: w.damage,
        ttl: w.range / w.speed,
      });
    }
    this.events.push({ type: 'shot', owner: ship.kind === 'player' ? 'player' : 'enemy', weapon, muzzles, angle: dir });
  }

  // -- enemies ---------------------------------------------------------------

  private updateSpawner(dt: number): void {
    this.spawnTimer -= dt;
    if (this.enemies.length >= this.config.spawn.maxAlive) {
      // Deferred, not banked: time spent at the cap must not turn into a burst of replacements.
      this.spawnTimer = Math.max(0, this.spawnTimer);
      return;
    }
    if (this.spawnTimer > 0) return;
    if (this.spawnEnemy()) this.spawnTimer += this.config.spawnIntervalSeconds;
  }

  private pickKind(): EnemyKind {
    const { opening, weights } = this.config.spawn;
    if (this.spawnCount < opening.length) return opening[this.spawnCount];
    return this.rng() * (weights.chaser + weights.shooter) < weights.chaser ? 'chaser' : 'shooter';
  }

  private spawnEnemy(): boolean {
    const kind = this.pickKind();
    const hull = this.config[kind].hull;
    const p = this.player;
    const others = [p, ...this.enemies];
    const free = this.spawnPoints.filter(
      (pt) =>
        this.obstacleDistance(pt.x, pt.y) > this.spawnClearance &&
        others.every((s) => Math.hypot(s.x - pt.x, s.y - pt.y) > (hull.radius + hull.halfLength) * 2 + 8),
    );
    const far = free.filter((pt) => Math.hypot(p.x - pt.x, p.y - pt.y) >= this.config.spawn.minPlayerDistance);
    // Fallback (tiny arenas / crowded edges): the free point farthest from the player.
    const pt = far.length
      ? far[Math.floor(this.rng() * far.length)]
      : free.reduce<{ x: number; y: number } | null>(
          (best, c) => (!best || Math.hypot(p.x - c.x, p.y - c.y) > Math.hypot(p.x - best.x, p.y - best.y) ? c : best),
          null,
        );
    if (!pt) return false;
    this.spawnCount++;
    this.addEnemy(kind, pt.x, pt.y, Math.atan2(p.y - pt.y, p.x - pt.x));
    return true;
  }

  /** Line of sight with a corridor wide enough for the given radius. */
  private clearPath(x0: number, y0: number, x1: number, y1: number, radius: number): boolean {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.ceil(len / 12);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.obstacleDistance(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t) < radius) return false;
    }
    return true;
  }

  private updateEnemy(e: Ship, dt: number): void {
    const p = this.player;
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const dist = Math.hypot(dx, dy);
    const sight = this.clearPath(e.x, e.y, p.x, p.y, e.motion.hull.radius);
    const toPlayer = Math.atan2(dy, dx);
    let heading = toPlayer;
    if (!sight) {
      const wp = this.nav.next(e.x, e.y);
      if (wp) heading = Math.atan2(wp.y - e.y, wp.x - e.x);
    }

    let throttle = 1;
    this.tickCooldowns(e, dt);
    if (e.kind === 'shooter') {
      const cfg = this.config.shooter;
      // Balls fly over islands, so in range it just turns to aim (walls may still eat the shot).
      if (dist <= cfg.attackRange) heading = toPlayer;
      if (dist <= cfg.holdRange) throttle = 0;
      else if (dist <= cfg.attackRange) throttle = 0.35;
      const aimError = Math.abs(wrapAngle(toPlayer - e.angle));
      if (dist <= cfg.attackRange && aimError <= cfg.aimTolerance && e.cooldowns.front <= 0) {
        e.cooldowns.front = cfg.cannon.cooldown;
        this.fire(e, 'front', cfg.cannon, 1, 0);
      }
    }

    const diff = wrapAngle(heading - e.angle);
    const maxTurn = e.motion.turnSpeed * dt;
    this.rotate(e, Math.max(-maxTurn, Math.min(maxTurn, diff)));
    // Ease off while turning hard so ships carve tighter corners.
    const desired = e.motion.maxSpeed * throttle * Math.max(0.3, Math.cos(diff));
    e.speed = approach(e.speed, desired, (desired > e.speed ? e.motion.acceleration : e.motion.drag) * dt);
    this.move(e, dt);
  }

  // -- collisions & combat -----------------------------------------------------

  /** Chaser rams + push-apart between hulls (each hull = 3 circles along its keel). */
  private resolveContacts(): void {
    const p = this.player;
    for (const e of this.enemies) {
      if (!e.alive || e.kind !== 'chaser' || !this.overlap(e, p)) continue;
      e.alive = false;
      this.events.push({ type: 'destroyed', shipId: e.id, kind: e.kind, x: e.x, y: e.y, angle: e.angle, cause: 'ram' });
      this.damage(p, this.config.chaser.ramDamage, p.x, p.y, 'ram');
      if (this.status !== 'running') return;
    }
    const ships = [p, ...this.enemies.filter((e) => e.alive)];
    for (let i = 0; i < ships.length; i++) {
      for (let j = i + 1; j < ships.length; j++) this.separate(ships[i], ships[j]);
    }
  }

  private circles(s: Ship): [number, number][] {
    const h = s.motion.hull.halfLength;
    const ox = Math.cos(s.angle) * h;
    const oy = Math.sin(s.angle) * h;
    return [[s.x - ox, s.y - oy], [s.x, s.y], [s.x + ox, s.y + oy]];
  }

  /** Deepest overlap between two hulls: [depth, nx, ny] pointing from a to b. */
  private contact(a: Ship, b: Ship): [number, number, number] {
    const reach = a.motion.hull.radius + b.motion.hull.radius;
    let best: [number, number, number] = [0, 0, 0];
    for (const [ax, ay] of this.circles(a)) {
      for (const [bx, by] of this.circles(b)) {
        const d = Math.hypot(bx - ax, by - ay);
        if (reach - d > best[0]) best = [reach - d, d ? (bx - ax) / d : 1, d ? (by - ay) / d : 0];
      }
    }
    return best;
  }

  private overlap(a: Ship, b: Ship): boolean {
    return this.contact(a, b)[0] > 0;
  }

  private separate(a: Ship, b: Ship): void {
    const [depth, nx, ny] = this.contact(a, b);
    if (depth <= 0) return;
    const push = depth / 2 + 0.01;
    // Each hull only moves if the push keeps it out of obstacles.
    if (!this.blocked(a, a.x - nx * push, a.y - ny * push, a.angle)) {
      a.x -= nx * push;
      a.y -= ny * push;
    }
    if (!this.blocked(b, b.x + nx * push, b.y + ny * push, b.angle)) {
      b.x += nx * push;
      b.y += ny * push;
    }
  }

  /** Intact wall or tower under a ball, or -1. Islands themselves do not stop balls. */
  private wallAt(x: number, y: number): number {
    const r = this.config.projectileRadius;
    return WALLS.findIndex((w, i) => !this.wallBroken[i] && x > w.x0 - r && x < w.x1 + r && y > w.y0 - r && y < w.y1 + r);
  }

  /** Capsule test used for cannonball hits. */
  private hitTest(s: Ship, x: number, y: number): boolean {
    const { radius, halfLength } = s.motion.hull;
    const ox = Math.cos(s.angle) * halfLength;
    const oy = Math.sin(s.angle) * halfLength;
    const reach = radius + this.config.projectileRadius;
    return segmentDistSq(x, y, s.x - ox, s.y - oy, s.x + ox, s.y + oy) <= reach * reach;
  }

  private updateProjectiles(dt: number): void {
    const kept: Projectile[] = [];
    const afloat = new Set(this.enemies.filter((e) => e.alive).map((e) => e.id));
    for (const b of this.projectiles) {
      if (this.status !== 'running') break;
      // Destroyed enemies stop dealing damage, including balls they fired before sinking.
      if (b.owner === 'enemy' && !afloat.has(b.shipId)) {
        this.events.push({ type: 'splash', x: b.x, y: b.y });
        continue;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.ttl -= dt;
      if (!insideArena(this.bounds, b.x, b.y)) continue;
      const wall = this.wallAt(b.x, b.y);
      if (wall !== -1) {
        const breaks = WALLS[wall].broken !== null;
        if (breaks) this.wallBroken[wall] = true;
        this.events.push({ type: 'wall-hit', wall, x: b.x, y: b.y, broken: breaks });
        continue;
      }
      const target =
        b.owner === 'player'
          ? this.enemies.find((e) => e.alive && this.hitTest(e, b.x, b.y))
          : this.player.alive && this.hitTest(this.player, b.x, b.y)
            ? this.player
            : undefined;
      if (target) {
        // One ball, one hit: it is consumed right here.
        this.damage(target, b.damage, b.x, b.y, 'shot');
        continue;
      }
      if (b.ttl <= 0) {
        this.events.push({ type: 'splash', x: b.x, y: b.y });
        continue;
      }
      kept.push(b);
    }
    this.projectiles = this.status === 'running' ? kept : [];
  }

  private damage(ship: Ship, amount: number, x: number, y: number, cause: 'shot' | 'ram'): void {
    if (!ship.alive || this.status !== 'running') return;
    ship.hp = Math.max(0, ship.hp - amount);
    this.events.push({ type: 'hit', shipId: ship.id, kind: ship.kind, x, y, hp: ship.hp });
    if (ship.hp > 0) return;
    ship.alive = false;
    this.events.push({ type: 'destroyed', shipId: ship.id, kind: ship.kind, x: ship.x, y: ship.y, angle: ship.angle, cause });
    if (ship.kind === 'player') {
      this.end('destroyed');
      return;
    }
    // Only kills by the player's cannons score; a Chaser blowing itself up does not.
    this.score++;
    this.events.push({ type: 'score', score: this.score });
  }

  private end(reason: EndReason): void {
    if (this.status !== 'running') return;
    this.status = 'ended';
    this.endReason = reason;
    this.events.push({ type: 'ended', reason });
  }
}
