import { createFilaments, createParticles } from './fixtures';

export type VelaState = 'idle' | 'working' | 'attention' | 'unavailable';
export type Quality = 'cinematic' | 'balanced' | 'efficient';
export type MotionDomain = 'spatial' | 'material' | 'atmospheric' | 'semantic' | 'interaction' | 'performance';
export type MotionEvent = { domain: MotionDomain; name: string; at: number; resourceId?: string };
export type FrameStats = { count: number; medianMs: number | null; p95Ms: number | null; p99Ms: number | null; missedFrames: number; targetIntervalMs: number; elapsedMs: number; visibility: DocumentVisibilityState };

/** High-frequency canvas work lives here, apart from ordinary DOM state. */
export class MotionCoordinator {
  readonly disciplines: readonly MotionDomain[] = ['spatial', 'material', 'atmospheric', 'semantic', 'interaction', 'performance'];
  readonly events: MotionEvent[] = [];
  quality: Quality = 'cinematic';
  reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  paused = false;
  vela: VelaState = 'idle';
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private particles = createParticles();
  private filaments = createFilaments();
  private raf = 0;
  private timer = 0;
  private lastFrame = 0;
  private intervals: number[] = [];
  private started = performance.now();
  private previousVisibility: DocumentVisibilityState = document.visibilityState;

  constructor() {
    document.addEventListener('visibilitychange', () => {
      this.record('performance', document.visibilityState === 'hidden' ? 'suspend-hidden' : 'resume-visible');
      this.previousVisibility = document.visibilityState;
      this.restart();
    });
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', event => {
      this.setReduced(event.matches);
    });
  }

  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d', { alpha: true });
    this.restart();
  }

  record(domain: MotionDomain, name: string, resourceId?: string) {
    this.events.push({ domain, name, at: performance.now(), resourceId });
    if (this.events.length > 120) this.events.shift();
  }

  setVela(state: VelaState) {
    if (this.vela === state) return;
    this.vela = state;
    this.record('semantic', `vela-${state}`);
    document.documentElement.dataset.vela = state;
  }

  setQuality(quality: Quality) {
    this.quality = quality;
    this.record('performance', `quality-${quality}`);
    document.documentElement.dataset.quality = quality;
    this.restart();
  }

  setReduced(reduced: boolean) {
    this.reduced = reduced;
    this.record('performance', reduced ? 'reduced-motion' : 'motion-enabled');
    document.documentElement.dataset.reduced = String(reduced);
    this.restart();
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    this.record('performance', paused ? 'ambient-paused' : 'ambient-resumed');
    this.restart();
  }

  resetStats() { this.intervals = []; this.started = performance.now(); this.lastFrame = 0; }

  stats(): FrameStats {
    const sorted = [...this.intervals].sort((a, b) => a - b);
    const at = (p: number) => sorted.length ? Number(sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)].toFixed(2)) : null;
    // Nominal tier target, not a measured display refresh rate.
    const budget = this.quality === 'cinematic' ? 1000 / 60 : this.quality === 'balanced' ? 1000 / 30 : 1000 / 12;
    return { count: sorted.length, medianMs: at(.5), p95Ms: at(.95), p99Ms: at(.99),
      missedFrames: sorted.reduce((sum, ms) => sum + Math.max(0, Math.round(ms / budget) - 1), 0), targetIntervalMs: Number(budget.toFixed(2)),
      elapsedMs: Math.round(performance.now() - this.started), visibility: this.previousVisibility };
  }

  private restart() {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timer);
    this.lastFrame = 0;
    if (!this.canvas || !this.context) return;
    this.draw(performance.now(), true);
    if (!this.reduced && !this.paused && document.visibilityState === 'visible') this.schedule();
  }

  private schedule() {
    const tick = () => { this.raf = requestAnimationFrame(now => {
      if (this.lastFrame) {
        this.intervals.push(now - this.lastFrame);
        if (this.intervals.length > 2400) this.intervals.shift();
      }
      this.lastFrame = now;
      this.draw(now, false);
      if (!this.reduced && !this.paused && document.visibilityState === 'visible') this.schedule();
    }); };
    if (this.quality === 'cinematic') tick();
    else this.timer = window.setTimeout(tick, this.quality === 'balanced' ? 16 : 66);
  }

  private draw(now: number, still: boolean) {
    const canvas = this.canvas, ctx = this.context;
    if (!canvas || !ctx) return;
    const box = canvas.getBoundingClientRect();
    const ratio = Math.min(devicePixelRatio || 1, this.quality === 'cinematic' ? 2 : 1.5);
    const width = Math.max(1, Math.round(box.width * ratio));
    const height = Math.max(1, Math.round(box.height * ratio));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    ctx.clearRect(0, 0, width, height);
    const count = this.quality === 'cinematic' ? 200 : this.quality === 'balanced' ? 100 : 36;
    const t = still ? 0 : now;
    for (let i = 0; i < count; i++) {
      const p = this.particles[i];
      const x = ((p.x + t * p.speed * .0001) % 1) * width;
      const y = (p.y + Math.sin(t * .00024 + p.phase) * .012) * height;
      ctx.beginPath(); ctx.arc(x, y, p.r * ratio, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(189,201,255,${p.alpha})`; ctx.fill();
    }
    if (this.quality === 'efficient') return;
    ctx.lineWidth = .7 * ratio;
    for (const f of this.filaments) {
      const drift = Math.sin(t * .00019 + f.phase) * .012;
      const x = (f.x + drift) * width, y = f.y * height;
      const gradient = ctx.createLinearGradient(x, y, x + f.length * width, y + f.bend * height);
      gradient.addColorStop(0, 'rgba(140,154,246,0)');
      gradient.addColorStop(.5, 'rgba(151,173,255,.13)');
      gradient.addColorStop(1, 'rgba(170,145,255,0)');
      ctx.strokeStyle = gradient;
      ctx.beginPath(); ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + f.length * width * .3, y - 22 * ratio,
        x + f.length * width * .7, y + f.bend * height + 14 * ratio,
        x + f.length * width, y + f.bend * height);
      ctx.stroke();
    }
  }
}

export const motion = new MotionCoordinator();
