// REST mock of the ranking/history API. Same handlers for dev, the published demo and tests.
import { delay, http, HttpResponse } from 'msw';
import { API_BASE_URL, API_TIMEOUT_MS } from '../api/client.ts';
import { PAGE_SIZE, compareRanking, isMatchRecord, type ApiErrorBody, type MatchRecord, type Page } from '../api/contracts.ts';
import { createRng } from '../rng.ts';
import { storage } from '../store.ts';
import { buildFixtures } from './fixtures.ts';
import { MOCK_DB_KEY, scenarioStore } from './scenarios.ts';

const FIXTURES = buildFixtures();
let manyPages: MatchRecord[] | null = null;

const db = {
  confirmed: () => storage.read(MOCK_DB_KEY, (v) => (Array.isArray(v) ? v.filter(isMatchRecord) : null)) ?? [],
  all(): MatchRecord[] {
    const fixtures = scenarioStore.get().id === 'many-pages' ? (manyPages ??= buildFixtures(60)) : FIXTURES;
    return [...fixtures, ...this.confirmed()];
  },
  find: (matchId: string) => db.confirmed().find((r) => r.matchId === matchId),
  insert: (record: MatchRecord) => storage.write(MOCK_DB_KEY, [...db.confirmed(), record]),
};

// Latency jitter is seeded per scenario so runs are reproducible.
let rng = createRng(scenarioStore.get().seed);
let requestCount = 0;
const answeredLate = new Set<string>();
scenarioStore.subscribe(() => {
  rng = createRng(scenarioStore.get().seed);
  requestCount = 0;
  answeredLate.clear();
});

const LATE = API_TIMEOUT_MS + 3000;

function latency(): Promise<void> {
  const { id } = scenarioStore.get();
  const n = requestCount++;
  const ms =
    id === 'slow' ? 2500 + rng() * 1000
    : id === 'variable-latency' ? 100 + rng() * 2400
    : id === 'out-of-order' ? (n % 2 === 0 ? 2200 : 200)
    : id === 'timeout' ? LATE
    : 120 + rng() * 260;
  return delay(ms);
}

const fail = (status: number, error: string, message: string) => HttpResponse.json<ApiErrorBody>({ error, message }, { status });

function scenarioFailure(resource: 'ranking' | 'history' | 'save') {
  switch (scenarioStore.get().id) {
    case 'network-error':
      return HttpResponse.error();
    case 'server-error':
      return fail(500, 'internal', 'Simulated server failure.');
    case 'client-error':
      return fail(400, 'bad-request', 'Simulated client error.');
    case 'ranking-down':
      return resource === 'ranking' ? fail(503, 'unavailable', 'Ranking service unavailable.') : null;
    case 'history-down':
      return resource === 'history' ? fail(503, 'unavailable', 'History service unavailable.') : null;
    case 'submit-unavailable':
      return resource === 'save' ? fail(503, 'unavailable', 'Match registry unavailable.') : null;
    default:
      return null;
  }
}

function paginate<T>(rows: T[], params: URLSearchParams): Page<T> {
  const pageSize = Math.min(50, Math.max(1, Number(params.get('pageSize')) || PAGE_SIZE));
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(totalPages, Math.max(1, Math.floor(Number(params.get('page')) || 1)));
  return { items: rows.slice((page - 1) * pageSize, page * pageSize), page, pageSize, totalItems: rows.length, totalPages };
}

export const handlers = [
  http.get(`${API_BASE_URL}/api/ranking`, async ({ request }) => {
    await latency();
    const failure = scenarioFailure('ranking');
    if (failure) return failure;
    const params = new URL(request.url).searchParams;
    const session = Number(params.get('sessionSeconds'));
    const spawn = Number(params.get('spawnIntervalSeconds'));
    if (!session || !spawn) return fail(400, 'bad-request', 'sessionSeconds and spawnIntervalSeconds are required.');
    const rows =
      scenarioStore.get().id === 'empty'
        ? []
        : db
            .all()
            .filter((r) => r.ranked && r.config.sessionSeconds === session && r.config.spawnIntervalSeconds === spawn)
            .sort(compareRanking)
            .map((r, i) => ({ ...r, rank: i + 1 }));
    return HttpResponse.json(paginate(rows, params));
  }),

  http.get(`${API_BASE_URL}/api/players/:playerId/matches`, async ({ request, params }) => {
    await latency();
    const failure = scenarioFailure('history');
    if (failure) return failure;
    const rows =
      scenarioStore.get().id === 'empty'
        ? []
        : db
            .all()
            .filter((r) => r.playerId === params.playerId)
            .sort((a, b) => b.playedAt.localeCompare(a.playedAt) || a.matchId.localeCompare(b.matchId));
    return HttpResponse.json(paginate(rows, new URL(request.url).searchParams));
  }),

  http.put(`${API_BASE_URL}/api/matches/:matchId`, async ({ request, params }) => {
    const failure = scenarioFailure('save');
    if (failure) {
      await latency();
      return failure;
    }
    const body: unknown = await request.json().catch(() => null);
    if (!isMatchRecord(body) || body.matchId !== params.matchId) {
      await latency();
      return fail(400, 'invalid-record', 'The match record is incomplete or does not match the URL.');
    }
    // Idempotency: a re-sent match returns what is already stored.
    const existing = db.find(body.matchId);
    if (existing) {
      await latency();
      return HttpResponse.json(existing, { status: 200 });
    }
    db.insert(body);
    if (scenarioStore.get().id === 'submit-timeout' && !answeredLate.has(body.matchId)) {
      answeredLate.add(body.matchId);
      await delay(LATE); // stored, but the client gives up first
    } else {
      await latency();
    }
    return HttpResponse.json(body, { status: 201 });
  }),
];
