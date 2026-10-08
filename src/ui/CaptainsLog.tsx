import type { UseQueryResult } from '@tanstack/react-query';
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { describeError } from '../api/client.ts';
import type { MatchRecord, Page } from '../api/contracts.ts';
import { pendingStore, useHistory, useRanking, useSubmitMatch } from '../api/queries.ts';
import { player, settingsStore } from '../settings.ts';
import { useStore } from '../store.ts';
import { Button, Icon, Panel, RoundButton, endReasonLabel, focusOnMount, formatClock, formatPlayedAt } from './kit.tsx';
import { navigate } from './router.ts';

type Tab = 'ranking' | 'history';

/** Loading / empty / error / background-refresh states shared by both tabs. */
function QueryView<T>({ query, label, empty, children }: { query: UseQueryResult<Page<T>>; label: string; empty: string; children: (page: Page<T>, loadingNext: boolean) => ReactNode }) {
  const { data, isPending, isError, error, isFetching, isPlaceholderData, failureCount, refetch } = query;
  if (isPending) {
    return (
      <p className="state" role="status">
        Loading {label}…{failureCount > 0 && ` Retrying (attempt ${failureCount + 1}).`}
      </p>
    );
  }
  if (isError && !data) {
    return (
      <div className="state" role="alert">
        <p className="error">
          Could not load the {label}. {describeError(error)}
        </p>
        <Button size="sm" disabled={isFetching} onClick={() => void refetch()}>
          {isFetching ? 'Retrying…' : 'Try again'}
        </Button>
      </div>
    );
  }
  return (
    <>
      <p className="refresh" role="status">
        {isFetching ? (isPlaceholderData ? `Loading page…` : 'Updating…') : ''}
        {isError && !isFetching && (
          <>
            Could not refresh, showing earlier data.{' '}
            <button type="button" className="link" onClick={() => void refetch()}>
              Retry
            </button>
          </>
        )}
      </p>
      {data.items.length === 0 ? <p className="state">{empty}</p> : <div className={isPlaceholderData ? 'stale' : undefined}>{children(data, isPlaceholderData)}</div>}
    </>
  );
}

/** `current` is the requested page while it loads, so quick clicks keep advancing. */
function Pager({ current, total, onPage }: { current: number; total: number; onPage: (p: number) => void }) {
  return (
    <nav className="pager" aria-label="Pagination">
      <RoundButton icon="icon_turn_left" label="Previous page" disabled={current <= 1} onClick={() => onPage(current - 1)} />
      <span aria-live="polite">
        Page {current} of {total}
      </span>
      <RoundButton icon="icon_turn_right" label="Next page" disabled={current >= total} onClick={() => onPage(current + 1)} />
    </nav>
  );
}

function When({ iso }: { iso: string }) {
  const { day, time } = formatPlayedAt(iso);
  return (
    <time dateTime={iso}>
      {day} <span className="muted">· {time}</span>
    </time>
  );
}

