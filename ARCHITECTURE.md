# Architecture

Pirate Battle is a single-page app. React renders menus, forms, panels, dialogs and the HUD; PixiJS renders
the arena, ships, projectiles, effects and the bars above the ships. Game rules live in plain TypeScript
with no Pixi or DOM dependency.

```
src/
├── main.tsx               boot: start the MSW worker, then render <App/> in StrictMode
├── App.tsx                hash routes, pending-save sync, texture preloading
├── store.ts               tiny observable store + useStore() + crash-proof localStorage
├── settings.ts            validated options, player identity, last completed match
├── rng.ts                 seeded PRNG (simulation and mocks)
├── game/
│   ├── config.ts          typed gameplay configuration, per-match snapshot, options validation
│   ├── arena.ts           map layout and colliders (signed distance field)
│   ├── simulation.ts      rules: movement, AI, combat, spawns, end of match
│   ├── simulation.check.ts  headless rule checks (npm run test:unit)
│   ├── controller.ts      one match: Pixi app, ticker, fixed step, pause, HUD store
│   ├── renderer.ts        Pixi scene graph, interpolation, effects
│   ├── input.ts           keyboard + touch -> InputState
│   ├── stick.ts           floating-stick direction -> movement controls
│   ├── assets.ts          atlas loading with progress, retry and texture reuse
│   ├── audio.ts           Web Audio playback
│   └── perf.ts            opt-in frame statistics (?perf)
├── api/                   contracts, Axios client, TanStack Query layer
├── mocks/                 MSW handlers, fixtures, network scenarios
└── ui/                    React screens and UI kit
```

## React and PixiJS

`ui/GameScreen.tsx` owns a host `<div>`. Its effect loads the assets, creates a `GameController`, awaits
`controller.init()` and only then stores the controller in React state. Two rules keep this correct under
React Strict Mode (mount, unmount, mount again in development):

- The effect keeps a `cancelled` flag. A promise that resolves after cleanup does nothing.
- `controller.destroy()` can run before `init()` resolves. `init()` checks `disposed` after awaiting
  `app.init()` and destroys the fresh application itself. Each mount owns exactly one `Application`.

The HUD is the only channel from the game to React. The controller writes a `HudState` snapshot into a
store that React reads with `useSyncExternalStore`. The snapshot object is only replaced when a displayed
value changes: health, score, whole seconds left, phase, or the screen-reader announcement. React therefore
renders at most once per second for the clock, plus once per hit, kill or state change. It never renders
per frame. In the other direction React calls `pause()`, `resume()` and `input.setTouch()`.

Continuous state (positions, velocities, cooldowns, timers) exists only in the simulation.

## Simulation loop

- **Fixed step.** `controller.tick` adds the frame time to an accumulator and advances the simulation in
  1/60 s steps. Movement, damage, cooldowns, spawns and the match clock all use simulation time, so a
  30 Hz or a 144 Hz display plays the same match. The frame delta is clamped to 100 ms, so a stalled tab
  never fast-forwards the battle.
- **Interpolation.** Ships and balls keep their previous pose. The renderer draws
  `lerp(previous, current, accumulator / step)`, which keeps motion smooth on displays faster than 60 Hz.
- **Events.** `step()` pushes `SimEvent`s (shot, hit, splash, wall-hit, island-moved, destroyed, spawn,
  score, ended). Each frame the controller drains them into the renderer (effects), the audio player and
  the end-of-match hand-off. The simulation never calls out.
- **Determinism.** Randomness comes from a seeded PRNG. The same seed and the same inputs replay the same
  match; `simulation.check.ts` asserts this. `?seed=<n>` fixes the seed in the browser.
- **End of match.** Time up or zero health switches `status` to `ended`. From then on `step()` returns
  immediately: no movement, attacks, damage, spawns or score. Effects keep animating for 1.8 s before the
  result screen.
