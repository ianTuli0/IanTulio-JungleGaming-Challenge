// Other captains, generated deterministically so every environment sees the same data.
import type { MatchRecord } from '../api/contracts.ts';
import { createRng } from '../rng.ts';

const CAPTAINS = [
  'Captain Flint', 'Red Sparrow', 'Storm Rider', 'Sea Wolf', 'Anne Bonny', 'Calico Jack', 'Mary Read', "Grace O'Malley",
  'Black Bart', 'Ching Shih', 'Henry Morgan', 'Stede Bonnet', 'Salty Pete', 'Iron Hook', 'Barbarossa', 'Long Ben',
];

/** Leagues = configurations; ranking only compares matches inside one league. */
const LEAGUES = [
  { sessionSeconds: 120, spawnIntervalSeconds: 3, count: 14 },
  { sessionSeconds: 60, spawnIntervalSeconds: 3, count: 6 },
  { sessionSeconds: 180, spawnIntervalSeconds: 3, count: 8 },
  { sessionSeconds: 120, spawnIntervalSeconds: 2, count: 5 },
  { sessionSeconds: 90, spawnIntervalSeconds: 1.5, count: 4 },
];

const BASE_TIME = Date.parse('2026-09-08T22:00:00Z');

export function buildFixtures(extraPerLeague = 0): MatchRecord[] {
  const rng = createRng(2024 + extraPerLeague);
  const records: MatchRecord[] = [];
  let n = 0;
  for (const league of LEAGUES) {
    for (let i = 0; i < league.count + extraPerLeague; i++) {
      const name = CAPTAINS[Math.floor(rng() * CAPTAINS.length)];
      const survived = rng() < 0.65;
      const duration = survived ? league.sessionSeconds : Math.round(league.sessionSeconds * (0.35 + rng() * 0.6));
      const pace = (3 / league.spawnIntervalSeconds) * (0.08 + rng() * 0.14);
      records.push({
        matchId: `fixture-${String(++n).padStart(4, '0')}`,
        playerId: `fixture-${name.toLowerCase().replace(/[^a-z]+/g, '-')}`,
        playerName: name,
        playedAt: new Date(BASE_TIME - n * 47 * 60_000).toISOString(),
        score: Math.round(duration * pace),
        durationMs: duration * 1000,
        endReason: survived ? 'time-up' : 'destroyed',
        config: { sessionSeconds: league.sessionSeconds, spawnIntervalSeconds: league.spawnIntervalSeconds },
      });
    }
  }
  return records;
}
