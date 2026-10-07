import { useId, useState } from 'react';
import { pendingStore, queryClient } from '../api/queries.ts';
import { SCENARIOS, resetMockServer, scenarioStore, type ScenarioId } from '../mocks/scenarios.ts';
import { saveLastResult } from '../settings.ts';
import { useStore } from '../store.ts';
import { Button, Dialog, Icon } from './kit.tsx';

/** Demo/test tool: picks the mocked network behaviour for ranking and history. */
export function NetworkPanel() {
  const [open, setOpen] = useState(false);
  const scenario = useStore(scenarioStore);
  const [message, setMessage] = useState('');
  const seedId = useId();

  const apply = (id: ScenarioId, seed = scenario.seed) => {
    scenarioStore.set({ id, seed });
    setMessage('');
    // Refetch with the new behaviour right away.
    void queryClient.invalidateQueries();
  };

  const reset = () => {
    resetMockServer();
    pendingStore.set([]);
    saveLastResult(null);
    queryClient.clear();
    setMessage('Saved matches, pending saves, the last result and the scenario were reset to the initial state.');
  };

  const current = SCENARIOS.find((s) => s.id === scenario.id);
  return (
    <>
      <button type="button" className="network-toggle" onClick={() => setOpen(true)} aria-haspopup="dialog" title="Network scenarios">
        <Icon name="icon_settings" />
        <span className="network-label">
          Network: <strong>{current?.label}</strong>
        </span>
      </button>
      <Dialog open={open} onCancel={() => setOpen(false)} labelledBy="network-title" className="network-dialog">
        <h2 id="network-title">Network scenarios</h2>
        <p className="muted small">Mocked with MSW. Affects only the ranking and match history API; the game always works offline.</p>
        <fieldset className="scenarios">
          <legend className="sr-only">Scenario</legend>
          {SCENARIOS.map((s) => (
            <label key={s.id} className={`scenario ${s.id === scenario.id ? 'active' : ''}`}>
              <input type="radio" name="scenario" value={s.id} checked={s.id === scenario.id} onChange={() => apply(s.id)} />
              <span>
                <strong>{s.label}</strong>
                <span className="small muted">{s.description}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="field seed">
          <label htmlFor={seedId}>Latency seed</label>
          <input
            id={seedId}
            type="number"
            step={1}
            value={scenario.seed}
            onChange={(e) => {
              const seed = Number.parseInt(e.target.value, 10);
              if (Number.isInteger(seed)) apply(scenario.id, seed);
            }}
          />
        </div>
        <p className="status" role="status">
          {message}
        </p>
        <div className="row">
          <Button variant="secondary" size="sm" onClick={reset}>
            Reset to initial state
          </Button>
          <Button size="sm" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
      </Dialog>
    </>
  );
}
