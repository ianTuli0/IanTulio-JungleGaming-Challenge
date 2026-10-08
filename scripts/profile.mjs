// Profiling harness for PERFORMANCE.md. Drives a real Chrome through the DevTools protocol (no extra deps).
//
//   npm run build && npm run preview          # in one terminal
//   npm run profile                           # in another (CHROME_PATH=... if Chrome is elsewhere)
//   VIEW=1920x1080x2 SPAWN=1 MODE=frames npm run profile   # stress variant (4K canvas, 1 s spawns)
//
// 1. Plays 180 s matches back to back (scripted bot, real keyboard events) until 180 s of combat were
//    recorded, and prints the ?perf report of each match plus an aggregate.
// 2. Runs five (CYCLES) cycles of start -> play 20 s -> leave, sampling JS heap / DOM nodes / listeners after GC.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ARENA_HEIGHT, ARENA_WIDTH } from '../src/game/arena.ts';

const BASE = process.env.BASE ?? 'http://localhost:4173/';
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const [WIDTH, HEIGHT, DPR] = (process.env.VIEW ?? '1920x1080x1').split('x').map(Number);
const SPAWN = Number(process.env.SPAWN ?? 3);
const MODE = process.env.MODE ?? 'all'; // frames | memory | all
const CYCLES = Number(process.env.CYCLES ?? 5);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// -- minimal CDP client -------------------------------------------------------------------
const port = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(CHROME, [
  ...(process.env.HEADFUL ? [] : ['--headless=new']),
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'pb-profile-'))}`,
  '--no-first-run',
  '--no-default-browser-check',
  'about:blank',
], { stdio: 'ignore' });
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  target = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).then((l) => l.find((t) => t.type === 'page')).catch(() => undefined);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let nextId = 1;
const pending = new Map();
const loaded = [];
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id) pending.get(msg.id)?.(msg);
  if (msg.method === 'Page.loadEventFired') loaded.splice(0).forEach((r) => r());
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, (msg) => (msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.text);
  return res.result.value;
};
const goto = async (url) => {
  const done = new Promise((r) => loaded.push(r));
  await send('Page.navigate', { url });
  await done;
  await sleep(1500);
};
const click = async (text) => {
  const pos = await evaluate(`(() => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().toLowerCase() === ${JSON.stringify(text.toLowerCase())});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (!pos) return false;
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...pos, button: 'left', clickCount: 1 });
  return true;
};
const key = (code, type) => send('Input.dispatchKeyEvent', { type, code, key: code, windowsVirtualKeyCode: code === 'Escape' ? 27 : 0 });

