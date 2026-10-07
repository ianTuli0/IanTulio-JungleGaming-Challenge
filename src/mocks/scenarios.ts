// Network scenarios for the mocked API. Kept free of MSW imports so the UI panel stays light.
import { createStore, storage } from '../store.ts';

export const SCENARIOS = [
  { id: 'normal', label: 'Normal', description: 'Success with a short seeded latency (120–380 ms).' },
  { id: 'empty', label: 'Empty lists', description: 'Ranking and history answer with no rows.' },
  { id: 'many-pages', label: 'Many pages', description: '60 extra fixture matches per league.' },
  { id: 'slow', label: 'Slow network', description: 'Every request takes 2.5–3.5 s.' },
  { id: 'variable-latency', label: 'Variable latency', description: 'Seeded 0.1–2.5 s per request, so answers can arrive out of order.' },
  { id: 'out-of-order', label: 'Out of order', description: 'Alternates 2.2 s and 0.2 s answers: older requests finish last.' },
  { id: 'timeout', label: 'Timeout', description: 'Requests hang past the client timeout (saves are stored, answers never arrive).' },
  { id: 'network-error', label: 'Connection failure', description: 'Every request fails at the network level.' },
  { id: 'server-error', label: 'HTTP 500', description: 'Every request answers 500 Internal Server Error (retried).' },
  { id: 'client-error', label: 'HTTP 400', description: 'Every request answers 400 Bad Request (not retried).' },
  { id: 'ranking-down', label: 'Ranking fails', description: 'Only the ranking query answers 503.' },
  { id: 'history-down', label: 'History fails', description: 'Only the match history query answers 503.' },
  { id: 'submit-timeout', label: 'Timeout after save', description: 'The first save of each match is stored but answers too late; the retry recovers it without duplicates.' },
  { id: 'submit-unavailable', label: 'Saving unavailable', description: 'Saves answer 503; pending matches register once you switch back.' },
] as const;

export type ScenarioId = (typeof SCENARIOS)[number]['id'];

export interface ScenarioState {
  id: ScenarioId;
  /** Seeds latency jitter so a scenario replays identically. */
  seed: number;
}

const KEY = 'pirate-battle:mock-scenario';
export const DEFAULT_SCENARIO: ScenarioState = { id: 'normal', seed: 1 };

const isScenario = (id: unknown): id is ScenarioId => SCENARIOS.some((s) => s.id === id);

function initial(): ScenarioState {
  const stored = storage.read(KEY, (v) => {
    const s = v as ScenarioState;
    return s && isScenario(s.id) && Number.isInteger(s.seed) ? s : null;
  });
  // URL overrides (?scenario=slow&seed=7) make a scenario shareable and scriptable.
  const params = new URLSearchParams(window.location.search);
  const id = params.get('scenario');
  const seed = Number(params.get('seed'));
  return {
    id: isScenario(id) ? id : (stored?.id ?? DEFAULT_SCENARIO.id),
    seed: Number.isInteger(seed) && params.has('seed') ? seed : (stored?.seed ?? DEFAULT_SCENARIO.seed),
  };
}

export const scenarioStore = createStore<ScenarioState>(initial());
storage.write(KEY, scenarioStore.get());
scenarioStore.subscribe(() => storage.write(KEY, scenarioStore.get()));

/** Confirmed records written by the mock server, persisted across refreshes. */
export const MOCK_DB_KEY = 'pirate-battle:mock-db';

/** Back to the initial state: fixtures only, normal scenario, default seed. */
export function resetMockServer(): void {
  storage.write(MOCK_DB_KEY, null);
  scenarioStore.set({ ...DEFAULT_SCENARIO });
}
