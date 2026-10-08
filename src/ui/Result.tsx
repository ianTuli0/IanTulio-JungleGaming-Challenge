import { useId, useState, type FormEvent } from 'react';
import { describeError } from '../api/client.ts';
import { CAPTAIN_NAME, isValidCaptainName, type MatchRecord } from '../api/contracts.ts';
import { confirmResult, useSubmissionState, useSubmitMatch } from '../api/queries.ts';
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

/** Optional ranking name. Continue with an empty field files the battle in the history only. */
function RankingNameForm({ record, onDone }: { record: MatchRecord; onDone: () => void }) {
  const id = useId();
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const trimmed = name.trim();
  const error = trimmed && !isValidCaptainName(trimmed) ? `Use ${CAPTAIN_NAME.min}–${CAPTAIN_NAME.max} letters, numbers, spaces or . ' _ -` : '';

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setTouched(true);
    if (error) {
      e.currentTarget.querySelector('input')?.focus();
      return;
    }
    confirmResult(record, trimmed);
    onDone();
  };

  return (
    <form className="options" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor={id}>Captain name for the ranking (optional)</label>
        <input
          id={id}
          type="text"
          value={name}
          maxLength={CAPTAIN_NAME.max}
          autoComplete="off"
          spellCheck={false}
          placeholder="e.g. Captain Jack"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setTouched(true)}
          aria-invalid={touched && !!error}
          aria-describedby={`${id}-hint${touched && error ? ` ${id}-error` : ''}${trimmed ? '' : ` ${id}-warning`}`}
        />
        <p id={`${id}-hint`} className="hint">
          {CAPTAIN_NAME.min}–{CAPTAIN_NAME.max} characters. Shown next to your score in the ranking.
        </p>
        {touched && error && (
          <p id={`${id}-error`} className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      {!trimmed && (
        <div className="pending" id={`${id}-warning`} role="status">
          <p>⚠ Without a name, this battle is saved to your Match History only and does not appear in the ranking.</p>
        </div>
      )}
      <div className="stack">
        <Button type="submit">Continue</Button>
      </div>
    </form>
  );
}

export function ResultScreen({ onPlayAgain }: { onPlayAgain: () => void }) {
  const result = useStore(lastResultStore);
  const [justConfirmed, setJustConfirmed] = useState(false);
  const record = result?.record;
  const confirmed = result?.confirmed ?? true;
  return (
    <main className="screen">
      <Panel className="result-panel" labelledBy="result-title">
        {record ? (
          <div className="result-summary">
            <h1 id="result-title" ref={focusOnMount} tabIndex={-1}>
              {record.endReason === 'time-up' ? 'Battle complete' : 'Ship sunk'}
            </h1>
            <p className="big-score" aria-hidden="true">
              {record.score}
            </p>
            <p className="result-line" aria-hidden="true">
              Points · {formatClock(record.durationMs / 1000)} · {endReasonLabel(record.endReason)}
            </p>
            <dl className="sr-only">
              <dt>Total score</dt>
              <dd>{record.score} points</dd>
              <dt>Time played</dt>
              <dd>{formatClock(record.durationMs / 1000)}</dd>
              <dt>Ended by</dt>
              <dd>{endReasonLabel(record.endReason)}</dd>
            </dl>
            <p className="muted small">
              {record.config.sessionSeconds} s battle · enemy every {record.config.spawnIntervalSeconds} s
            </p>
          </div>
        ) : (
          <div className="result-summary">
            <h1 id="result-title" ref={focusOnMount} tabIndex={-1}>
              No battle yet
            </h1>
            <p className="muted">Finish a battle to see its result here.</p>
          </div>
        )}
        <div className="result-actions">
          {record &&
            (confirmed ? (
              <>
                <p className="small">
                  {record.ranked ? (
                    <>
                      Entered in the ranking as <strong className="gold">{record.playerName}</strong>.
                    </>
                  ) : (
                    <span className="muted">Not ranked (no name entered).</span>
                  )}
                </p>
                <SyncStatus record={record} />
              </>
            ) : (
              <RankingNameForm record={record} onDone={() => setJustConfirmed(true)} />
            ))}
          {confirmed && (
            <div className="stack">
              <Button autoFocus={justConfirmed} onClick={onPlayAgain}>
                Play Again
              </Button>
              <Button variant="secondary" onClick={() => navigate('menu')}>
                Main Menu
              </Button>
            </div>
          )}
        </div>
      </Panel>
    </main>
  );
}
