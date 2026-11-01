import type { RendererCommand } from "../src-electron/comparison-contract";

export interface Message {
  id: string;
  author: string;
  topic: string;
  time: string;
  text: string;
}
export interface ActivityEvent {
  id: string;
  kind: string;
  time: string;
  text: string;
}
export interface Fixture {
  seed: number;
  synthetic: boolean;
  messages: Message[];
  events: ActivityEvent[];
}
export type VelaState =
  | "idle"
  | "working"
  | "attention required"
  | "unavailable";
export type Quality = "cinematic" | "balanced" | "efficient";
export interface LabBridge {
  detachBlock(id: string): Promise<boolean>;
  closeDetached(): Promise<void>;
  environment(): Promise<Record<string, unknown> | null>;
  capture(name: "expanded"): Promise<boolean>;
  backgroundProbe(): Promise<{
    hiddenDurationMs: number;
    visibleAfter: boolean;
  } | null>;
  benchmarkReport(report: unknown): Promise<boolean>;
  comparisonReady(marker: Record<string, unknown>): Promise<boolean>;
}
declare global {
  interface Window {
    aerynthLab: LabBridge;
    __lab?: { runBenchmark: () => Promise<unknown> };
    __labComparison?: {
      dispatch: (
        command: RendererCommand,
        actionId: string,
      ) => Promise<unknown>;
    };
  }
}
