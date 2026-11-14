import type { Quality } from "./types";

type Point = {
  x: number;
  y: number;
  speed: number;
  phase: number;
  size: number;
};
function seeded(seed: number) {
  let n = seed >>> 0;
  return () => (n = (Math.imul(1664525, n) + 1013904223) >>> 0) / 4294967296;
}
export class Atmosphere {
  private ctx: CanvasRenderingContext2D;
  private points: Point[] = [];
  private frame = 0;
  private draws = 0;
  private last = 0;
  private active = true;
  private quality: Quality = "cinematic";
  private reduced = false;
  private fixedHz: number | null = null;
  private width = 1;
  private height = 1;
  private ro: ResizeObserver;
  private listener = () => {
    this.active = !document.hidden;
    if (!this.active) {
      cancelAnimationFrame(this.frame);
      clearTimeout(this.frame);
    } else this.tick(performance.now());
  };
  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw Error("2D canvas unavailable");
    this.ctx = ctx;
    const next = seeded(20261101);
    this.points = Array.from({ length: 200 }, () => ({
      x: next(),
      y: next(),
      speed: 0.2 + next() * 0.8,
      phase: next() * Math.PI * 2,
      size: 0.5 + next() * 1.3,
    }));
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    document.addEventListener("visibilitychange", this.listener);
    this.tick(performance.now());
  }
  setMode(quality: Quality, reduced: boolean, fixedHz: number | null = null) {
    cancelAnimationFrame(this.frame);
    clearTimeout(this.frame);
    this.quality = quality;
    this.reduced = reduced;
    this.fixedHz = fixedHz;
    this.last = 0;
    if (this.active) this.tick(performance.now());
  }
  getDrawCount() {
    return this.draws;
  }
  getRenderedSources() {
    return {
      particles:
        this.quality === "efficient"
          ? 48
          : this.quality === "balanced"
            ? 120
            : 200,
      filaments: this.quality === "efficient" ? 4 : 8,
    };
  }
  private resize() {
    const rect = this.canvas.getBoundingClientRect(),
      dpr = Math.min(devicePixelRatio || 1, 2);
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw(performance.now());
  }
  private tick = (time: number) => {
    if (!this.active) return;
    const cadence = this.reduced
      ? 1000
      : this.quality === "efficient"
        ? 100
        : this.quality === "balanced"
          ? 33
          : this.fixedHz
            ? 1000 / this.fixedHz
            : 16;
    if (time - this.last >= cadence) {
      this.last =
        this.fixedHz && !this.reduced && this.quality === "cinematic"
          ? this.last + Math.floor((time - this.last) / cadence) * cadence
          : time;
      this.draw(time);
    }
    this.frame =
      this.quality === "cinematic" && !this.reduced
        ? requestAnimationFrame(this.tick)
        : window.setTimeout(() => this.tick(performance.now()), cadence);
  };
  private draw(time: number) {
    const { ctx, width: w, height: h } = this;
    this.draws++;
    ctx.clearRect(0, 0, w, h);
    const t = this.reduced ? 0 : time * 0.00016;
    const count =
      this.quality === "efficient"
        ? 48
        : this.quality === "balanced"
          ? 120
          : 200;
    const gradient = ctx.createRadialGradient(
      w * 0.57,
      h * 0.58,
      10,
      w * 0.57,
      h * 0.58,
      w * 0.48,
    );
    gradient.addColorStop(0, "rgba(42,100,132,.13)");
    gradient.addColorStop(0.5, "rgba(14,49,80,.07)");
    gradient.addColorStop(1, "rgba(4,11,20,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) {
      if (this.quality === "efficient" && i % 2) continue;
      const y = h * (0.18 + i * 0.095);
      ctx.beginPath();
      for (let x = 0; x <= w; x += 24) {
        const wave =
          Math.sin(x * 0.005 + i * 0.72 + t * (0.3 + i * 0.03)) * 13 +
          Math.sin(x * 0.013 - i + t * 0.7) * 4;
        const yy = y + wave;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.strokeStyle = `rgba(${i % 2 ? "116,191,208" : "113,157,214"},${0.055 + (i % 3) * 0.018})`;
      ctx.lineWidth = i % 3 === 0 ? 1.2 : 0.7;
      ctx.stroke();
    }
    for (let i = 0; i < count; i++) {
      const p = this.points[i],
        x = p.x * w + Math.sin(t * p.speed + p.phase) * 15,
        y = ((p.y + t * p.speed * 0.018) % 1) * h;
      ctx.beginPath();
      ctx.arc(x, y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(174,221,232,${0.12 + (Math.sin(t * 3 + p.phase) + 1) * 0.12})`;
      ctx.fill();
    }
  }
  dispose() {
    cancelAnimationFrame(this.frame);
    clearTimeout(this.frame);
    this.ro.disconnect();
    document.removeEventListener("visibilitychange", this.listener);
  }
}
