// REST contracts shared by the Axios client and the MSW handlers.
import type { EndReason, MatchSettings } from '../game/config.ts';

export type { EndReason };

/** The comparable part of a match configuration (ranking "leagues"). */
export type MatchConfigSummary = MatchSettings;

/** One completed match. `matchId` is generated client-side and doubles as idempotency key. */
export interface MatchRecord {
  matchId: string;
  playerId: string;
  playerName: string;
  /** ISO-8601 time the match ended. */
  playedAt: string;
  score: number;
  /** Effective (unpaused) play time. */
  durationMs: number;
  endReason: EndReason;
  config: MatchConfigSummary;
}

export interface RankingEntry extends MatchRecord {
  rank: number;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface ApiErrorBody {
  error: string;
  message: string;
}

export const PAGE_SIZE = 5;

export const endpoints = {
  /** GET ?sessionSeconds&spawnIntervalSeconds&page&pageSize -> Page<RankingEntry> */
  ranking: '/api/ranking',
  /** GET ?page&pageSize -> Page<MatchRecord>, newest first */
  playerMatches: (playerId: string) => `/api/players/${encodeURIComponent(playerId)}/matches`,
  /** PUT MatchRecord -> 201 created | 200 already stored (idempotent) */
  match: (matchId: string) => `/api/matches/${encodeURIComponent(matchId)}`,
};

/**
 * Deterministic ranking order: score desc, then longer survival, then who got
 * there first, then matchId as the final tie-breaker.
 */
export function compareRanking(a: MatchRecord, b: MatchRecord): number {
  return b.score - a.score || b.durationMs - a.durationMs || a.playedAt.localeCompare(b.playedAt) || a.matchId.localeCompare(b.matchId);
}

export function isMatchRecord(v: unknown): v is MatchRecord {
  const r = v as MatchRecord;
  return (
    !!r &&
    typeof r.matchId === 'string' &&
    typeof r.playerId === 'string' &&
    typeof r.playerName === 'string' &&
    typeof r.playedAt === 'string' &&
    Number.isInteger(r.score) &&
    r.score >= 0 &&
    Number.isFinite(r.durationMs) &&
    r.durationMs >= 0 &&
    (r.endReason === 'time-up' || r.endReason === 'destroyed') &&
    !!r.config &&
    Number.isFinite(r.config.sessionSeconds) &&
    Number.isFinite(r.config.spawnIntervalSeconds)
  );
}
