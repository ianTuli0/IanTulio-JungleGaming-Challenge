// Pixi view of the simulation. Reads state, never changes rules.
import { Container, Graphics, Rectangle, Sprite, Texture, TilingSprite } from 'pixi.js';
import { ARENA_HEIGHT, ARENA_WIDTH, ISLANDS, ISLAND_BLOCKS, ISLAND_COLLIDERS, ROCKS, SHALLOW_ORIGIN, TILE } from './arena.ts';
import type { GameAssets } from './assets.ts';
import type { ShipKind } from './config.ts';
import type { Ship, SimEvent, Simulation } from './simulation.ts';

/** Sail colour column in the ship sheet (white, black, red, green, blue, yellow). */
const SAIL: Record<ShipKind, number> = { player: 4, chaser: 2, shooter: 1 };
const BAR_SCALE = 0.4;
/** Ship sprites are 113 px long; bars float just above the hull at any heading. */
const barOffset = (spriteScale: number) => spriteScale * 62;

/** Frame of cell (i, j) in a w x h area drawn with the 3x3 block at `origin` (16-wide sheet). */
const nineSlice = (origin: number, i: number, j: number, w: number, h: number) =>
  origin + (j === 0 ? 0 : j === h - 1 ? 2 : 1) * 16 + (i === 0 ? 0 : i === w - 1 ? 2 : 1);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpAngle = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
const damageLevel = (hp: number, max: number) => (hp <= 0 ? 3 : hp / max > 2 / 3 ? 0 : hp / max > 1 / 3 ? 1 : 2);

interface ShipView {
  sail: number;
  body: Container;
  hull: Sprite;
  fires: Sprite[];
  bar: Container;
  fill: Texture;
  level: number;
  hp: number;
  flash: number;
  age: number;
}

interface Effect {
  node: Container;
  age: number;
  life: number;
  update(k: number, dt: number): void;
}

export class GameRenderer {
  readonly world = new Container();
  private readonly shipLayer = new Container();
  private readonly ballLayer = new Container();
  private readonly trails = new Graphics();
  private readonly effectLayer = new Container();
  private readonly barLayer = new Container();
  private readonly ships = new Map<number, ShipView>();
  private readonly balls: Sprite[] = [];
  private effects: Effect[] = [];
  private shake = 0;
  private time = 0;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly assets: GameAssets;

  constructor(assets: GameAssets, debug = false) {
    this.assets = assets;
    this.world.addChild(this.buildMap(), this.trails, this.shipLayer, this.ballLayer, this.effectLayer, this.barLayer);
    if (debug) this.world.addChild(this.buildColliderOverlay());
  }

  /** Fits the arena inside the canvas, preserving its aspect ratio (letterboxed). */
  layout(width: number, height: number): void {
    const scale = Math.min(width / ARENA_WIDTH, height / ARENA_HEIGHT);
    this.world.scale.set(scale);
    this.world.position.set((width - ARENA_WIDTH * scale) / 2, (height - ARENA_HEIGHT * scale) / 2);
  }

  private tile(frame: number): Texture {
    return this.assets.tiles.textures[frame];
  }

  private ship(name: string): Texture {
    return this.assets.ships.textures[name];
  }

