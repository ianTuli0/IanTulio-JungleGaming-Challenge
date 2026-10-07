// Headless rule checks: `npm run test:unit`. Plain asserts, no framework.
import assert from 'node:assert/strict';
import { ARENA_HEIGHT, ARENA_WIDTH, obstacleDistance } from './arena.ts';
import { GAME_CONFIG, createMatchConfig, type GameConfig } from './config.ts';
import { Simulation, type InputState, type SimEvent } from './simulation.ts';

const DT = 1 / 60;
const idle: InputState = { forward: false, turnLeft: false, turnRight: false, fireFront: false, fireLeft: false, fireRight: false };
const noSpawns: GameConfig = { ...GAME_CONFIG, spawn: { ...GAME_CONFIG.spawn, firstSpawnDelaySeconds: 1e9 } };

function quietSim(sessionSeconds = 120): Simulation {
  return new Simulation(createMatchConfig({ sessionSeconds, spawnIntervalSeconds: 1e9 }, noSpawns), 1);
}

function run(sim: Simulation, seconds: number, input: Partial<InputState> = {}): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    sim.step(DT, { ...idle, ...input });
    events.push(...sim.drainEvents());
  }
  return events;
}

function check(name: string, fn: () => void): void {
  fn();
  console.log(`ok - ${name}`);
}

check('sails forward and rotates both ways', () => {
  const sim = quietSim();
  const { x: x0, y: y0, angle: a0 } = sim.player;
  run(sim, 0.25, { turnRight: true });
  assert.ok(sim.player.angle > a0);
  run(sim, 0.5, { turnLeft: true });
  assert.ok(sim.player.angle < a0);
  assert.deepEqual([sim.player.x, sim.player.y], [x0, y0], 'turning in place does not move');
  const heading = sim.player.angle;
  run(sim, 1, { forward: true });
  const moved = Math.hypot(sim.player.x - x0, sim.player.y - y0);
  assert.ok(moved > 50, 'sailed forward');
  assert.ok(Math.abs(Math.atan2(sim.player.y - y0, sim.player.x - x0) - heading) < 1e-6, 'along its heading');
});

check('islands and arena edges block the hull', () => {
  const sim = quietSim();
  run(sim, 15, { forward: true }); // straight into the island north of the start
  const { radius, halfLength } = GAME_CONFIG.player.hull;
  const p = sim.player;
  for (const k of [-1, 0, 1]) {
    const x = p.x + Math.cos(p.angle) * halfLength * k;
    const y = p.y + Math.sin(p.angle) * halfLength * k;
    assert.ok(obstacleDistance(x, y) >= radius - 0.5, 'hull never enters an island');
  }
  p.angle = Math.PI; // west, open water up to the arena edge
  run(sim, 20, { forward: true });
  assert.ok(p.x - halfLength >= radius - 0.5 && p.x < ARENA_WIDTH && p.y > 0 && p.y < ARENA_HEIGHT, 'stays inside the arena');
});

check('front cannon respects its cooldown', () => {
  const sim = quietSim();
  const shots = run(sim, 1, { fireFront: true }).filter((e) => e.type === 'shot');
  assert.equal(shots.length, Math.ceil(1 / GAME_CONFIG.player.front.cooldown));
});

check('broadside fires three parallel balls per side', () => {
  const sim = quietSim();
  sim.step(DT, { ...idle, fireLeft: true });
  assert.equal(sim.projectiles.length, GAME_CONFIG.player.broadside.count);
  const [a, b] = sim.projectiles;
  assert.ok(Math.abs(a.vx - b.vx) < 1e-9 && Math.abs(a.vy - b.vy) < 1e-9, 'same velocity');
  run(sim, 0.5, { fireLeft: true });
  assert.equal(sim.projectiles.filter((p) => p.owner === 'player').length, 3, 'cooldown blocks a second volley');
});

check('islands stop balls, open water sinks them at max range', () => {
  const sim = quietSim();
  const north = run(sim, 1.2, { fireFront: true }).filter((e) => e.type === 'obstacle-hit');
  assert.ok(north.length > 0, 'island north of the start absorbs the ball');
  const sim2 = quietSim();
  Object.assign(sim2.player, { x: 640, y: 720, angle: 0 }); // open water along the south edge
  sim2.step(DT, { ...idle, fireFront: true });
  const events = run(sim2, 1.5);
  assert.ok(events.some((e) => e.type === 'splash') && !events.some((e) => e.type === 'obstacle-hit'));
  assert.equal(sim2.projectiles.length, 0);
});

