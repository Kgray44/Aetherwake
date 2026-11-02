import type { SpatialCamera, Vector3 } from "./spatial-types.ts";
/** Structural subset of aerynth.desktop@1. Content is never persisted by this layer. */
export type Visibility = { visible?: boolean; available?: boolean };
export type Snapshot = {
  projects: ({ id: string; title: string; version?: number } & Visibility)[];
  workspaces: ({
    id: string;
    project_id: string | null;
    title: string;
    version?: number;
  } & Visibility)[];
  resources: ({
    id: string;
    title: string;
    kind: string;
    version?: number;
    project_id?: string | null;
    provider?: string;
    providerId?: string;
    messages?: { id: string; role: string; content?: string }[];
  } & Visibility)[];
  blocks: ({
    id: string;
    workspace_id: string;
    resource_id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    z: number;
    version?: number;
  } & Visibility)[];
  relationships: ({
    id: string;
    source_id: string;
    target_id: string;
    kind: string;
    provenance: string;
    created_at?: string;
    evidenceRef?: string;
    freshness?: string;
  } & Visibility)[];
  activeWorkspaceId: string | null;
  navigation?: Destination;
  conversationBranches?: ({
    parentResourceId: string;
    childResourceId: string;
    sourceMessageId: string;
    mode: string;
    createdAt?: string;
  } & Visibility)[];
};
export type Destination =
  | { kind: "workspace"; workspaceId: string }
  | { kind: "constellation"; projectId: string | null };
export type Location =
  | { kind: "universe" }
  | { kind: "project"; projectId: string }
  | { kind: "workspace"; workspaceId: string }
  | {
      kind: "surface";
      workspaceId: string;
      resourceId: string;
      blockId: string;
    };
export type Point = { x: number; y: number };
export type Anchor = Point & {
  spatial?: Vector3;
  pinned?: boolean;
  rotation?: number;
};
export type Camera = Point & { zoom: number };
export type Node = {
  key: string;
  id: string;
  kind: "project" | "workspace" | "resource";
  title: string;
  parent: string | null;
  available: boolean;
  point: Point;
  resourceId?: string;
  resourceKind?: string;
  workspaceId?: string;
};
export type Bookmark = {
  camera: Camera;
  selected: string | null;
  spatial?: SpatialCamera;
};
export type ViewState = {
  schema: "aerynth.constellation@1";
  anchors: Record<string, Anchor>;
  bookmarks: Record<string, Bookmark>;
  location: Location;
  history: { location: Location; bookmark: Bookmark }[];
};
/** Save only view state; implement in the host's private, canonical persistence. */
export type ViewPersistence = {
  load(): Promise<unknown>;
  save(state: ViewState): Promise<void>;
};
export type Policy = {
  tier: "cinematic" | "balanced" | "efficient";
  reduced: boolean;
  quiet: boolean;
  hidden: boolean;
  graphicsAvailable: boolean;
};
export type Transition = {
  from: Location;
  to: Location;
  origin: Point;
  camera: Camera;
  /** Optional absolute client position of a perspective-projected destination. */
  screenOrigin?: Point;
};
