import { describeError } from '../api/client.ts';
import type { MatchRecord } from '../api/contracts.ts';
import { useSubmissionState, useSubmitMatch } from '../api/queries.ts';
import { lastResultStore } from '../settings.ts';
import { useStore } from '../store.ts';
import { Button, Panel, endReasonLabel, focusOnMount, formatClock } from './kit.tsx';
import { navigate } from './router.ts';

export function SyncStatus({ record }: { record: MatchRecord }) {
  const state = useSubmissionState(record.matchId);
  const { mutate } = useSubmitMatch();
  return (
    <div className={`sync sync-${state.status}`} role="status">
      {state.status === 'saved' && <p>✔ Saved to the Captain's Log.</p>}
      {state.status === 'saving' && <p>Saving to the Captain's Log…{state.attempt > 1 && ` (attempt ${state.attempt})`}</p>}
      {state.status === 'queued' && <p>Waiting to save this battle…</p>}
      {state.status === 'failed' && (
        <>
          <p>
            Not saved yet: {describeError(state.error)} It is kept on this device and retried automatically.
          </p>
          <Button size="sm" onClick={() => mutate(record)}>
            Retry now
          </Button>
        </>
      )}
    </div>
  );
}

export function ResultScreen({ onPlayAgain }: { onPlayAgain: () => void }) {
  const result = useStore(lastResultStore);
  return (
    <main className="screen">
      <Panel className="result-panel" labelledBy="result-title">
        {result ? (
          <>
            <h1 id="result-title" ref={focusOnMount} tabIndex={-1}>
              {result.endReason === 'time-up' ? 'Battle complete' : 'Ship sunk'}
            </h1>
            <p className="big-score" aria-hidden="true">
              {result.score}
            </p>
            <p className="result-line" aria-hidden="true">
              Points · {formatClock(result.durationMs / 1000)} · {endReasonLabel(result.endReason)}
            </p>
            <dl className="sr-only">
              <dt>Total score</dt>
              <dd>{result.score} points</dd>
              <dt>Time played</dt>
              <dd>{formatClock(result.durationMs / 1000)}</dd>
              <dt>Ended by</dt>
              <dd>{endReasonLabel(result.endReason)}</dd>
            </dl>
            <p className="muted small">
              {result.config.sessionSeconds} s battle · enemy every {result.config.spawnIntervalSeconds} s
            </p>
            <SyncStatus record={result} />
          </>
        ) : (
          <>
            <h1 id="result-title" ref={focusOnMount} tabIndex={-1}>
              No battle yet
            </h1>
            <p className="muted">Finish a battle to see its result here.</p>
          </>
        )}
        <div className="stack">
          <Button onClick={onPlayAgain}>Play Again</Button>
          <Button variant="secondary" onClick={() => navigate('menu')}>
            Main Menu
          </Button>
        </div>
      </Panel>
    </main>
  );
}
