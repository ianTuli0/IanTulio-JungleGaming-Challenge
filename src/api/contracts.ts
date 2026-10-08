// REST contracts shared by the Axios client and the MSW handlers.
import { validateSettings, type EndReason, type MatchSettings } from '../game/config.ts';

export type { EndReason };

/** The comparable part of a match configuration (ranking "leagues"). */
export type MatchConfigSummary = MatchSettings;

/** One completed match. `matchId` is generated client-side and doubles as idempotency key. */
export interface MatchRecord {
  matchId: string;
  playerId: string;
  /** Name the player chose for the ranking; empty when the match is not ranked. */
  playerName: string;
  /** Only ranked matches appear in the ranking; every match appears in the player's history. */
  ranked: boolean;
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
  ranking: '/api/ranking', // ranked matches only
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

/** Ranking names: 2–16 letters, digits, spaces, dots, apostrophes, hyphens or underscores. */
export const CAPTAIN_NAME = { min: 2, max: 16 };
export const isValidCaptainName = (name: string) =>
  name.length >= CAPTAIN_NAME.min && name.length <= CAPTAIN_NAME.max && /^[\p{L}\p{N} .'_-]+$/u.test(name) && name.trim() === name;

export function isMatchRecord(v: unknown): v is MatchRecord {
  const r = v as MatchRecord;
  return (
    !!r &&
    typeof r.matchId === 'string' &&
    typeof r.playerId === 'string' &&
    typeof r.playerName === 'string' &&
    typeof r.ranked === 'boolean' &&
    (r.ranked ? isValidCaptainName(r.playerName) : r.playerName === '') &&
    typeof r.playedAt === 'string' &&
    Number.isFinite(Date.parse(r.playedAt)) &&
    Number.isInteger(r.score) &&
    r.score >= 0 &&
    Number.isFinite(r.durationMs) &&
    r.durationMs >= 0 &&
    (r.endReason === 'time-up' || r.endReason === 'destroyed') &&
    !!r.config &&
    Object.keys(validateSettings(r.config)).length === 0 &&
    r.durationMs <= r.config.sessionSeconds * 1000 + 1000 // a match never outlasts its session
  );
}