function RankingTab() {
  const settings = useStore(settingsStore);
  const config = { sessionSeconds: settings.sessionSeconds, spawnIntervalSeconds: settings.spawnIntervalSeconds };
  const [page, setPage] = useState(1);
  const query = useRanking(config, page);
  return (
    <>
      <p className="subtitle">
        {config.sessionSeconds} second battles · {config.spawnIntervalSeconds} second spawn interval
      </p>
      <QueryView query={query} label="ranking" empty="No battles recorded with this configuration yet. Be the first!">
        {(data, loadingNext) => (
          <>
            <table className="log-table ranking-table" role="table">
              <caption className="sr-only">
                Ranking for {config.sessionSeconds} second battles with an enemy every {config.spawnIntervalSeconds} seconds
              </caption>
              <thead role="rowgroup">
                <tr role="row">
                  <th scope="col" role="columnheader">Rank</th>
                  <th scope="col" role="columnheader">Captain</th>
                  <th scope="col" role="columnheader">Points</th>
                  <th scope="col" role="columnheader">Played</th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {data.items.map((r) => {
                  const mine = r.playerId === player.id;
                  return (
                    <tr key={r.matchId} role="row" className={mine ? 'mine' : undefined}>
                      <td role="cell" className="gold rank">{String(r.rank).padStart(2, '0')}</td>
                      <th scope="row" role="rowheader" className="name">
                        {r.rank === 1 && <Icon name="icon_score" className="icon-inline" />}
                        {r.playerName}
                        {mine && <span className="badge">You</span>}
                      </th>
                      <td role="cell" className="gold score">{r.score}</td>
                      <td role="cell" className="date">
                        <When iso={r.playedAt} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pager current={loadingNext ? page : data.page} total={data.totalPages} onPage={setPage} />
          </>
        )}
      </QueryView>
      <p className="hint">Change the battle settings in Options to see other leagues.</p>
    </>
  );
}

function PendingList() {
  const pending = useStore(pendingStore);
  const { mutate, isPending } = useSubmitMatch();
  if (!pending.length) return null;
  return (
    <div className="pending" role="status">
      <p>
        {pending.length} finished {pending.length === 1 ? 'battle is' : 'battles are'} waiting to be saved (kept on this device).
      </p>
      <Button size="sm" disabled={isPending} onClick={() => pending.forEach((r) => mutate(r))}>
        Retry now
      </Button>
    </div>
  );
}

function HistoryTab() {
  const [page, setPage] = useState(1);
  const query = useHistory(page);
  return (
    <>
      <p className="subtitle">Your recent battles</p>
      <PendingList />
      <QueryView query={query} label="match history" empty="No battles recorded yet. Set sail!">
        {(data: Page<MatchRecord>, loadingNext) => (
          <>
            <table className="log-table history-table" role="table">
              <caption className="sr-only">Your match history, newest first</caption>
              <thead role="rowgroup">
                <tr role="row">
                  <th scope="col" role="columnheader">Date</th>
                  <th scope="col" role="columnheader">Points</th>
                  <th scope="col" role="columnheader">Duration</th>
                  <th scope="col" role="columnheader">Result</th>
                  <th scope="col" role="columnheader">Ranking</th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {data.items.map((r) => (
                  <tr key={r.matchId} role="row">
                    <th scope="row" role="rowheader" className="date">
                      <When iso={r.playedAt} />
                    </th>
                    <td role="cell" className="gold score">{r.score}</td>
                    <td role="cell" className="duration">{formatClock(r.durationMs / 1000)}</td>
                    <td role="cell" className={`reason reason-${r.endReason}`}>{endReasonLabel(r.endReason)}</td>
                    <td role="cell" className={r.ranked ? 'player ranked' : 'player'}>{r.ranked ? r.playerName : <span className="muted">Not ranked</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager current={loadingNext ? page : data.page} total={data.totalPages} onPage={setPage} />
          </>
        )}
      </QueryView>
    </>
  );
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'ranking', label: 'Ranking' },
  { id: 'history', label: 'Match History' },
];

export function CaptainsLog({ tab }: { tab: Tab }) {
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ ranking: null, history: null });
  const select = (next: Tab) => navigate(`log/${next}`);

  // WAI-ARIA tabs: arrows/Home/End move between tabs.
  const onKeyDown = (e: KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const target = TABS[(next + TABS.length) % TABS.length].id;
    select(target);
    tabRefs.current[target]?.focus();
  };

  return (
    <main className="screen">
      <Panel className="log-panel" labelledBy="log-title">
        <h1 id="log-title" ref={focusOnMount} tabIndex={-1}>
          Captain's Log
        </h1>
        <div className="tabs" role="tablist" aria-label="Captain's log" onKeyDown={onKeyDown}>
          {TABS.map((t) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => select(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="tabpanel">
          {/* Keyed remount: switching back re-runs the queries (refetchOnMount: 'always'). */}
          {tab === 'ranking' ? <RankingTab key="ranking" /> : <HistoryTab key="history" />}
        </div>
        <div className="stack">
          <Button onClick={() => navigate('menu')}>Main Menu</Button>
        </div>
      </Panel>
    </main>
  );
}