  private buildMap(): Container {
    const map = new Container();
    map.addChild(new TilingSprite({ texture: this.assets.water, width: ARENA_WIDTH, height: ARENA_HEIGHT }));
    const put = (frame: number, x: number, y: number, centred = false) => {
      const s = new Sprite(this.tile(frame));
      if (centred) s.anchor.set(0.5);
      s.position.set(x, y);
      map.addChild(s);
    };
    for (const isl of ISLANDS) {
      const size = ISLAND_BLOCKS[isl.style].size + 2;
      for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) put(nineSlice(SHALLOW_ORIGIN, i, j, size, size), (isl.col - 1 + i) * TILE, (isl.row - 1 + j) * TILE);
      }
    }
    for (const isl of ISLANDS) {
      const { origin, size } = ISLAND_BLOCKS[isl.style];
      for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) put(origin + i + j * 16, (isl.col + i) * TILE, (isl.row + j) * TILE);
      for (const d of isl.decor) put(d.frame, (isl.col + d.dx) * TILE, (isl.row + d.dy) * TILE, true);
    }
    for (const r of ROCKS) put(r.frame, r.x, r.y, true);
    return map;
  }

  private buildColliderOverlay(): Graphics {
    const g = new Graphics();
    for (const c of ISLAND_COLLIDERS) g.roundRect(c.cx - c.hw, c.cy - c.hh, c.hw * 2, c.hh * 2, c.r);
    for (const r of ROCKS) g.circle(r.x, r.y, r.radius);
    return g.fill({ color: 0xff0044, alpha: 0.3 });
  }

  // -- per-frame sync -----------------------------------------------------------

  /** `alpha` interpolates between the last two fixed steps; `dt` drives visual-only animation. */
  render(sim: Simulation, alpha: number, dt: number): void {
    this.time += dt;
    const live = new Set<number>();
    for (const s of [sim.player, ...sim.enemies]) {
      if (!s.alive) continue;
      live.add(s.id);
      this.syncShip(s, alpha, dt);
    }
    for (const [id, view] of this.ships) if (!live.has(id)) this.removeShip(id, view, false);
    this.syncBalls(sim, alpha);
    this.updateEffects(dt);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      const m = this.shake * 18;
      this.world.pivot.set((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
    } else {
      this.world.pivot.set(0, 0);
    }
  }

  private createShip(s: Ship): ShipView {
    // body (position/rotation, sprite scale) -> hull sprite + flames that show up as damage grows.
    const body = new Container();
    body.scale.set(s.motion.hull.spriteScale);
    const sail = SAIL[s.kind];
    const hull = new Sprite(this.ship(`ship_${sail + 1}`));
    hull.anchor.set(0.5);
    const fires = [
      { frame: 'fire_2', x: 10, y: 22 },
      { frame: 'fire_1', x: -9, y: -16 },
    ].map(({ frame, x, y }) => {
      const f = new Sprite(this.ship(frame));
      f.anchor.set(0.5, 0.85);
      f.position.set(x, y);
      f.visible = false;
      return f;
    });
    body.addChild(hull, ...fires);
    body.alpha = 0;
    this.shipLayer.addChild(body);

    // Health bar: frame + a fill whose texture frame is cropped to the remaining hp.
    const ui = this.assets.ui.textures;
    const bar = new Container();
    const frame = new Sprite(ui.enemy_health_frame);
    frame.anchor.set(0);
    const fillBase = ui[s.kind === 'player' ? 'enemy_health_fill_green' : 'enemy_health_fill_red'];
    const r = this.assets.enemyBarFill;
    const fill = new Texture({
      source: fillBase.source,
      frame: new Rectangle(fillBase.frame.x + r.x, fillBase.frame.y + r.y, r.w, r.h),
      dynamic: true,
    });
    const fillSprite = new Sprite(fill);
    fillSprite.anchor.set(0);
    fillSprite.position.set(r.x, r.y);
    bar.addChild(frame, fillSprite); // atlas draw_order: frame, then fill
    bar.scale.set(BAR_SCALE);
    bar.pivot.set(frame.width / 2, frame.height);
    this.barLayer.addChild(bar);

    const view: ShipView = { sail, body, hull, fires, bar, fill, level: 0, hp: s.hp, flash: 0, age: 0 };
    this.ships.set(s.id, view);
    return view;
  }

  private syncShip(s: Ship, alpha: number, dt: number): void {
    const v = this.ships.get(s.id) ?? this.createShip(s);
    v.age += dt;
    const x = lerp(s.prevX, s.x, alpha);
    const y = lerp(s.prevY, s.y, alpha);
    v.body.position.set(x, y);
    v.body.rotation = lerpAngle(s.prevAngle, s.angle, alpha) - Math.PI / 2; // sprites face +y
    v.body.alpha = s.kind === 'player' ? 1 : Math.min(1, v.age / 0.4); // enemies fade in on spawn
    v.bar.position.set(x, y - barOffset(s.motion.hull.spriteScale));

    if (v.hp !== s.hp) {
      v.hp = s.hp;
      v.fill.frame.width = Math.max(0.01, this.assets.enemyBarFill.w * (s.hp / s.maxHp));
      v.fill.update();
      const level = damageLevel(s.hp, s.maxHp);
      if (level !== v.level) {
        v.level = level;
        v.hull.texture = this.ship(`ship_${level * 6 + v.sail + 1}`);
        v.fires[0].visible = level >= 1;
        v.fires[1].visible = level >= 2;
      }
    }
    v.fires.forEach((f, i) => {
      if (f.visible) f.scale.set(1 + 0.1 * Math.sin(this.time * 19 + i * 2), 1 + 0.2 * Math.sin(this.time * 23 + i * 3));
    });
    v.flash = Math.max(0, v.flash - dt);
    v.hull.tint = v.flash > 0 ? 0xff9a8a : 0xffffff;
  }

  /** Destroyed hulls become sinking wrecks (effects), their bars and textures are freed. */
  private removeShip(id: number, v: ShipView, wreck: boolean): void {
    this.ships.delete(id);
    v.bar.destroy({ children: true });
    v.fill.destroy(false);
    if (!wreck) {
      v.body.destroy({ children: true });
      return;
    }
    v.hull.tint = 0xffffff;
    v.hull.texture = this.ship(`ship_${18 + v.sail + 1}`);
    this.shipLayer.removeChild(v.body);
    this.effectLayer.addChildAt(v.body, 0);
    const start = v.body.scale.x;
    this.addEffect(v.body, 2.2, (k) => {
      v.body.scale.set(start * (1 - 0.25 * k));
      v.body.alpha = k < 0.5 ? 1 : 1 - (k - 0.5) * 2;
    });
  }

  private syncBalls(sim: Simulation, alpha: number): void {
    const list = sim.projectiles;
    while (this.balls.length < list.length) {
      const b = new Sprite(this.ship('cannon_ball'));
      b.anchor.set(0.5);
      this.ballLayer.addChild(b);
      this.balls.push(b);
    }
    this.trails.clear();
    this.balls.forEach((b, i) => {
      const p = list[i];
      b.visible = !!p;
      if (!p) return;
      const x = lerp(p.prevX, p.x, alpha);
      const y = lerp(p.prevY, p.y, alpha);
      b.position.set(x, y);
      this.trails.moveTo(x - p.vx * 0.06, y - p.vy * 0.06).lineTo(x, y);
    });
    if (list.length) this.trails.stroke({ width: 2.5, color: 0xffffff, alpha: 0.55, cap: 'round' });
    // Wakes behind moving hulls.
    let wakes = false;
    for (const s of [sim.player, ...sim.enemies]) {
      if (!s.alive || s.speed < 15) continue;
      wakes = true;
      const len = 26 * (s.speed / s.motion.maxSpeed);
      const back = s.angle + Math.PI;
      const sx = lerp(s.prevX, s.x, alpha) + Math.cos(back) * s.motion.hull.halfLength * 1.6;
      const sy = lerp(s.prevY, s.y, alpha) + Math.sin(back) * s.motion.hull.halfLength * 1.6;
      for (const side of [-0.35, 0.35]) {
        this.trails.moveTo(sx, sy).lineTo(sx + Math.cos(back + side) * len, sy + Math.sin(back + side) * len);
      }
    }
    if (wakes) this.trails.stroke({ width: 3, color: 0xffffff, alpha: 0.35, cap: 'round' });
  }

  // -- effects --------------------------------------------------------------------

  private addEffect(node: Container, life: number, update: Effect['update']): void {
    if (!node.parent) this.effectLayer.addChild(node);
    this.effects.push({ node, age: 0, life, update });
    update(0, 0);
  }

  private updateEffects(dt: number): void {
    if (dt <= 0) return;
    this.effects = this.effects.filter((e) => {
      e.age += dt;
      const k = Math.min(1, e.age / e.life);
      e.update(k, dt);
      if (k < 1) return true;
      e.node.destroy({ children: true });
      return false;
    });
  }

  private sprite(frame: string, x: number, y: number, scale: number): Sprite {
    const s = new Sprite(this.ship(frame));
    s.anchor.set(0.5);
    s.position.set(x, y);
    s.scale.set(scale);
    return s;
  }

  private explosion(x: number, y: number, size: number): void {
    const s = this.sprite('explosion_3', x, y, size * 0.5);
    s.rotation = Math.random() * Math.PI * 2;
    this.addEffect(s, 0.65, (k) => {
      s.texture = this.ship(k < 0.25 ? 'explosion_3' : k < 0.5 ? 'explosion_2' : 'explosion_1');
      s.scale.set(size * (0.5 + k * 0.6));
      s.alpha = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
    });
  }

  private debris(x: number, y: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const s = this.sprite(`wood_${1 + Math.floor(Math.random() * 4)}`, x, y, 0.7);
      const a = Math.random() * Math.PI * 2;
      const v = 40 + Math.random() * 70;
      const spin = (Math.random() - 0.5) * 8;
      this.addEffect(s, 0.9, (k, dt) => {
        s.x += Math.cos(a) * v * dt * (1 - k);
        s.y += Math.sin(a) * v * dt * (1 - k);
        s.rotation += spin * dt;
        s.alpha = 1 - k;
      });
    }
  }

  private ring(x: number, y: number, from: number, to: number, life: number, width: number): void {
    const g = new Graphics().circle(0, 0, 10).stroke({ width, color: 0xffffff });
    g.position.set(x, y);
    this.addEffect(g, life, (k) => {
      g.scale.set((from + (to - from) * k) / 10);
      g.alpha = 0.8 * (1 - k);
    });
  }

  /** Visual + camera feedback for simulation events. */
  handle(events: SimEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'shot':
          for (const m of e.muzzles) {
            const f = this.sprite('explosion_3', m.x, m.y, 0.3);
            f.rotation = e.angle;
            this.addEffect(f, 0.16, (k) => {
              f.scale.set(0.3 + 0.25 * k);
              f.alpha = 1 - k;
            });
          }
          break;
        case 'hit': {
          const v = this.ships.get(e.shipId);
          if (v) v.flash = 0.12;
          this.debris(e.x, e.y, 3);
          this.explosion(e.x, e.y, 0.35);
          if (e.kind === 'player' && !this.reducedMotion) this.shake = 0.25;
          break;
        }
        case 'splash':
          this.ring(e.x, e.y, 3, 16, 0.5, 2);
          break;
        case 'obstacle-hit':
          this.debris(e.x, e.y, 2);
          this.ring(e.x, e.y, 2, 10, 0.35, 2);
          break;
        case 'destroyed': {
          const v = this.ships.get(e.shipId);
          if (v) this.removeShip(e.shipId, v, true);
          this.explosion(e.x, e.y, e.cause === 'ram' ? 1.2 : 1);
          this.debris(e.x, e.y, 8);
          this.ring(e.x, e.y, 10, 46, 0.8, 3);
          if (e.kind === 'player' && !this.reducedMotion) this.shake = 0.5;
          break;
        }
        default:
          break;
      }
    }
  }

  get effectCount(): number {
    return this.effects.length;
  }

  destroy(): void {
    for (const v of this.ships.values()) v.fill.destroy(false);
    this.ships.clear();
    this.effects = [];
    this.world.destroy({ children: true });
  }
}