- **Pause.** Manual (button, Esc, P), on `window` blur, on `visibilitychange`, and on mobile portrait.
  While paused the ticker keeps rendering, but simulation and effects receive no time. Pausing and
  resuming both clear the held keys and fingers and reset the accumulator, so nothing pressed or elapsed
  during the pause carries over. Resuming always needs an explicit action (Resume, or Esc in the dialog).

## Collisions

- **Islands.** Each sand block is a rounded rectangle fitted to its sand edge (stretched together with the
  block); the cross-shaped central island is the union of four overlapping blocks plus a rectangle for the
  jetty. `sim.obstacleDistance(x, y)` returns the signed distance to the nearest island and applies to
  ships only: cannonballs fly over islands. `?debug` draws the colliders over the map.
- **Edge islands.** The two peripheral islands occupy two of the six `ISLAND_SLOTS` (the four corners and
  the middle of the sides). Every `ISLAND_SHIFT_SECONDS` (30 s) `shiftIslands()` draws, with the match
  PRNG, a free slot for each one, discarding any that would touch a ship's hull; if none is free, the
  island stays put until the next shift. Colliders and the navigation grid are rebuilt on the spot, and
  spawn points are filtered by the islands at the moment of each spawn.
- **Fortress.** The central island has walls and towers (`WALLS` in `arena.ts`), each with a stone
  rectangle. A ball that touches an intact wall is consumed and the wall breaks (`wallBroken`), letting
  later balls pass through; towers consume every ball and never break (the sheet has no broken-tower art).
  The state is created with each `Simulation`, so a restart restores the walls.
- **Hulls.** A ship is a capsule: three circles along the keel (bow, centre, stern) sharing the hull
  radius. A pose is blocked when a circle overlaps an obstacle or leaves the arena. Moves that would
  collide fall back to the X-only or Y-only part (sliding along the shore); a head-on bump stops the ship.
  Turns that would push the hull into an obstacle are refused. The simulation never enters a blocked pose.
- **Ship vs ship.** The deepest overlapping circle pair pushes both hulls apart. Each hull only moves if
  the push keeps it clear of obstacles. A Chaser touching the player instead rams: it explodes and deals
  damage, without scoring.
- **Projectiles.** Each step a ball moves `velocity * dt` and is removed when it leaves the arena, enters
  an intact wall or tower, hits a ship or reaches its range (`ttl = range / speed`). Player balls only test
  enemies; enemy balls only test the player. A ball applies its damage once and is consumed on that step. A
  kill increments the score once, because a ship can only cross zero health once. A destroyed enemy stops
  dealing damage completely: balls it fired that are still in flight sink with it.
- **No tunnelling.** The fastest ball travels 520 / 60 ≈ 8.7 units per step, less than the smallest
  target reach (13 + 5 units), so swept tests are not needed. Raising projectile speed above ~1,000 u/s
  would require them.

## Enemy AI and spawning

- **Navigation.** The arena is a 40 x 24 grid of 32-unit cells. Cells closer to an obstacle than the
  largest hull radius are blocked (recomputed when the edge islands move). A breadth-first search from
  the player's cell gives every water cell its distance to the player; it is recomputed only when the
  player changes cell (960 cells, negligible cost). An enemy with a clear corridor to the player (sampled
  on the distance field) heads straight for it; otherwise it steers to the neighbouring cell closest to
  the player. This takes enemies around islands instead of pinning them against the shore.
- **Chaser.** Always closes in at full speed and rams.
- **Shooter.** Closes in until it is within attack range, then aims at the player (balls fly over islands,
  so no line of sight is needed), slows down and stops at its hold range. It fires its bow cannon when its
  heading is within the aim tolerance of the player and its cooldown is ready.
