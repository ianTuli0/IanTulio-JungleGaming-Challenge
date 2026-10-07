// Opt-in frame statistics (`?perf` in the URL). Used for PERFORMANCE.md.
export interface PerfReport {
  seconds: number;
  frames: number;
  avgFps: number;
  p95FrameMs: number;
  p99FrameMs: number;
  maxFrameMs: number;
  avgEntities: number;
  peakEntities: number;
  peakEffects: number;
}

declare global {
  interface Window {
    __pirateBattlePerf?: PerfReport[];
  }
}

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
const round = (n: number) => Math.round(n * 100) / 100;

export class PerfMonitor {
  private readonly frames: number[] = [];
  private entitySum = 0;
  private peakEntities = 0;
  private peakEffects = 0;
  private sinceUpdate = 0;
  private readonly overlay: HTMLElement;

  constructor(host: HTMLElement) {
    this.overlay = document.createElement('pre');
    this.overlay.className = 'perf-overlay';
    this.overlay.setAttribute('aria-hidden', 'true');
    host.appendChild(this.overlay);
  }

  /** One sample per rendered frame of active play. */
  record(frameMs: number, entities: number, effects: number): void {
    this.frames.push(frameMs);
    this.entitySum += entities;
    this.peakEntities = Math.max(this.peakEntities, entities);
    this.peakEffects = Math.max(this.peakEffects, effects);
    this.sinceUpdate += frameMs;
    if (this.sinceUpdate < 500) return;
    this.sinceUpdate = 0;
    const recent = this.frames.slice(-120).sort((a, b) => a - b);
    const avg = recent.reduce((s, v) => s + v, 0) / recent.length;
    this.overlay.textContent = `${(1000 / avg).toFixed(0)} fps · p95 ${percentile(recent, 0.95).toFixed(1)} ms · ${entities} entities · ${effects} fx`;
  }

  report(): PerfReport {
    const sorted = [...this.frames].sort((a, b) => a - b);
    const total = this.frames.reduce((s, v) => s + v, 0);
    const report: PerfReport = {
      seconds: round(total / 1000),
      frames: this.frames.length,
      avgFps: round((this.frames.length * 1000) / (total || 1)),
      p95FrameMs: round(percentile(sorted, 0.95)),
      p99FrameMs: round(percentile(sorted, 0.99)),
      maxFrameMs: round(sorted.at(-1) ?? 0),
      avgEntities: round(this.entitySum / (this.frames.length || 1)),
      peakEntities: this.peakEntities,
      peakEffects: this.peakEffects,
    };
    (window.__pirateBattlePerf ??= []).push(report);
    console.info('[perf]', report);
    return report;
  }

  destroy(): void {
    this.overlay.remove();
  }
}
