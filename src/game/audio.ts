// Web Audio playback for the WAVs in assets/sounds. Sound is optional:
// any load/decode failure just leaves that sound silent.
const files = import.meta.glob('../../assets/sounds/*.wav', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const URLS = new Map(Object.entries(files).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1, -4), url]));

class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly loops = new Map<string, { source: AudioBufferSourceNode; gain: GainNode }>();
  private readonly wanted = new Map<string, number>();
  private files: Promise<[string, ArrayBuffer | null][]> | null = null;
  private loading = false;
  private muted = false;

  /** Downloads the sound files ahead of time; decoding waits for the first gesture. */
  prefetch(): Promise<[string, ArrayBuffer | null][]> {
    this.files ??= Promise.all(
      [...URLS].map(async ([name, url]): Promise<[string, ArrayBuffer | null]> => {
        try {
          const res = await fetch(url);
          return [name, res.ok ? await res.arrayBuffer() : null];
        } catch {
          return [name, null]; // missing sound: the game stays fully playable
        }
      }),
    );
    return this.files;
  }

  /** Call from a user gesture (autoplay policy): creates the context and starts loading. */
  unlock(): void {
    if (!this.ctx) {
      if (typeof AudioContext === 'undefined') return;
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => undefined);
    if (!this.loading) {
      this.loading = true;
      void this.loadAll(this.ctx);
    }
  }

  private async loadAll(ctx: AudioContext): Promise<void> {
    const files = await this.prefetch();
    await Promise.all(
      files.map(async ([name, data]) => {
        if (!data) return;
        try {
          this.buffers.set(name, await ctx.decodeAudioData(data));
          if (this.wanted.has(name)) this.applyLoop(name);
        } catch {
          // Undecodable file: that sound stays silent.
        }
      }),
    );
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.8;
  }

  play(name: string, volume = 1, rate = 1): void {
    const buffer = this.buffers.get(name);
    if (!this.ctx || !this.master || !buffer || this.ctx.state !== 'running' || this.muted) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(this.master);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
    source.start();
  }

  /** Picks one of `prefix_1..count` for variety. */
  variant(prefix: string, count: number): string {
    return `${prefix}_${1 + Math.floor(Math.random() * count)}`;
  }

  /** Keeps a looping sound at `volume` (0 stops it). */
  setLoop(name: string, volume: number): void {
    if ((this.wanted.get(name) ?? 0) === volume) return;
    if (volume > 0) this.wanted.set(name, volume);
    else this.wanted.delete(name);
    this.applyLoop(name);
  }

  stopLoops(): void {
    for (const name of [...this.wanted.keys()]) this.setLoop(name, 0);
  }

  private applyLoop(name: string): void {
    const volume = this.wanted.get(name) ?? 0;
    const current = this.loops.get(name);
    if (volume <= 0) {
      if (!current) return;
      current.source.stop();
      current.source.disconnect();
      current.gain.disconnect();
      this.loops.delete(name);
      return;
    }
    const buffer = this.buffers.get(name);
    if (!this.ctx || !this.master || !buffer) return;
    if (current) {
      current.gain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.15);
      return;
    }
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(this.master);
    source.start();
    this.loops.set(name, { source, gain });
  }
}

export const audio = new AudioManager();