- Both kinds ease off the throttle in tight turns and obey the same hull collisions as the player.
- **Spawns.** The first spawn comes after min(2 s, interval), then one every interval. Spawns are deferred,
  not dropped, while `maxAlive` enemies are on the water: the clock does not bank time at the cap, so when
  a slot frees one enemy spawns right away and the interval resumes (no burst of replacements). The first
  two spawns are always a Chaser then a Shooter, so both kinds appear in every match. After that the kind
  is a seeded weighted pick.
- **Spawn points.** Candidates are cells within 150 units of the border that, at spawn time, are water with
  room for a full hull. Only points at least `minPlayerDistance` (420) from the player and clear of other
  ships are used. 420 is beyond the Shooter attack range (360) and gives a Chaser four seconds of travel,
  so a fresh spawn never deals unavoidable damage.

## Rendering and resource lifecycle

- **Scene graph.** `world` (scaled to the match bounds) contains, in draw order: map (water `TilingSprite`,
  shallow-water `NineSliceSprite` halos, each island block as **one** stretched sprite of the atlas's full
  sand block, with no seams between tiles, plus decor from both atlases: rocks, palms, boats and cannons),
  fortress walls, trails and wakes (one `Graphics` rebuilt per frame), a floating layer (sinking hulls,
  wreckage and crew, below the ships), ships, cannonballs (pooled sprites), effects, health bars.
- **Damage feedback.** Each hull switches through the sheet's four damage states as health drops, gains
  flames, and flashes on every hit. The player's hits also shake the camera, unless the user prefers
  reduced motion. Destroyed ships become grey wrecks that sink and fade as effects; their simulation
  entity is already gone. Each sinking also drops 1–2 crew members (`crew_1..6`), each inside a white ring
  that closes while the body goes under, and wreckage (`wood_*`, `nest`, `cannon_loose`) that drifts
  slowly, darkens and sinks over 4–6 s; none of it drifts onto sand. A hit wall shows stone rubble and
  swaps to the broken-wall sprite (88–91).
- **Cross island.** Where the central island's blocks overlap, the plain centre sand tile (17) is
  stretched over the core of each block, hiding the inner edges. Its halos sit in their own layer
  (`cacheAsTexture`) with `max` blending, so shallow water does not get lighter where they overlap. Each
  edge island is a `Container` (halo, sand, decor): when it moves it is repositioned and fades back in,
  with foam rings at the old and new spots.
- **Asset loading.** All textures are loaded once by `Assets.load` (with a progress callback) and parsed
  into `Spritesheet`s. Tiles always use the 2x atlas (the world is scaled up on most screens and the sand
  blocks are stretched); the 2x UI atlas goes to screens with a device pixel ratio ≥ 1.5. Logical sizes
  stay the same. Loading starts in the background on the menu. A failure sets an error state with a Retry
  button; Pixi's loader drops failed entries from its cache, so Retry downloads again. Combat only starts
  after every texture is ready.
- **Code loading.** The game screen and PixiJS are a lazy chunk, so the menus load without them. If that
  download fails, an error boundary shows Retry, which creates a fresh `lazy()` because React keeps a
  rejected import forever.
- **GPU warm-up.** Each match gets a fresh WebGL context. Before the match clock starts, `init()` renders
  the scene once (uploading the atlases and compiling shaders) and waits two frames, still behind the
  loading panel. This moves a 60–100 ms first-frame stall out of the battle (see PERFORMANCE.md).
- **Texture reuse.** The atlases stay in the `Assets` cache between matches on purpose. Per-ship health
  fills are small dynamic `Texture`s sharing the atlas source, cropped to the remaining health. They are
  destroyed with their ship.
