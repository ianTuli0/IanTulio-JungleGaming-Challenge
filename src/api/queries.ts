// TanStack Query layer: ranking/history queries and the match registration queue.
import { QueryClient, keepPreviousData, useMutation, useMutationState, useQuery } from '@tanstack/react-query';
import { useEffect, useEffectEvent } from 'react';
import type { MatchOutcome } from '../game/controller.ts';
import { player, saveLastResult, uuid } from '../settings.ts';
import { createStore, storage, useStore } from '../store.ts';
import { fetchHistory, fetchRanking, isRetryable, putMatch } from './client.ts';
import { isMatchRecord, type MatchConfigSummary, type MatchRecord } from './contracts.ts';

const SUBMIT_KEY = ['submit-match'];
const PENDING_KEY = 'pirate-battle:pending-matches';
const AUTO_SYNC_MS = 20_000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failures, error) => failures < 2 && isRetryable(error),
      retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 4000),
      staleTime: 10_000,
    },
  },
});

// -- reads --------------------------------------------------------------------------

export function useRanking(config: MatchConfigSummary, page: number) {
  return useQuery({
    queryKey: ['ranking', config.sessionSeconds, config.spawnIntervalSeconds, page],
    // The signal aborts superseded requests, so a late answer never lands on newer data.
    queryFn: ({ signal }) => fetchRanking(config, page, signal),
    placeholderData: keepPreviousData,
    refetchOnMount: 'always', // refresh whenever the tab is shown again
  });
}

export function useHistory(page: number) {
  return useQuery({
    queryKey: ['history', player.id, page],
    queryFn: ({ signal }) => fetchHistory(player.id, page, signal),
    placeholderData: keepPreviousData,
    refetchOnMount: 'always',
  });
}

// -- registration -------------------------------------------------------------------

/** Completed matches not yet confirmed by the server. Persisted, so they survive a refresh. */
export const pendingStore = createStore<MatchRecord[]>(
  storage.read(PENDING_KEY, (v) => (Array.isArray(v) ? v.filter(isMatchRecord) : null)) ?? [],
);
pendingStore.subscribe(() => storage.write(PENDING_KEY, pendingStore.get()));

/** One request per match at a time, however many callers (auto-sync, Retry clicks) ask. */
const inFlight = new Map<string, Promise<MatchRecord>>();
function submitOnce(record: MatchRecord): Promise<MatchRecord> {
  let request = inFlight.get(record.matchId);
  if (!request) {
    request = putMatch(record).finally(() => inFlight.delete(record.matchId));
    inFlight.set(record.matchId, request);
  }
  return request;
}

queryClient.setMutationDefaults(SUBMIT_KEY, {
  mutationFn: (record: MatchRecord) => submitOnce(record),
  retry: (failures, error) => failures < 3 && isRetryable(error),
  retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
  onSuccess: (saved: MatchRecord) => {
    pendingStore.set(pendingStore.get().filter((r) => r.matchId !== saved.matchId));
    void queryClient.invalidateQueries({ queryKey: ['ranking'] });
    void queryClient.invalidateQueries({ queryKey: ['history'] });
  },
});

export const useSubmitMatch = () => useMutation<MatchRecord, Error, MatchRecord>({ mutationKey: SUBMIT_KEY });

const isFor = (matchId: string) => (m: { state: { variables?: unknown } }) => (m.state.variables as MatchRecord | undefined)?.matchId === matchId;

/** Turns a finished match into a record: persisted locally first, then queued for the server. */
export function recordMatch(outcome: MatchOutcome): MatchRecord {
  const record: MatchRecord = {
    matchId: uuid(),
    playerId: player.id,
    playerName: player.name,
    playedAt: new Date().toISOString(),
    score: outcome.score,
    durationMs: outcome.durationMs,
    endReason: outcome.endReason,
    config: outcome.settings,
  };
  saveLastResult(record);
  pendingStore.set([...pendingStore.get(), record]);
  return record;
}

export type SubmissionState =
  | { status: 'saved' }
  | { status: 'saving'; attempt: number }
  | { status: 'queued' }
  | { status: 'failed'; error: unknown };

export function useSubmissionState(matchId: string): SubmissionState {
  const pending = useStore(pendingStore).some((r) => r.matchId === matchId);
  const states = useMutationState({ filters: { mutationKey: SUBMIT_KEY, predicate: isFor(matchId) }, select: (m) => m.state });
  const last = states.at(-1);
  if (!pending) return { status: 'saved' };
  if (last?.status === 'pending') return { status: 'saving', attempt: last.failureCount + 1 };
  if (last?.status === 'error') return { status: 'failed', error: last.error };
  return { status: 'queued' };
}

/** Mounted once: submits new records, recovers the ones left from a previous session, retries periodically. */
export function usePendingSync(): void {
  const pending = useStore(pendingStore);
  const { mutate } = useSubmitMatch();
  const sync = useEffectEvent(() => {
    for (const record of pendingStore.get()) {
      if (!queryClient.isMutating({ mutationKey: SUBMIT_KEY, predicate: isFor(record.matchId) })) mutate(record);
    }
  });
  useEffect(() => sync(), [pending]);
  useEffect(() => {
    const timer = window.setInterval(() => sync(), AUTO_SYNC_MS);
    const online = () => sync();
    window.addEventListener('online', online);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', online);
    };
  }, []);
}