check('each ball damages once and a kill scores exactly one point', () => {
  const sim = quietSim();
  const enemy = sim.addEnemy('shooter', sim.player.x - 220, sim.player.y, 0);
  sim.player.angle = Math.PI;
  sim.step(DT, { ...idle, fireFront: true });
  run(sim, 0.35);
  assert.equal(enemy.hp, GAME_CONFIG.shooter.maxHp - GAME_CONFIG.player.front.damage);
  run(sim, 3, { fireFront: true });
  assert.equal(enemy.alive, false);
  assert.equal(sim.score, 1);
  run(sim, 1, { fireFront: true });
  assert.equal(sim.score, 1, 'no double counting');
  assert.equal(sim.enemies.length, 0, 'wrecks leave the simulation');
});

check('chaser rams: damages the player, explodes, does not score', () => {
  const sim = quietSim();
  sim.addEnemy('chaser', sim.player.x + 150, sim.player.y, Math.PI);
  const events = run(sim, 3);
  assert.equal(sim.player.hp, GAME_CONFIG.player.maxHp - GAME_CONFIG.chaser.ramDamage);
  assert.equal(sim.score, 0);
  assert.ok(events.some((e) => e.type === 'destroyed' && e.cause === 'ram'));
  assert.equal(sim.enemies.length, 0);
});

check('shooter closes in and opens fire', () => {
  const sim = quietSim();
  sim.addEnemy('shooter', sim.player.x - 450, sim.player.y, 0);
  const events = run(sim, 8);
  assert.ok(events.some((e) => e.type === 'shot' && e.owner === 'enemy'));
  assert.ok(sim.player.hp < GAME_CONFIG.player.maxHp);
});

check('balls fired by a sunk enemy go down with it', () => {
  const sim = quietSim();
  const shooter = sim.addEnemy('shooter', sim.player.x - 200, sim.player.y, 0);
  for (let i = 0; i < 300 && !sim.projectiles.some((p) => p.owner === 'enemy'); i++) sim.step(DT, idle);
  assert.ok(sim.projectiles.some((p) => p.owner === 'enemy'), 'the shooter fired');
  shooter.alive = false;
  sim.step(DT, idle);
  assert.equal(sim.projectiles.filter((p) => p.owner === 'enemy').length, 0);
  assert.equal(sim.player.hp, GAME_CONFIG.player.maxHp);
});

check('spawns follow the interval, mix both kinds and keep their distance', () => {
  const sim = new Simulation(createMatchConfig({ sessionSeconds: 60, spawnIntervalSeconds: 1 }), 7);
  const kinds: string[] = [];
  for (let i = 0; i < 600; i++) {
    sim.step(DT, idle);
    for (const e of sim.drainEvents()) {
      if (e.type !== 'spawn') continue;
      kinds.push(e.kind);
      const ship = sim.enemies.find((s) => s.id === e.shipId)!;
      assert.ok(Math.hypot(ship.x - sim.player.x, ship.y - sim.player.y) >= GAME_CONFIG.spawn.minPlayerDistance);
      assert.ok(obstacleDistance(ship.x, ship.y) > ship.motion.hull.radius + ship.motion.hull.halfLength);
    }
  }
  assert.deepEqual(kinds.slice(0, 2), ['chaser', 'shooter']);
  assert.ok(kinds.length >= 9 && kinds.length <= 10, `10s at 1s interval -> ${kinds.length} spawns`);
});

check('time up ends the match and freezes everything', () => {
  const sim = quietSim(60);
  const events = run(sim, 61, { forward: true, turnLeft: true });
  assert.equal(sim.status, 'ended');
  assert.equal(sim.endReason, 'time-up');
  assert.equal(sim.elapsed, 60);
  assert.equal(events.filter((e) => e.type === 'ended').length, 1);
  const { x, y } = sim.player;
  run(sim, 1, { forward: true, fireFront: true });
  assert.deepEqual([sim.player.x, sim.player.y, sim.projectiles.length], [x, y, 0]);
});

check('death ends the match', () => {
  const sim = quietSim();
  sim.player.hp = 5;
  sim.addEnemy('chaser', sim.player.x + 120, sim.player.y, Math.PI);
  run(sim, 3);
  assert.equal(sim.status, 'ended');
  assert.equal(sim.endReason, 'destroyed');
  assert.equal(sim.player.hp, 0);
});

check('same seed + same inputs = same match', () => {
  const play = () => {
    const sim = new Simulation(createMatchConfig({ sessionSeconds: 60, spawnIntervalSeconds: 1.5 }), 42);
    run(sim, 20, { forward: true, turnLeft: true, fireFront: true, fireRight: true });
    return JSON.stringify([sim.score, sim.player.hp, sim.player.x, sim.enemies.map((e) => [e.kind, e.x, e.y])]);
  };
  assert.equal(play(), play());
});