- **Canvas sizing.** The app resizes to its host (`resizeTo`) with `autoDensity` and a resolution of
  `min(devicePixelRatio, 2)`. When the density changes (another monitor, browser zoom) the renderer is
  resized at the new resolution. The layout was designed at 1280 x 768; each match gets bounds
  (`arenaBounds`) with the aspect ratio of the screen it starts on, adding sea at the sides or at the top
  and bottom (ratio clamped between 4:3 and 2.4:1), so the playable arena fills the screen. The edge
  islands, spawn points and the navigation grid follow those bounds. If the window changes shape
  mid-match, the world is scaled to fit, never stretched or cropped, and the leftover shows more water
  (the `TilingSprite` extends well past the bounds) instead of bars. Touch controls are DOM buttons, so no
  pointer has to be mapped into the canvas.
- **Teardown.** `destroy()` removes the keyboard, blur, visibility and density listeners and the ticker
  callback, destroys the scene (`children: true`), then `app.destroy({ removeView, releaseGlobalResources })`.
  That releases Pixi's pools and loses the WebGL context. Leaving the screen, Restart and Play Again all go
  through this path; PERFORMANCE.md has the five-cycle memory check.

## UI state and persistence

Screens are hash routes (`#/`, `#/options`, `#/play`, `#/result`, `#/log/ranking`, `#/log/history`), so
refresh and the back button work on any static host. A reload on `#/play` lands on the menu: a reload ends
the running match. The one exception is a finished battle whose ranking-name step is still unanswered: a
reload then lands on the result screen so that step is not lost.

| localStorage key | Content |
| --- | --- |
| `pirate-battle:settings` | Options (validated on read; invalid data falls back to defaults) |
| `pirate-battle:player` | Local player id (UUID) |
| `pirate-battle:last-result` | Last completed match, plus whether its ranking-name step was answered; shown on the result screen after a refresh |
| `pirate-battle:pending-matches` | Completed matches the server has not confirmed yet |
| `pirate-battle:mock-db` | Matches confirmed by the mock server |
| `pirate-battle:mock-scenario` | Selected network scenario and latency seed |

Every match uses a frozen copy of the configuration taken when it starts, so Options changed mid-battle
(from the pause menu) only apply to the next match. An abandoned match (leaving the screen, Restart,
reload) never reaches `recordMatch`, so it is never registered.

## Ranking and history integration

- **Contracts** (`api/contracts.ts`, shared with the mocks):
  - `GET /api/ranking?sessionSeconds&spawnIntervalSeconds&page&pageSize` returns `Page<RankingEntry>`.
  - `GET /api/players/:playerId/matches?page&pageSize` returns `Page<MatchRecord>`, newest first.
  - `PUT /api/matches/:matchId` with a `MatchRecord` returns 201 when created, or 200 with the stored
    record when that id already exists.
  - A record carries the match and player ids, end time, score, effective duration, end reason and
    configuration. It also has `ranked` and `playerName`: the name the player typed on the result screen
    (2–16 characters, validated on both sides), or empty when the match stays out of the ranking.
    `isMatchRecord` (used for stored data and by the mock server) also requires a parseable date, options
    inside the Options ranges (`validateSettings`) and a duration that fits the session.
