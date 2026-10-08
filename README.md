# Pirate Battle

Top-down naval shooter for the browser. Sink Chasers (red sails) and Shooters (black sails) before the
clock runs out: one point per ship sunk by your cannons. The match ends on time-up or when your ship sinks.

Stack: React 19, TypeScript (strict), PixiJS 8, TanStack Query 5, Axios, MSW 3, Vite.

**Link Vercel deploy:** ian-tulio-jungle-gaming-challenge.vercel.app

Docs: [ARCHITECTURE.md](ARCHITECTURE.md) (design, contracts, balancing, limitations,
[differentiators](ARCHITECTURE.md#differentiators)) and [PERFORMANCE.md](PERFORMANCE.md) (profiling).

## Setup

Requires Node.js 22.12 or newer. No backend and no private service: the ranking and match history API is
mocked by MSW, in development and in the published build.

```bash
npm ci
npm run dev        # http://localhost:5173
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Type check and production build in `dist/` |
| `npm run preview` | Serves `dist/` at http://localhost:4173 |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript check, no output files |
| `npm run test:unit` | Headless checks of the game rules (`src/game/simulation.check.ts`) |
| `npx playwright install chromium` | Installs the E2E browser (once) |
| `npm run test:e2e` | Playwright suite, desktop and mobile projects (builds and serves the app itself) |
| `npm run test:e2e:report` | Opens the HTML report of the last run |
| `npm run test:e2e:update` | Regenerates the visual baselines (they are per operating system) |
| `npm run profile` | Profiling harness behind PERFORMANCE.md (needs Chrome and `npm run preview` running) |

## Environment variables

All optional. Copy `.env.example` to `.env` to override.

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | empty (same origin) | Base URL of the ranking/history API |
| `VITE_API_TIMEOUT_MS` | `5000` | Client timeout for API calls |
| `VITE_ENABLE_MOCKS` | `true` | `false` disables MSW (to use a real backend) |

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Sail forward | `W` / `↑` | ⬆ button |
| Turn left / right | `A` / `←`, `D` / `→` | ↶ ↷ buttons |
| Bow cannon (1 ball) | `Space` / `K` | Bow button |
| Left broadside (3 balls) | `Q` / `J` | Left broadside button |
| Right broadside (3 balls) | `E` / `L` | Right broadside button |
| Pause | `Esc` / `P` | Pause button |

Keys and fingers can be combined. The match pauses by itself when the window loses focus or the tab is
hidden; resuming always needs *Resume* or `Esc`. On phones the game is landscape-only.

## Gameplay configuration

Options screen (saved in localStorage; each match takes a snapshot when it starts):

| Option | Range | Default |
| --- | --- | --- |
| Game session time | 60–180 s, whole seconds | 120 s |
| Enemy spawn time | 1–10 s, one decimal at most | 3 s |
| Sound effects | on / off | on |

Everything else is in code, not in the systems:

- `GAME_CONFIG` in `src/game/config.ts`: hit points, speeds, turn rates, hull sizes, damage, projectile
  speed and range, cooldowns, spawn mix and distance, Shooter ranges.
- `src/game/arena.ts`: `ISLAND_SHIFT_SECONDS` (how often the edge islands resurface, 30 s), the island
  spots and the fortress `WALLS`.

Values and rationale: [ARCHITECTURE.md](ARCHITECTURE.md#balancing-decisions).

## Ranking and match history

Open **Ranking** or **Match History** from the main menu. When a battle ends, the result screen asks for an
optional captain name (2–16 characters): with a name the match enters the ranking, without one it is saved
to Match History only. Each match is registered once, after *Continue*, and kept on the device until the
server confirms it, including across reloads and failures.

## Network scenarios (MSW)

**Select:** on any menu screen press **Network** (bottom left), or open `/?scenario=<id>&seed=<n>`. The
choice survives reloads.
**Reset:** **Reset to initial state** in the same panel. It deletes saved matches (fixtures stay), pending
saves, the last result and the query cache, and restores the Normal scenario and the default seed.

| Scenario (`id`) | Behaviour |
| --- | --- |
| Normal (`normal`) | Success, 120–380 ms seeded latency |
| Empty lists (`empty`) | Ranking and history return no rows |
| Many pages (`many-pages`) | 60 extra fixture matches per league |
| Slow network (`slow`) | 2.5–3.5 s per request |
| Variable latency (`variable-latency`) | 0.1–2.5 s, seeded; answers can arrive out of order |
| Out of order (`out-of-order`) | Alternates 2.2 s and 0.2 s, so older requests finish last |
| Timeout (`timeout`) | Requests answer after the client timeout |
| Connection failure (`network-error`) | Every request fails at the network level |
| HTTP 500 (`server-error`) | Every request answers 500 (retried) |
| HTTP 400 (`client-error`) | Every request answers 400 (not retried) |
| Ranking fails (`ranking-down`) | Only the ranking query answers 503 |
| History fails (`history-down`) | Only the history query answers 503 |
| Timeout after save (`submit-timeout`) | The first save of each match is stored but answers too late |
| Saving unavailable (`submit-unavailable`) | Saves answer 503 until you switch back |

The latency jitter is seeded: the same `seed` replays the same run.

## Reproducing failures

Set **Game session time** to 60 s in Options to finish matches quickly.

| Failure | How |
| --- | --- |
| Ranking or history query fails | Scenario *Ranking fails* or *History fails*, open the Captain's Log. The failing tab shows the error and *Retry*; the other tab keeps working. |
| Loading and background refresh | Scenario *Slow network*. First visit shows *Loading…*; switching tabs shows the cached rows with *Updating…*. |
| Late answer must not overwrite newer data | Scenario *Out of order*, press *Next page* twice quickly. The list ends on page 3 with page 3's rows. |
| Timeout after a save, no duplicates | Scenario *Timeout after save*, finish a match, *Continue*. The screen shows *Saving… (attempt 2)*, then *Saved*. Match History lists it once. |
| API down when the match ends | Scenario *Saving unavailable*, finish a match, *Continue* → *Not saved yet* + *Retry now*. Reload: the match is still listed as pending. Switch to *Normal* and press *Retry now* (or wait up to 20 s): it is saved. |
| Asset loading failure | DevTools → Network → *Request blocking*: block `*tiles_sheet*`, reload, press *Play* → error + *Retry*. Unblock and press *Retry*. |
| Pause on focus loss | During a match, switch tabs. Timer, cooldowns and enemies stay frozen until *Resume*. |

## Test and profiling reports

| Report | Where | Result |
| --- | --- | --- |
| Rules (unit) | `npm run test:unit` | 19 checks, 0 failed |
| E2E (Playwright) | [playwright-report/index.html](playwright-report/index.html), or `npm run test:e2e:report` | 140 passed, 0 failed, 10 skipped on purpose (touch-only or desktop-only checks) |
| Profiling | [PERFORMANCE.md](PERFORMANCE.md), raw logs in [profiling/](profiling/) | 60 FPS target met: p99 frame ≈ 7 ms |

The E2E suite runs on Chromium as desktop (1024 x 576) and as a Pixel 7 in landscape. Game tests freeze
the page clock and step the real simulation through `window.__pirateBattle.advance(seconds)`, so they are
reproducible. Visual baselines in `e2e/visual.spec.ts-snapshots/` come from Windows; on another OS run
`npm run test:e2e:update` once.

## Debug flags

| URL parameter | Effect |
| --- | --- |
| `?seed=<n>` | Fixes the match seed (same spawns every time) |
| `?debug` | Draws island and wall colliders; exposes `window.__pirateBattle` (`state()`, `advance(seconds)`) |
| `?perf` | FPS / frame-time / entity overlay; logs a report at the end of each match |


The app uses hash routes, so reloading any URL works without rewrite rules. The build ships
`mockServiceWorker.js`, so the published site runs the mocked API; service workers need HTTPS.
