# Performance

Target: 60 FPS during combat in the optimized build. Raw outputs are in [`profiling/`](profiling/); they are
reproducible with `npm run profile` (see [How to reproduce](#how-to-reproduce)).

## Summary

{{SUMMARY}}

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
- **Three minutes of combat.** The bot sinks after 30–80 s, so matches (180 s configuration) are chained
  with *Play Again* until at least 180 s of combat are recorded. Every match builds and tears down its
  own Pixi application, so this also exercises the full lifecycle.
- **Memory.** The script runs cycles of Play → 20 s of combat → Pause → Main Menu. After each cycle it
  forces garbage collection twice, then reads the JS heap, DOM nodes and event listeners
  (`Performance.getMetrics`) and counts the `<canvas>` elements left in the page.
- **Leak investigation.** Heap snapshots after 2 and after 5 cycles, taken on the development build so
  class names are readable, are compared per constructor and per V8 node type
  ([`profiling/heap-snapshot-diff.txt`](profiling/heap-snapshot-diff.txt)).

{{RESULTS}}

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
