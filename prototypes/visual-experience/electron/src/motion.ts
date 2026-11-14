import type { Quality } from "./types";

export type Discipline =
  | "spatial"
  | "material"
  | "atmospheric"
  | "semantic"
  | "interaction"
  | "performance";
export interface MotionRecord {
  id: number;
  discipline: Discipline;
  resourceId: string;
  intent: string;
  quality: Quality;
  reduced: boolean;
  startedAtMs: number;
  endedAtMs?: number;
  outcome?: "completed" | "interrupted" | "skipped";
}

export class MotionCoordinator {
  private sequence = 0;
  private quality: Quality = "cinematic";
  private reduced = false;
  private active = new Map<string, Animation>();
  private records: MotionRecord[] = [];
  setPolicy(quality: Quality, reduced: boolean) {
    this.quality = quality;
    this.reduced = reduced;
    this.note(
      "performance",
      "scene",
      `${quality}/${reduced ? "reduced" : "motion"}`,
    );
  }
  note(discipline: Discipline, resourceId: string, intent: string) {
    const record: MotionRecord = {
      id: ++this.sequence,
      discipline,
      resourceId,
      intent,
      quality: this.quality,
      reduced: this.reduced,
      startedAtMs: performance.now(),
      endedAtMs: performance.now(),
      outcome: "completed",
    };
    this.push(record);
    return record.id;
  }
  animate(
    discipline: Discipline,
    resourceId: string,
    intent: string,
    element: HTMLElement,
    frames: Keyframe[],
    durationMs: number,
    onFinish: () => void,
  ) {
    const key = `${discipline}:${resourceId}`;
    this.active.get(key)?.cancel();
    const record: MotionRecord = {
      id: ++this.sequence,
      discipline,
      resourceId,
      intent,
      quality: this.quality,
      reduced: this.reduced,
      startedAtMs: performance.now(),
    };
    this.push(record);
    if (this.reduced) {
      onFinish();
      record.endedAtMs = performance.now();
      record.outcome = "skipped";
      return;
    }
    const duration =
      this.quality === "efficient" ? durationMs * 0.6 : durationMs;
    const animation = element.animate(frames, {
      duration,
      easing: "cubic-bezier(.22,.78,.19,1)",
    });
    this.active.set(key, animation);
    animation.onfinish = () => {
      if (this.active.get(key) === animation) this.active.delete(key);
      onFinish();
      record.endedAtMs = performance.now();
      record.outcome = "completed";
    };
    animation.oncancel = () => {
      if (this.active.get(key) === animation) this.active.delete(key);
      record.endedAtMs = performance.now();
      record.outcome = "interrupted";
    };
  }
  snapshot() {
    return this.records.slice(-60).map((record) => ({ ...record }));
  }
  private push(record: MotionRecord) {
    this.records.push(record);
    if (this.records.length > 300) this.records.shift();
  }
  dispose() {
    for (const animation of this.active.values()) animation.cancel();
    this.active.clear();
  }
}
