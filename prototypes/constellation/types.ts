/** Structural subset of aerynth.desktop@1. Content is intentionally absent. */
export type Visibility = { visible?: boolean; available?: boolean };
export type Snapshot = {
  projects: ({ id: string; title: string } & Visibility)[];
  workspaces: ({
    id: string;
    project_id: string | null;
    title: string;
  } & Visibility)[];
  resources: ({ id: string; title: string; kind: string } & Visibility)[];
  blocks: ({
    id: string;
    workspace_id: string;
    resource_id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    z: number;
  } & Visibility)[];
  relationships: ({
    id: string;
    source_id: string;
    target_id: string;
    kind: string;
    provenance: string;
  } & Visibility)[];
  activeWorkspaceId: string | null;
  navigation?: Destination;
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
  workspaceId?: string;
};
export type Bookmark = { camera: Camera; selected: string | null };
export type ViewState = {
  schema: "aerynth.constellation@1";
  anchors: Record<string, Point>;
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
};