- **Leagues and order.** The ranking only lists `ranked` matches and only compares those with the same
  session time and spawn interval (the player's current Options). Order: score desc, then longer
  survival, then earlier `playedAt`, then `matchId`, so ties are always resolved the same way.
- **Idempotent registration.** `matchId` is a client-generated UUID, and PUT on an existing id returns the
  stored record. Re-sends, double clicks and retries after a timeout therefore recover the existing record
  instead of duplicating it. `submitOnce` also shares one in-flight request per match.
- **Queries.** TanStack Query with keys `['ranking', session, spawn, page]` and
  `['history', playerId, page]`. Retries: 2 for retryable errors only (timeouts, network, 5xx, 429), with
  exponential delay. Other settings: `staleTime` 10 s, `keepPreviousData` while paging, and
  `refetchOnMount: 'always'`, so each tab refetches when shown again (cached rows stay visible with an
  "Updating…" note). Every request gets the query's `AbortSignal`; a superseded or invalidated request is
  aborted, and a late answer only ever lands in its own page's cache entry, so it cannot overwrite newer
  data on screen.
- **Pending saves.**
  1. `recordMatch` writes the record to `last-result` as soon as the match ends, marked unconfirmed. The
     result screen then asks for the optional ranking name, and a reload returns to that step. *Continue*
     calls `confirmResult`, which fixes `ranked`/`playerName` and puts the record in the pending queue
     before any network call. If a new match ends while an older one is still unconfirmed, the older one
     is filed outside the ranking so it is never lost.
  2. `usePendingSync` (mounted once) submits pending records on start-up (recovery after refresh), when
     one is added, every 20 s, and on the browser `online` event.
  3. The `submit-match` mutation retries retryable errors 3 times. When the server confirms, the record
     leaves the queue and both `ranking` and `history` are invalidated. A record the server refuses for good
     (a non-retryable 4xx) stays on the device but is not resent by the timer: only *Retry now* or a reload
     tries it again.
  4. The result screen derives "Saved / Saving / Not saved yet + Retry now" from the queue and the
     mutation state; Match History lists waiting records with a *Retry now* button.
- **Isolation.** The game never awaits the API. A failing or missing API only affects the two tabs and the
  save status; play, Options and the menus keep working.

## Network mocks (MSW)

- **Shared definitions.** `mocks/handlers.ts` implements the contracts above. The same handlers run in
  development, in the published build and in tests. The `msw/vite` plugin (`worker-only` mode) serves
  `mockServiceWorker.js` in development and emits it into `dist`, so nothing generated is committed.
- **Storage.** Fixtures (other captains) are generated deterministically from a fixed seed. Confirmed
  records are persisted in localStorage.
- **Scenarios** (see the README): success, empty lists, many pages, slow, variable latency, out-of-order
  answers, timeout, connection failure, HTTP 500, HTTP 400, ranking down, history down, timeout after
  save, saving unavailable.
- **Selection.** Pick a scenario in the Network panel (menu screens) or with `?scenario=<id>&seed=<n>`.
  Latency jitter is seeded per scenario, so a run replays identically.
- **Reset.** "Reset to initial state" clears confirmed records, pending saves, the last result and the
  query cache, and restores the default scenario and seed.

## Accessibility

- **Dialogs.** Native `<dialog>` with `showModal()` for pause, the tutorial and network settings: focus is
  trapped, the page behind is inert, Esc closes, and focus returns to the opener.
- **Focus.** On every screen change focus moves to the screen heading. Focus is visible everywhere
  (`:focus-visible`). Ranking and Match History follow the WAI-ARIA tabs pattern (arrow keys, Home, End).
- **Forms.** Labelled inputs with hints; errors are linked through `aria-describedby`, announced with
  `role="alert"`, and focus moves to the first invalid field.
- **Status.** The HUD exposes health as a `meter` and score and time as text. Pause, low health, 10 s
  left and the end of the match are announced through a polite live region, never per frame. Loading
  states use native `<progress>`.
- **Keyboard.** Game keys are only captured while a match is running; paused or in menus, keys keep
  their normal behaviour.
- **Contrast and motion.** Cream on navy and dark brown on gold both pass WCAG AA for their text sizes.
  `prefers-reduced-motion` disables camera shake and UI animations.
- **Language.** The document declares `lang="en"` and all text, ARIA labels and announcements are in
  English.

## Mobile

- **Orientation.** Gameplay is landscape-only. Held upright on a touch device, the match pauses and the
  pause dialog turns into a large "Rotate your phone to play" message with only *Options*, *Controls* and
  *Main Menu* (Resume and Restart need landscape); resuming while still in portrait pauses again. The
  match is born upright, so its arena is sized for that shape; `resume()` therefore builds the simulation
  and renderer again for the screen as it is now, if under a second has been played and the bounds differ
  (otherwise the map would show small, with invisible walls at the sides). Menus
  work in both orientations, in a single column with nothing scrolling sideways.
- **Menu without scrolling.** On touch screens and in any window too small for the two-column menu (under
  960 x 640), the *How to play* section leaves the menu and opens from a button in a `<dialog>`; on touch
  screens the controls legend becomes a grid of the touch buttons (50 px icons) instead of the key table,
  and in landscape the main buttons sit side by side. Menu, tutorial and pause fit screens from 340 px of
  height.
- **Ranking and history.** On narrow screens (under 700 px) each table row becomes a two- or three-line
  card (rank, name, date and points; in the history, date, duration, result and ranking name), so nothing
  scrolls sideways. The header stays in the DOM, only visually hidden, and the tables carry explicit ARIA
  roles (`table`, `row`, `cell`…), because `display: grid` makes some browsers drop the table semantics.
- **Nothing scrolls.** Menu, options, result, ranking, history and the dialogs (tutorial, pause, network
  panel) fit the window at any size. Two mechanisms work together:
  1. *Compact layouts* in `styles.css` (the "compact layouts" section): held upright, the title, tabs and
     cards shrink; on short screens (phone on its side, small laptop) the title, tabs and menu button share
     the first row, tables get one line per record, options and result switch to two columns, and the
     network panel lists its scenarios in columns. Common sizes stay at 100% scale.
  2. *Automatic fit* (`useFitScreens` in `ui/fit.ts`): after every DOM change, image load or resize it
     measures whether the screen sticks out of the window and, if it does, shrinks it with CSS `zoom` (2%
     steps, floor 50%) just until it fits. It runs in a `MutationObserver` callback, before paint, so no
     frame shows a scrollbar. For dialogs the width and max-height caps are divided by the zoom, so the dialog
     keeps its on-screen size while the smaller text reflows into the freed space. The game screen is not
     involved (it letterboxes).
- **Fullscreen.** Only by the player's choice: where the primary pointer is a finger, the
  `FullscreenButton` (bottom right of the main menu and in the HUD) requests fullscreen
  (`requestFullscreen`) and locks the orientation to landscape. *Play* never enters it on its own. A
  refusal or missing support just keeps the game in the window. On the menu the button sits above the logo
  on large screens and in the corner, without the logo, on small ones. iPhone Safari has no element
  fullscreen: there the button is hidden and the `*-web-app-capable` meta tags make the Home Screen
  shortcut open without bars.
- **Touch controls.** Six hold-to-act buttons. Every round button of a match (these six, pause and
  fullscreen) is `--touch`, 60px; inside each cluster the buttons are 3px apart. Each button uses pointer
  capture, so several fingers work at once (steer and fire). Behind the left buttons, holding the empty
  part of their box shows a stick (`MoveStick`, `game/stick.ts`). Its zone is a grid item spanning the
  whole left cluster, and its ring hugs the three movement buttons (3.3 x `--touch` wide, centred across
  them and a little below the middle of the box, so it covers them with a small margin and stays on the
  screen), whatever the spot the finger landed on; the drag is measured from where the finger
  landed and moves the knob inside the ring. Up sails forward, sideways turns, and down does nothing (there is
  no reverse). It maps to the same `forward`/`turnLeft`/`turnRight` booleans (`input.setStick()`), so it
  is an 8-direction stick, not a proportional one.
- **Controls legend.** The controls table shows only the column that applies to the device, through CSS
  media queries: Touch where a touch screen exists (`any-pointer: coarse`) and Keyboard, except when touch
  is the primary input (`pointer: coarse`).
- **Layout.** Safe-area insets are respected, and resizing only rescales the view, never the rules.

## Testing

- **Rules.** `npm run test:unit` runs `simulation.check.ts` headless on Node's built-in test runner
  (`node --test`, no dependency): the simulation is plain TypeScript, so
  collisions, damage, scoring, spawns and determinism are asserted without a browser.
- **E2E (Playwright, `e2e/`).** Two Chromium projects, desktop and mobile (touch). Each test runs in a fresh
  browser context, and the tests drive the game only through its public inputs (keys, touches, buttons).
- **Clock control.** Game tests install and freeze `page.clock` before the app loads, so the Pixi ticker,
  `setTimeout` (including MSW's simulated latency) and `Date` stand still until the test moves them.
  `window.__pirateBattle` (exposed only with `?debug` or `?perf`) adds two things on top of the read-only
  `state()`: `advance(seconds)` hands the simulation whole fixed steps through the same `drain()` the ticker
  uses, with the input exactly as held, then updates the HUD. It skips drawing between steps, which is what
  makes a 60-second match take milliseconds. Rendering is still exercised: real frames run through the real
  ticker whenever `page.clock.runFor` advances time (pause, end-of-match hand-off, screenshots).
- **Determinism.** `?seed=<n>` fixes spawn kinds and positions, so a test can wait for "the first Chaser"
  and shoot it. Bots (`turnTo`, `engage`, `autopilot` in `e2e/helpers.ts`) steer with held keys and read
  the state back, so assertions hold even if a spawn lands a few frames earlier or later.
- **Network.** `?scenario=<id>` selects the MSW behaviour. These specs keep the real clock because Axios'
  timeout is the browser's own XHR timeout, which a fake clock cannot fast-forward.
- **Reports.** The HTML report goes to `playwright-report/`; failures keep a trace and a screenshot in
  `test-results/`.

## Balancing decisions

All values live in `GAME_CONFIG` (`src/game/config.ts`); changing them never requires touching systems.

| Parameter | Value | Why |
| --- | --- | --- |
| Arena | 20 x 12 tile layout (1280 x 768), extended with sea to the screen's aspect ratio | Readable ships on any screen and no empty borders |
| Player | 100 hp, 140 u/s, 2.4 rad/s | Outruns both enemy kinds; turning is the main dodge |
| Bow cannon | 25 dmg, 0.35 s, 460 range | Reliable answer to Chasers (one hit sinks them) |
| Broadside | 3 x 20 dmg, 1.2 s per side, 320 range | Higher burst for brawls, rewards positioning |
| Chaser | 25 hp, 100 u/s, ram 20 | Glass cannon: dangerous in groups, but dies to one aimed shot |
| Shooter | 50 hp, 80 u/s, 6 dmg every 2.5 s, attack 360, hold 260 | Tanky but slow; unaimed (no lead), so a moving player can dodge |
| Spawning | Interval from Options (1–10 s, default 3 s), max 10 alive, ≥ 420 units from the player | Constant pressure without unavoidable damage |
| Mix | First Chaser then Shooter, then 55% / 45% | Both kinds appear in every match |

A scripted bot (steer at the nearest enemy, hold every cannon) scores about 19 points and survives about
70 s at the default settings; a human who dodges does better. The reference result screen shows 24 points
in 120 s.

## Known limitations

- **Hull shape.** Hulls are capsules; sails overhang them a little, so ships may visually brush an
  island before they touch it.
- **Bunching.** All enemies share one flow field. They can bunch up near the player; push-apart keeps
  them from overlapping.
- **Sound.** Sounds are uncompressed WAV (5.8 MB). They download in the background on the menu, after the
  textures so they do not compete with them (three unused UI sounds are skipped), but
  browsers only allow decoding after the first click (autoplay policy). On a slow connection the first
  sounds of the first match may therefore be missing.
- **Local-only data.** The mock "server" stores data in each browser's localStorage. The player identity
  is local; the ranking name is typed after each match and is not remembered between matches.
- **E2E speed.** WebGL in headless Chromium runs on software rendering (SwiftShader), around 35–100 ms per
  frame, so the E2E suite cannot play minutes of battle through real frames. It uses the time hook
  described under Testing instead. Visual baselines are per operating system.