// -- in-page bot: frame-accurate, plays with keyboard events on window ---------------------
const pageBot = (W, H) => {
  let islands = []; // read from the game every frame: peripheral islands move
  let b = { x0: 0, y0: 0, x1: W, y1: H }; // the arena is sized to the screen
  const sdf = (x, y) => {
    let d = Infinity;
    for (const o of islands) {
      const qx = Math.abs(x - o.cx) - o.hw + o.r;
      const qy = Math.abs(y - o.cy) - o.hh + o.r;
      d = Math.min(d, Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - o.r);
    }
    return d;
  };
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const clearance = (x, y, h) => {
    let c = Infinity;
    for (const d of [35, 70, 110, 150]) {
      const px = x + Math.cos(h) * d;
      const py = y + Math.sin(h) * d;
      c = Math.min(c, sdf(px, py), px - b.x0, py - b.y0, b.x1 - px, b.y1 - py);
    }
    return c;
  };
  const decide = (s) => {
    const p = s.player;
    const near = s.enemies.map((e) => ({ e, d: Math.hypot(e.x - p.x, e.y - p.y), a: Math.atan2(e.y - p.y, e.x - p.x) }));
    const chaser = near.filter((n) => n.e.kind === 'chaser' && n.d < 440).sort((x, y) => x.d - y.d)[0];
    const shooter = near.filter((n) => n.e.kind === 'shooter').sort((x, y) => x.d - y.d)[0];
    let desired;
    if (chaser && Math.abs(wrap(chaser.a - p.angle)) > 1.8 && chaser.d < 260) desired = chaser.a + Math.PI; // outrun it
    else if (chaser) desired = chaser.a; // one bow shot sinks it
    else if (shooter) {
      const side = wrap(shooter.a - p.angle) > 0 ? 1 : -1; // orbit with the shooter abeam
      desired = shooter.a - side * (Math.PI / 2 - (shooter.d > 270 ? 0.45 : shooter.d < 190 ? -0.45 : 0));
    } else desired = Math.atan2(H / 2 - p.y, W / 2 - p.x);
    let target = desired;
    if (clearance(p.x, p.y, desired) < 28) {
      let best = null;
      for (let k = -12; k <= 12; k++) {
        const h = desired + k * 0.26;
        const score = (clearance(p.x, p.y, h) >= 28 ? 0 : -10) + Math.cos(wrap(h - desired)) - Math.abs(wrap(h - p.angle)) * 0.05;
        if (!best || score > best.score) best = { h, score };
      }
      target = best.h;
    }
    const diff = wrap(target - p.angle);
    const aimed = (dir, range, tol) => near.some((n) => n.d < range && Math.abs(wrap(n.a - dir)) < tol);
    return {
      KeyA: diff < -0.02,
      KeyD: diff > 0.02,
      Space: aimed(p.angle, 460, 0.12),
      KeyQ: aimed(p.angle - Math.PI / 2, 330, 0.3),
      KeyE: aimed(p.angle + Math.PI / 2, 330, 0.3),
    };
  };
  const held = new Set();
  const hold = (code, on) => {
    if (on === held.has(code)) return;
    if (on) held.add(code);
    else held.delete(code);
    window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code }));
  };
  let seen = false;
  const frame = () => {
    const handle = window.__pirateBattle;
    if (!handle) return seen ? undefined : requestAnimationFrame(frame); // match left: stop
    seen = true;
    const s = handle.state();
    islands = s.islands;
    b = s.bounds;
    if (s.status !== 'running') return [...held].forEach((c) => hold(c, false));
    if (s.paused) held.clear(); // the game drops held keys on pause
    else {
      hold('KeyW', true);
      for (const [code, on] of Object.entries(decide(s))) hold(code, on);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
};

async function startMatch() {
  for (let i = 0; i < 40; i++) {
    if (await evaluate('!!window.__pirateBattle')) {
      await evaluate(`(${pageBot})(${ARENA_WIDTH}, ${ARENA_HEIGHT})`);
      return;
    }
    const hash = await evaluate('location.hash');
    if (hash === '#/result') await click('Continuar'); // skip the optional ranking name
    if (hash !== '#/play') await click(hash === '#/result' ? 'Jogar Novamente' : 'Jogar');
    await sleep(500);
  }
  throw new Error('the match did not start');
}

const state = () => evaluate('window.__pirateBattle?.state()');

async function heapSample(label) {
  await send('HeapProfiler.collectGarbage');
  await sleep(400);
  await send('HeapProfiler.collectGarbage');
  const m = Object.fromEntries((await send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  const row = {
    label,
    heapMB: Math.round((m.JSHeapUsedSize / 1048576) * 100) / 100,
    domNodes: m.Nodes,
    listeners: m.JSEventListeners,
    canvases: await evaluate('document.querySelectorAll("canvas").length'),
  };
  console.log(JSON.stringify(row));
}

try {
  await send('Page.enable');
  await send('Performance.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: DPR, mobile: false });
  await goto(BASE);
  await evaluate(`localStorage.clear(); localStorage.setItem('pirate-battle:settings', '{"sessionSeconds":180,"spawnIntervalSeconds":' + ${SPAWN} + ',"soundEnabled":true}')`);
  console.log('ENV', JSON.stringify(await evaluate(`(() => { const gl = document.createElement('canvas').getContext('webgl2'); const ext = gl.getExtension('WEBGL_debug_renderer_info'); return { gpu: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL), browser: navigator.userAgent.match(/Chrome\\/[\\d.]+/)[0], viewport: innerWidth + 'x' + innerHeight, dpr: devicePixelRatio }; })()`)));

  // 1) frame statistics over >= 180 s of combat (180 s matches, back to back, random seeds)
  if (MODE !== 'memory') await goto(`${BASE}?perf`);
  const reports = [];
  while (MODE !== 'memory' && reports.reduce((s, r) => s + r.seconds, 0) < 180 && reports.length < 12) {
    await startMatch();
    let peakEnemies = 0;
    let peakBalls = 0;
    for (let s = await state(); s?.status === 'running'; s = await state()) {
      peakEnemies = Math.max(peakEnemies, s.enemies.length);
      peakBalls = Math.max(peakBalls, s.projectiles);
      await sleep(500);
    }
    await sleep(2600); // result screen
    const report = await evaluate('window.__pirateBattlePerf.at(-1)');
    reports.push({ ...report, peakEnemies, peakBalls });
    console.log('MATCH', JSON.stringify(reports.at(-1)));
  }
  const frames = reports.reduce((s, r) => s + r.frames, 0);
  const seconds = reports.reduce((s, r) => s + r.seconds, 0);
  if (frames) {
    console.log('AGGREGATE', JSON.stringify({
      matches: reports.length,
      seconds: Math.round(seconds * 10) / 10,
      avgFps: Math.round((frames / seconds) * 10) / 10,
      worstP95FrameMs: Math.max(...reports.map((r) => r.p95FrameMs)),
      worstP99FrameMs: Math.max(...reports.map((r) => r.p99FrameMs)),
      maxFrameMs: Math.max(...reports.map((r) => r.maxFrameMs)),
      avgEntities: Math.round((reports.reduce((s, r) => s + r.avgEntities * r.frames, 0) / frames) * 10) / 10,
      peakEntities: Math.max(...reports.map((r) => r.peakEntities)),
      peakEffects: Math.max(...reports.map((r) => r.peakEffects)),
    }));
  }

  // 2) memory over five start -> play -> leave cycles
  if (MODE !== 'frames') {
    await goto(`${BASE}?perf&seed=5`);
    await heapSample('menu, before the first match');
    for (let cycle = 1; cycle <= CYCLES; cycle++) {
      await startMatch();
      await sleep(20000);
      const s = await state();
      await key('Escape', 'keyDown');
      await key('Escape', 'keyUp');
      await sleep(500);
      await click('Menu Principal');
      await sleep(1000);
      await heapSample(`after cycle ${cycle} (${Math.round(s?.elapsed ?? 0)} s played, ${s?.enemies.length ?? 0} enemies alive)`);
    }
  }
} finally {
  ws.close();
  chrome.kill();
}
