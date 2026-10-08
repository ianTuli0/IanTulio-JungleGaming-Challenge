// Pixi view of the simulation. Reads state, never changes rules.
import { Container, Graphics, NineSliceSprite, Rectangle, Sprite, Texture, TilingSprite } from 'pixi.js';
import {
  CENTRAL,
  CENTRAL_DECOR,
  PERIPHERALS,
  SAND_CENTRE,
  SAND_ORIGIN,
  SHALLOW_ORIGIN,
  TILE,
  WALLS,
  type Blob,
  type Decor,
} from './arena.ts';
import type { GameAssets } from './assets.ts';
import type { ShipKind } from './config.ts';
import type { Ship, SimEvent, Simulation } from './simulation.ts';

/** Sail colour column in the ship sheet (white, black, red, green, blue, yellow). */
const SAIL: Record<ShipKind, number> = { player: 4, chaser: 2, shooter: 1 };
const BAR_SCALE = 0.4;
/** Ship sprites are 113 px long; bars float just above the hull at any heading. */
const barOffset = (spriteScale: number) => spriteScale * 62;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpAngle = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
const damageLevel = (hp: number, max: number) => (hp <= 0 ? 3 : hp / max > 2 / 3 ? 0 : hp / max > 1 / 3 ? 1 : 2);
/** White to deep-water blue as k goes 0 → 1: things fading into the sea. */
const sinkTint = (k: number) => (Math.round(255 - 185 * k) << 16) | (Math.round(255 - 115 * k) << 8) | Math.round(255 - 85 * k);
const STONE = 0xb4bcc6;

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
  /** Sinking hulls, wreckage and sailors: below the ships that may sail over them. */
  private readonly floatLayer = new Container();
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
  private readonly sim: Simulation;
  private readonly wallSprites: Sprite[];
  /** One container per peripheral island (shallows, sand, props), moved when the island resurfaces. */
  private readonly peripherals: Container[] = [];
  private readonly colliderOverlay: Graphics | null = null;
  /** Whole-block textures cut from the tile atlas (freed on destroy; the atlas itself stays cached). */
  private readonly blocks: Texture[] = [];

  constructor(assets: GameAssets, sim: Simulation, debug = false) {
    this.assets = assets;
    this.sim = sim;
    this.wallSprites = WALLS.map((w) => {
      const s = new Sprite(this.tile(w.frame));
      s.position.set(w.x, w.y);
      return s;
    });
    this.world.addChild(this.buildMap(), ...this.wallSprites, this.trails, this.floatLayer, this.shipLayer, this.ballLayer, this.effectLayer, this.barLayer);
    if (debug) {
      this.colliderOverlay = new Graphics();
      this.world.addChild(this.colliderOverlay);
      this.drawColliders();
    }
  }

  /**
   * Fits the match bounds inside the canvas. They are sized to the screen when the match starts, so
   * this only leaves a margin (of more sea) if the window changes shape mid-match.
   */
  layout(width: number, height: number): void {
    const { x0, y0, x1, y1 } = this.sim.bounds;
    const scale = Math.min(width / (x1 - x0), height / (y1 - y0));
    this.world.scale.set(scale);
    this.world.position.set((width - (x1 - x0) * scale) / 2 - x0 * scale, (height - (y1 - y0) * scale) / 2 - y0 * scale);
  }

  private tile(frame: number): Texture {
    return this.assets.tiles.textures[frame];
  }

  private ship(name: string): Texture {
    return this.assets.ships.textures[name];
  }

  private buildMap(): Container {
    const map = new Container();
    const { x0, y0, x1, y1 } = this.sim.bounds;
    const sea = 2048; // water well past the bounds: no bars if the window changes shape mid-match
    map.addChild(new TilingSprite({ texture: this.assets.water, x: x0 - sea, y: y0 - sea, width: x1 - x0 + 2 * sea, height: y1 - y0 + 2 * sea, tileScale: { x: 0.5, y: 0.5 } }));
    map.addChild(this.island(CENTRAL, CENTRAL_DECOR));
    PERIPHERALS.forEach((p, i) => {
      const node = this.island([{ x: 0, y: 0, w: p.w, h: p.h }], p.decor);
      const { x, y } = this.sim.peripheral(i);
      node.position.set(x, y);
      this.peripherals.push(node);
      map.addChild(node);
    });
    return map;
  }

  /**
   * Each blob is one sprite of the whole sand block (no seams between its tiles) over a nine-slice of
   * the translucent shallow-water block. Where blobs overlap, the plain centre tile is stretched over
   * their insides so no shoreline shows in the middle of the island.
   */
  private island(blobs: Blob[], decor: Decor[]): Container {
    const node = new Container();
    const halo = this.block(SHALLOW_ORIGIN, 3);
    const sand = this.block(SAND_ORIGIN, 3);
    const size = 3 * TILE;
    // Overlapping halos are merged with 'max' in their own cached layer, so the translucent
    // shallows do not stack up into brighter patches where blobs meet.
    const shallows = new Container();
    for (const b of blobs) {
      const k = Math.min(b.w, b.h) / size;
      const m = TILE * k;
      const shallow = new NineSliceSprite({ texture: halo, leftWidth: TILE, topHeight: TILE, rightWidth: TILE, bottomHeight: TILE, width: (b.w + 2 * m) / k, height: (b.h + 2 * m) / k });
      shallow.position.set(b.x - m, b.y - m);
      shallow.scale.set(k);
      if (blobs.length > 1) shallow.blendMode = 'max';
      shallows.addChild(shallow);
    }
    if (blobs.length > 1) shallows.cacheAsTexture(true);
    node.addChild(shallows);
    const rect = (texture: Texture, x: number, y: number, w: number, h: number) => {
      const s = new Sprite(texture);
      s.position.set(x, y);
      s.setSize(w, h);
      node.addChild(s);
    };
    for (const b of blobs) rect(sand, b.x, b.y, b.w, b.h);
    if (blobs.length > 1) {
      for (const b of blobs) {
        const ix = (40 * b.w) / size;
        const iy = (40 * b.h) / size;
        rect(this.tile(SAND_CENTRE), b.x + ix, b.y + iy, b.w - 2 * ix, b.h - 2 * iy);
      }
    }
    for (const d of decor) {
      const s = new Sprite(d.tile === undefined ? this.ship(d.ship ?? '') : this.tile(d.tile));
      s.anchor.set(0.5);
      s.position.set(d.x, d.y);
      s.scale.set(d.scale ?? 1);
      s.rotation = d.rot ?? 0;
      node.addChild(s);
    }
    return node;
  }

  /** Texture covering a size x size block of the tile sheet starting at tile `origin`. */
  private block(origin: number, size: number): Texture {
    const t = this.tile(origin);
    const texture = new Texture({ source: t.source, frame: new Rectangle(t.frame.x, t.frame.y, size * TILE, size * TILE) });
    this.blocks.push(texture);
    return texture;
  }

  private drawColliders(): void {
    const g = this.colliderOverlay;
    if (!g) return;
    g.clear();
    for (const c of this.sim.colliders) g.roundRect(c.cx - c.hw, c.cy - c.hh, c.hw * 2, c.hh * 2, c.r);
    for (const w of WALLS) g.rect(w.x0, w.y0, w.x1 - w.x0, w.y1 - w.y0);
    g.fill({ color: 0xff0044, alpha: 0.3 });
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
    this.floatLayer.addChild(v.body);
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

  private debris(x: number, y: number, count: number, tint = 0xffffff): void {
    for (let i = 0; i < count; i++) {
      const s = this.sprite(`wood_${1 + Math.floor(Math.random() * 4)}`, x, y, 0.7);
      s.tint = tint;
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

  /** Planks, the crow's nest and a cannon drift apart and slowly go under. */
  private wreckage(x: number, y: number): void {
    for (const frame of ['wood_1', 'wood_2', 'wood_3', 'wood_4', 'wood_2', 'nest', 'cannon_loose']) {
      if (Math.random() < 0.25) continue;
      const a = Math.random() * Math.PI * 2;
      const s = this.sprite(frame, x + Math.cos(a) * 10, y + Math.sin(a) * 10, 0.85);
      s.rotation = Math.random() * Math.PI * 2;
      const speed = 12 + Math.random() * 22;
      const spin = (Math.random() - 0.5) * 1.2;
      this.floatLayer.addChild(s);
      this.addEffect(s, 4 + Math.random() * 2.5, (k, dt) => {
        const nx = s.x + Math.cos(a) * speed * dt * (1 - k);
        const ny = s.y + Math.sin(a) * speed * dt * (1 - k);
        if (this.sim.obstacleDistance(nx, ny) > 4) s.position.set(nx, ny); // washes up at the shore, never drifts onto sand
        s.rotation += spin * dt * (1 - k);
        s.scale.set(0.85 * (1 - 0.3 * k));
        s.tint = sinkTint(k);
        s.alpha = k < 0.45 ? 1 : 1 - (k - 0.45) / 0.55;
      });
    }
  }

  /** 1–2 sailors fall overboard and go under; the ripple ring around each closes as they sink. */
  private sailors(x: number, y: number): void {
    for (let i = 1 + Math.floor(Math.random() * 2); i > 0; i--) {
      // just outside the explosion, in the water (a few tries near the shore, else at the wreck)
      const d = 40 + Math.random() * 18;
      const spot = Array.from({ length: 6 }, () => Math.random() * Math.PI * 2)
        .map((a) => ({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d }))
        .find((p) => this.sim.obstacleDistance(p.x, p.y) > 10) ?? { x, y };
      const node = new Container();
      node.position.set(spot.x, spot.y);
      const ring = new Graphics().circle(0, 0, 10).stroke({ width: 2, color: 0xffffff });
      const body = this.sprite(`crew_${1 + Math.floor(Math.random() * 6)}`, 0, 0, 1.1);
      body.rotation = Math.random() * Math.PI * 2;
      const spin = (Math.random() - 0.5) * 1.5;
      node.addChild(ring, body);
      this.floatLayer.addChild(node);
      this.addEffect(node, 3.2, (k, dt) => {
        body.rotation += spin * dt;
        body.scale.set(1.1 * (1 - 0.55 * k));
        body.tint = sinkTint(k);
        body.alpha = k < 0.4 ? 1 : 1 - (k - 0.4) / 0.6;
        const open = Math.max(0, 1 - k / 0.75); // the ring closes faster than the body fades
        ring.scale.set(0.6 + 1.6 * open);
        ring.alpha = 0.9 * open;
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
        case 'wall-hit': {
          this.explosion(e.x, e.y, 0.4);
          this.debris(e.x, e.y, e.broken ? 5 : 2, STONE);
          this.ring(e.x, e.y, 4, e.broken ? 30 : 12, 0.5, 2);
          const broken = WALLS[e.wall].broken;
          if (e.broken && broken !== null) this.wallSprites[e.wall].texture = this.tile(broken);
          break;
        }
        case 'island-moved': {
          // goes under in a swirl of foam and rises at its new spot
          const node = this.peripherals[e.island];
          const { w, h } = PERIPHERALS[e.island];
          this.ring(node.x + w / 2, node.y + h / 2, 30, w * 0.8, 1, 4);
          node.position.set(e.x, e.y);
          this.ring(e.x + w / 2, e.y + h / 2, w * 0.8, 30, 1, 4);
          this.addEffect(new Container(), 1, (k) => {
            node.alpha = k;
          });
          this.drawColliders();
          break;
        }
        case 'destroyed': {
          const v = this.ships.get(e.shipId);
          if (v) this.removeShip(e.shipId, v, true);
          this.explosion(e.x, e.y, e.cause === 'ram' ? 1.2 : 1);
          this.wreckage(e.x, e.y);
          this.sailors(e.x, e.y);
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
    for (const t of this.blocks) t.destroy(false);
    this.ships.clear();
    this.effects = [];
    this.world.destroy({ children: true });
  }
}
