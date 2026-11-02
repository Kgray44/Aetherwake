import type { WebGLRenderer } from "three";
import type { Snapshot } from "./types.ts";

export type Vector3 = { x: number; y: number; z: number };
export type SpatialCamera = {
  target: Vector3;
  yaw: number;
  pitch: number;
  distance: number;
  mode: "orbit" | "pan";
  sensitivity: number;
  neighborhood?: string;
  presentation?: "spatial" | "list";
};
export type SpatialRenderFrame = {
  width: number;
  height: number;
  time: number;
  quality: "cinematic" | "balanced" | "efficient";
  reduced: boolean;
  quiet: boolean;
};
/** Host renders between celestial background and foreground Vela, one context/RAF. */
export interface SpatialRenderLayer {
  readonly active: boolean;
  render(renderer: WebGLRenderer, frame: SpatialRenderFrame): void;
  contextLost?(): void;
  contextRestored?(): void;
  dispose?(): void;
}
export type GraphAction =
  | { type: "attach"; workspaceId: string; resourceId: string }
  | { type: "createProject"; title: string }
  | { type: "createWorkspace"; title: string; projectId: string | null }
  | {
      type: "createResource";
      title: string;
      kind: string;
      workspaceId: string;
      provider?: "local" | "codex";
    }
  | {
      type: "archive";
      kind: "project" | "workspace" | "resource";
      id: string;
      expectedVersion: number;
    }
  | { type: "detach"; blockId: string; expectedVersion: number }
  | { type: "relate"; sourceId: string; targetId: string; kind: string }
  | { type: "unrelate"; relationshipId: string }
  | {
      type: "branch";
      resourceId: string;
      messageId: string;
      includeMessageIds: string[];
      title: string;
      providerId: string;
      tokenBudget: number;
      workspaceId?: string;
    };
export type GraphCapabilities = Partial<Record<GraphAction["type"], boolean>>;
export type GraphActions = {
  graphAction?(action: GraphAction): Promise<Snapshot>;
  capabilities?: GraphCapabilities;
};
