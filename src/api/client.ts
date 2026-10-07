import axios, { isAxiosError } from 'axios';
import { PAGE_SIZE, endpoints, type MatchConfigSummary, type MatchRecord, type Page, type RankingEntry } from './contracts.ts';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
export const API_TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS) || 5000;

export const http = axios.create({ baseURL: API_BASE_URL, timeout: API_TIMEOUT_MS });

export async function fetchRanking(config: MatchConfigSummary, page: number, signal?: AbortSignal): Promise<Page<RankingEntry>> {
  const { data } = await http.get<Page<RankingEntry>>(endpoints.ranking, { params: { ...config, page, pageSize: PAGE_SIZE }, signal });
  return data;
}

export async function fetchHistory(playerId: string, page: number, signal?: AbortSignal): Promise<Page<MatchRecord>> {
  const { data } = await http.get<Page<MatchRecord>>(endpoints.playerMatches(playerId), { params: { page, pageSize: PAGE_SIZE }, signal });
  return data;
}

/** Idempotent: re-sending a stored match returns the existing record (200) instead of duplicating it. */
export async function putMatch(record: MatchRecord): Promise<MatchRecord> {
  const { data } = await http.put<MatchRecord>(endpoints.match(record.matchId), record);
  return data;
}

/** Timeouts, connection failures, 5xx and 429 are worth retrying; other 4xx are not. */
export function isRetryable(error: unknown): boolean {
  if (!isAxiosError(error) || error.code === 'ERR_CANCELED') return false;
  const status = error.response?.status;
  return status === undefined || status >= 500 || status === 429;
}

export function describeError(error: unknown): string {
  if (!isAxiosError(error)) return 'Something went wrong.';
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') return 'The server took too long to answer.';
  if (!error.response) return 'Could not reach the server.';
  return `The server answered with an error (HTTP ${error.response.status}).`;
}
