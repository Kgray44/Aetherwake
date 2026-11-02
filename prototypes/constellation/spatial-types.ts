import type { PerspectiveCamera, WebGLRenderer } from "three";
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
export type SpatialScreenBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};
/** Last drawn conservative body envelope, not a raster occlusion mask. */
export type SpatialBodyProjection = {
  key: string;
  kind: "project" | "workspace" | "resource";
  resourceId?: string;
  center: { x: number; y: number };
  radius: number;
  bounds: SpatialScreenBounds;
  clippedBounds: SpatialScreenBounds;
  viewport: { left: number; top: number; width: number; height: number };
};
/** Host renders between celestial background and foreground Vela, one context/RAF. */
export interface SpatialRenderLayer {
  readonly active: boolean;
  /** Borrow the existing current camera before world passes, including working
   * views where graph bodies are inactive. Width/height are CSS pixels. The
   * caller reads this object; it must not mutate its pose or own another clock. */
  prepareCelestialCamera?(
    width: number,
    height: number,
  ): PerspectiveCamera | null;
  screenBodyProjection?(key: string): SpatialBodyProjection | null;
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
