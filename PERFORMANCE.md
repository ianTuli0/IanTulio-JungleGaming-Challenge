# Performance

Target: 60 FPS during combat in the optimized build. Raw outputs are in [`profiling/`](profiling/); they are
reproducible with `npm run profile` (see [How to reproduce](#how-to-reproduce)).

## Summary

| Metric | Reference (1080p, 3 s spawns) | Stress (4K canvas, 1 s spawns) |
| --- | --- | --- |
| Combat recorded | 201.6 s over 3 matches | 186.4 s over 7 matches |
| Average frame rate | 143.9 FPS | 143.2 FPS |
| Frame interval p95 / p99 | 7.0 ms / 7.1 ms | 7.1 ms / 7.1 ms |
| Longest frame | 41.6 ms (match start) | 76.3 ms (match start) |
| Entities (player + enemies + balls), avg / peak | 4.3 / 13 | 8.3 / 20 |
| Effects alive, peak | 49 | 68 |
| JS heap after 5 start/play/leave cycles | 9.23 → 9.62 MB, DOM and listeners flat | n/a |

**Verdict:** the 60 FPS target (16.7 ms per frame) is met with a wide margin. 99% of combat frames take
about 7 ms, both at 1080p and with a 3840 x 2160 canvas at three times the spawn rate. Nothing a match
owns survives leaving it.

## Reference environment

| Item | Value |
| --- | --- |
| CPU | Intel Core i3-9100F (4 cores, 3.6 GHz) |
| GPU | AMD Radeon RX 580 2048SP (WebGL 2 through ANGLE / Direct3D 11) |
| RAM | 16 GB |
| OS | Windows 10 Pro 22H2 (build 19045) |
| Browser | Chrome 154, new headless mode (GPU accelerated, same rendering stack as desktop Chrome) |
| Build | `npm run build`, served by `npm run preview` |
| Reference run | 1920 x 1080 viewport, device pixel ratio 1 (1920 x 1080 canvas), 1x atlases |
| Stress run | 1920 x 1080 viewport, device pixel ratio 2 (3840 x 2160 canvas), 2x atlases |
| Match settings | 180 s session; 3 s spawn interval (reference) or 1 s (stress); sound on |

## Method

- **What is measured.** `?perf` turns on `PerfMonitor` (`src/game/perf.ts`). For every rendered frame of
  active play (paused frames excluded) it records:
  - the frame interval (Pixi ticker `deltaMS`);
  - the number of simulated entities: player + enemies + cannonballs;
  - the number of live effects: explosions, debris, splash rings, muzzle flashes, sinking wrecks.

  At the end of a match it reports the average FPS, the p95/p99/max frame interval and the
  average/peak entity counts.
- **Who plays.** `scripts/profile.mjs` launches Chrome and drives it over the DevTools protocol, with no
  dependencies. A scripted bot plays through the game's own keyboard handler: it shoots Chasers head-on,
  keeps Shooters abeam for broadsides and steers around islands.
- **Three minutes of combat.** The bot sinks after 20–90 s, so matches (180 s configuration) are chained
  with *Play Again* until at least 180 s of combat are recorded. Every match builds and tears down its
  own Pixi application, so this also exercises the full lifecycle.
- **Memory.** The script runs cycles of Play → 20 s of combat → Pause → Main Menu. After each cycle it
  forces garbage collection twice, then reads the JS heap, DOM nodes and event listeners
  (`Performance.getMetrics`) and counts the `<canvas>` elements left in the page.
- **Leak investigation.** Heap snapshots after 2 and after 5 cycles, taken on the development build so
  class names are readable, are compared per constructor and per V8 node type
  ([`profiling/heap-snapshot-diff.txt`](profiling/heap-snapshot-diff.txt)).

## Results

### Reference: 1080p, 180 s matches, 3 s spawns ([log](profiling/reference-1080p.log))

| Match | Combat | Avg FPS | p95 / p99 | Max frame | Entities avg / peak | Enemies peak | Balls peak | Effects peak |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 89.8 s | 143.8 | 7.0 / 7.1 ms | 41.6 ms | 3.8 / 13 | 5 | 4 | 39 |
| 2 | 33.8 s | 143.8 | 7.0 / 7.1 ms | 27.9 ms | 4.6 / 8 | 6 | 3 | 19 |
| 3 | 78.1 s | 143.9 | 7.0 / 7.1 ms | 20.8 ms | 4.7 / 12 | 7 | 5 | 49 |
| **All** | **201.6 s** | **143.9** | **7.0 / 7.1 ms** | **41.6 ms** | **4.3 / 13** | 7 | 5 | 49 |

### Stress: 4K canvas (DPR 2, 2x atlases), 180 s matches, 1 s spawns ([log](profiling/stress-4k-1s-spawn.log))

Seven matches, 186.4 s of combat: 143.2 FPS, p95 7.1 ms, p99 7.1 ms, longest frame 76.3 ms (the start of
the first match). The enemy cap (10) was reached in every match; peak 20 entities and 68 live effects.

### Memory

Five cycles, measured right after the reference run ([log](profiling/reference-1080p.log)):

| Sample | JS heap | DOM nodes | Listeners | Canvases |
| --- | --- | --- | --- | --- |
| Menu, before the first match | 8.25 MB | 305 | 356 | 0 |
| After cycle 1 | 9.23 MB | 310 | 357 | 0 |
| After cycle 2 | 9.35 MB | 310 | 358 | 0 |
| After cycle 3 | 9.46 MB | 310 | 358 | 0 |
| After cycle 4 | 9.53 MB | 310 | 358 | 0 |
| After cycle 5 | 9.62 MB | 310 | 358 | 0 |

Twelve cycles in a fresh browser ([log](profiling/memory-12-cycles.log)):

- The JS heap goes from 5.89 MB (cycle 1) to 7.38 MB (cycle 12). After the first three cycles the
  increments shrink to about 0.07 MB per cycle, with one 0.34 MB step at cycle 9.
- DOM nodes (201), listeners (187–189) and canvases (0) stay flat.

### Is the slow heap growth a leak?

Heap snapshots answer this ([profiling/heap-snapshot-diff.txt](profiling/heap-snapshot-diff.txt)):

- **No match object survives.** After leaving a match there are zero `GameController`, `Simulation`,
  `GameRenderer`, `InputController`, `Application`, `WebGLRenderer` and `Ticker` instances.
- **The texture count is flat.** It stays at 241 between cycles 2 and 5: these are the cached atlas
  frames, kept on purpose so the next match does not reload them.
- **Shader programs are reused, not recreated.** The `Shader` and `WebGLProgram` counts are constant.
- **The growth is mostly compiled code.** Plain JS objects grow by about 12 KB across three cycles. By
  V8 node type, compiled code (`InstructionStream`, feedback vectors) accounts for ~165 KB per cycle as
  V8 keeps optimizing the hot combat functions. A few tiny PixiJS global caches (one texture-batch
  `BindGroup` per match) and shader source strings make up the rest.

### Match start

The longest frames of every run happened when a match started, so they were investigated separately
(intervals recorded before and after the HUD appears, three matches in a row):

| Canvas | In-match max frame, before the fix | After the fix |
| --- | --- | --- |
| 1080p | 90 / 35 / 28 ms | 21 / 14 / 21 ms |
| 4K (DPR 2) | 222 / 132 / 104 ms | 83 / 42 / 49 ms |

**Cause:** each match creates a fresh WebGL context, and the first render uploads the atlases and
compiles shaders.

**Fix:** `GameController.init()` renders the scene once and waits two frames before revealing the HUD and
starting the clock, so that cost stays behind the loading panel. At 4K a few 40–80 ms frames remain in
the first quarter second, while the HUD paints for the first time. The match clock is clamped (100 ms per
frame at most), so they never skip gameplay.

## Observations and limitations

- **Frame pacing.** Headless Chrome is not locked to a display's vsync: it produced ~144 frames per
  second here. On a 60 Hz monitor the game runs at the display rate, and the relevant figure is the frame
  time: p99 ≈ 7 ms against a 16.7 ms budget.
- **One machine.** These figures come from a single desktop. No mobile device was available; on phones,
  the canvas resolution is capped at 2x and the 2x atlases are only used at DPR ≥ 1.5.
- **GPU memory.** Chrome does not expose it to scripts. Each match's WebGL context is explicitly lost
  on teardown (`WEBGL_lose_context`). In the cycle runs where the console was captured (heap-snapshot
  investigation), Chrome never warned about too many active WebGL contexts.
- **Bounded load.** Entity counts are bounded by design (at most 10 enemies alive), so the scene stays
  far below what PixiJS's batch renderer can handle. The stress run hits that cap the whole time.
- **Bot, not player.** The scripted bot plays through the same input path as a person, but it does not
  survive whole 180 s matches. Combat time is therefore aggregated over several matches of the 180 s
  configuration.

## How to reproduce

```bash
npm run build
npm run preview                                          # terminal 1
npm run profile                                          # terminal 2: reference run + 5 memory cycles
VIEW=1920x1080x2 SPAWN=1 MODE=frames npm run profile     # stress run
MODE=memory CYCLES=12 npm run profile                    # longer memory trend
```

`CHROME_PATH` selects another Chrome or Chromium binary; `HEADFUL=1` shows the window. The in-game overlay
(`?perf`) shows the same numbers live while you play by hand.
