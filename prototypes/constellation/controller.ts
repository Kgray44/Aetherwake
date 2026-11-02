import {
  MotionCoordinator,
  type Pose,
} from "../visual-experience/cinematic-v3/src/motion.ts";
import {
  allowedLocation,
  isLocation,
  keyOf,
  locationNode,
  project,
  scopeOf,
} from "./projection.ts";
import type {
  Anchor,
  Bookmark,
  Camera,
  Destination,
  HistoryEntry,
  Location,
  Node,
  Point,
  Policy,
  SavedView,
  Snapshot,
  Transition,
  ViewPersistence,
  ViewState,
} from "./types.ts";
import {
  validSpatialCamera,
  validVector,
  type SpatialNavigator,
} from "./spatial.ts";
import type { GraphActions, GraphAction } from "./spatial-types.ts";
import type { SpatialCamera } from "./spatial-types.ts";
import type { ResourceOpeningInput } from "../application-contract/resource-opening.ts";

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const viewSaveError = "View could not be saved. Retry before closing.";
const finite = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e8;
const validCamera = (c: unknown): c is Camera =>
  !!c &&
  typeof c === "object" &&
  finite((c as Camera).x) &&
  finite((c as Camera).y) &&
  finite((c as Camera).zoom) &&
  (c as Camera).zoom >= 0.02 &&
  (c as Camera).zoom <= 4;
const pose = (c: Camera): Pose => ({
  x: c.x,
  y: c.y,
  w: c.zoom,
  h: 1,
  lift: 0,
  yaw: 0,
  opacity: 1,
});
const canonicalLocation = (s: Snapshot): Location =>
  s.navigation?.kind === "constellation"
    ? s.navigation.projectId
      ? { kind: "project", projectId: s.navigation.projectId }
      : { kind: "universe" }
    : s.activeWorkspaceId
      ? { kind: "workspace", workspaceId: s.activeWorkspaceId }
      : { kind: "universe" };
export const defaultPolicy: Policy = {
  tier: "balanced",
  reduced: false,
  quiet: false,
  hidden: false,
  graphicsAvailable: true,
};
let serial = 0;
export type ControllerOptions = GraphActions & {
  snapshot: Snapshot;
  motion: MotionCoordinator;
  navigate(target: Destination): Promise<unknown>;
  persistence?: ViewPersistence;
  openResource?(target: ResourceOpeningInput): Promise<unknown>;
  onTransition?(transition: Transition): void;
  onDirty?(): void;
  policy?: Partial<Policy>;
};

export class ConstellationController {
  spatial?: SpatialNavigator;
  readonly motion: MotionCoordinator;
  readonly motionId = `constellation:camera:${++serial}`;
  snapshot: Snapshot;
  nodes = new Map<string, Node>();
  state: ViewState & { future: HistoryEntry[]; savedViews: SavedView[] };
  selected: string | null = null;
  policy: Policy;
  error = "";
  pending = false;
  private generation = 0;
  private resourceOpeningGeneration = 0;
  private listeners = new Set<() => void>();
  private saveChain = Promise.resolve();
  private destroyed = false;
  private options: ControllerOptions;
  private navigationChain: Promise<unknown> = Promise.resolve();
  constructor(options: ControllerOptions) {
    this.options = options;
    this.snapshot = options.snapshot;
    this.motion = options.motion;
    this.policy = { ...defaultPolicy, ...options.policy };
    this.state = {
      schema: "aerynth.constellation@1",
      anchors: {},
      bookmarks: {},
      history: [],
      future: [],
      savedViews: [],
      location: canonicalLocation(options.snapshot),
    };
    this.update(options.snapshot, false);
    this.motion.add(this.motionId, pose(this.defaultCamera()));
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private changed() {
    if (!this.destroyed) {
      this.options.onDirty?.();
      for (const fn of this.listeners) fn();
    }
  }
  get location() {
    return this.state.location;
  }
  get camera(): Camera {
    const p = this.motion.pose(this.motionId);
    return { x: p.x, y: p.y, zoom: p.w };
  }
  private defaultCamera(): Camera {
    const n = locationNode(this.location, this.nodes);
    if (this.location.kind === "universe") {
      const roots = [...this.nodes.values()].filter((n) => n.parent === null);
      return roots.length
        ? {
            x: roots.reduce((s, n) => s + n.point.x, 0) / roots.length,
            y: roots.reduce((s, n) => s + n.point.y, 0) / roots.length,
            zoom: 0.45,
          }
        : { x: 0, y: 0, zoom: 0.45 };
    }
    return {
      x: n?.point.x ?? 0,
      y: n?.point.y ?? 0,
      zoom: this.location.kind === "project" ? 0.9 : 2,
    };
  }
  private bookmark(): Bookmark {
    const p = this.motion.bodies.get(this.motionId)!.channels;
    return {
      camera: { x: p.x.target, y: p.y.target, zoom: p.w.target },
      selected: this.selected,
      ...(this.spatial ? { spatial: this.spatial.bookmark() } : {}),
    };
  }
  async restore() {
    try {
      const raw = await this.options.persistence?.load();
      if (
        !raw ||
        typeof raw !== "object" ||
        (raw as ViewState).schema !== "aerynth.constellation@1"
      )
        return;
      const s = raw as ViewState;
      const anchors: Record<string, Anchor> = {};
      for (const [key, p] of Object.entries(s.anchors ?? {}).slice(0, 20000))
        if (
          /^(project|workspace|resource):/.test(key) &&
          key.length < 1024 &&
          p &&
          finite(p.x) &&
          finite(p.y)
        )
          anchors[key] = {
            x: p.x,
            y: p.y,
            ...(validVector(p.spatial) ? { spatial: { ...p.spatial } } : {}),
            ...(p.pinned === true ? { pinned: true } : {}),
            ...(finite(p.rotation) ? { rotation: p.rotation } : {}),
          };
      this.state.anchors = anchors;
      this.update(this.snapshot, false);
      const scopes = new Set([
        "universe",
        ...[...this.nodes.values()]
          .filter((n) => n.kind !== "resource")
          .map((n) => n.key),
      ]);
      this.state.bookmarks = {};
      for (const [key, b] of Object.entries(s.bookmarks ?? {}).slice(0, 20000))
        if (scopes.has(key) && b && validCamera(b.camera))
          this.state.bookmarks[key] = {
            camera: { ...b.camera },
            ...(validSpatialCamera(b.spatial)
              ? { spatial: structuredClone(b.spatial) }
              : {}),
            selected:
              typeof b.selected === "string" && this.nodes.has(b.selected)
                ? b.selected
                : null,
          };
      // Canonical active workspace wins if it changed since this view was saved.
      const expected = canonicalLocation(this.snapshot);
      if (
        isLocation(s.location) &&
        allowedLocation(s.location, this.nodes) &&
        (this.snapshot.navigation || this.snapshot.activeWorkspaceId
          ? scopeOf(s.location) === scopeOf(expected)
          : true)
      )
        // An editor is host state, not proof supplied by a saved camera record.
        // Restore the containing workspace; opening a resource remains explicit.
        this.state.location =
          s.location.kind === "surface"
            ? { kind: "workspace", workspaceId: s.location.workspaceId }
            : s.location;
      this.state.history = this.cleanEntries(s.history);
      this.state.future = this.cleanEntries(s.future);
      this.state.savedViews = this.cleanSavedViews(s.savedViews);
      for (const [key, b] of Object.entries(this.state.bookmarks))
        this.state.bookmarks[key] = this.cleanBookmark(b);
      this.applyBookmark(this.state.bookmarks[scopeOf(this.location)]);
      this.motion.snap(this.motionId);
      if (this.spatial) this.motion.snap(this.spatial.id);
      this.changed();
    } catch {
      this.error =
        "Saved view could not be restored. Navigation remains available.";
      this.changed();
    }
  }
  update(snapshot: Snapshot, notify = true) {
    const oldCanonical = canonicalLocation(this.snapshot);
    const previous = this.location;
    const bookmark = notify && !this.pending ? this.bookmark() : undefined;
    this.snapshot = snapshot;
    this.nodes = project(snapshot, this.state.anchors);
    this.spatial?.updateGraph();
    const validKeys = new Set([...this.nodes.keys()]);
    this.state.anchors = Object.fromEntries(
      Object.entries(this.state.anchors).filter(([k]) => validKeys.has(k)),
    );
    this.state.bookmarks = Object.fromEntries(
      Object.entries(this.state.bookmarks)
        .filter(([k]) => k === "universe" || validKeys.has(k))
        .map(([k, b]) => [
          k,
          {
            ...b,
            selected: this.nodes.has(b.selected ?? "") ? b.selected : null,
          },
        ]),
    );
    this.state.history = this.cleanEntries(this.state.history);
    this.state.future = this.cleanEntries(this.state.future);
    this.state.savedViews = this.cleanSavedViews(this.state.savedViews);
    if (!allowedLocation(this.location, this.nodes))
      this.state.location = { kind: "universe" };
    const nextCanonical = canonicalLocation(snapshot);
    if (
      notify &&
      !this.pending &&
      JSON.stringify(oldCanonical) !== JSON.stringify(nextCanonical) &&
      allowedLocation(nextCanonical, this.nodes)
    ) {
      this.followCanonical(nextCanonical, previous, bookmark);
    }
    if (!this.nodes.has(this.selected ?? "")) this.selected = null;
    for (const [key, b] of Object.entries(this.state.bookmarks))
      this.state.bookmarks[key] = this.cleanBookmark(b);
    if (notify) {
      this.changed();
      void this.persist();
    }
  }
  private remember(location: Location, bookmark: Bookmark, push: boolean) {
    if (!allowedLocation(location, this.nodes)) return;
    const retained = {
      camera: bookmark.camera,
      ...(validSpatialCamera(bookmark.spatial)
        ? { spatial: bookmark.spatial }
        : {}),
      selected: this.nodes.has(bookmark.selected ?? "")
        ? bookmark.selected
        : null,
    };
    this.state.bookmarks[scopeOf(location)] = retained;
    if (push) {
      this.state.future = [];
      this.state.history = [
        ...this.state.history,
        { location, bookmark: retained },
      ].slice(-32);
    }
  }
  private cleanEntries(value: unknown): HistoryEntry[] {
    if (!Array.isArray(value)) return [];
    return value
      .slice(-32)
      .filter(
        (h): h is HistoryEntry =>
          !!h &&
          isLocation(h.location) &&
          allowedLocation(
            h.location.kind === "surface"
              ? { kind: "workspace", workspaceId: h.location.workspaceId }
              : h.location,
            this.nodes,
          ) &&
          h.bookmark &&
          validCamera(h.bookmark.camera),
      )
      .map(({ location: l, bookmark }) => ({
        location:
          l.kind === "universe"
            ? { kind: l.kind }
            : l.kind === "project"
              ? { kind: l.kind, projectId: l.projectId }
              : { kind: "workspace", workspaceId: l.workspaceId },
        bookmark: this.cleanBookmark(bookmark),
      }));
  }
  private cleanSavedViews(value: unknown): SavedView[] {
    if (!Array.isArray(value)) return [];
    const ids = new Set<string>(),
      names = new Set<string>(),
      result: SavedView[] = [];
    for (const raw of value.slice(0, 32)) {
      if (!raw || typeof raw !== "object") continue;
      const { id, name: input } = raw as Record<string, unknown>,
        name = this.cleanViewName(input),
        entry = this.cleanEntries([raw])[0];
      if (
        typeof id !== "string" ||
        !id.length ||
        id.length > 128 ||
        /[\s\u0000-\u001f\u007f-\u009f]/.test(id) ||
        !name ||
        !entry ||
        ids.has(id) ||
        names.has(name.toLowerCase())
      )
        continue;
      ids.add(id);
      names.add(name.toLowerCase());
      result.push({ id, name, ...entry });
    }
    return result;
  }
  private cleanViewName(value: unknown) {
    if (typeof value !== "string") return undefined;
    const name = value.trim();
    return name.length > 0 &&
      name.length <= 64 &&
      !/[\u0000-\u001f\u007f-\u009f]/.test(name)
      ? name
      : undefined;
  }
  private viewName(value: string, id?: string) {
    const name = this.cleanViewName(value);
    if (!name) throw Error("Use a view name between 1 and 64 characters.");
    if (
      this.state.savedViews.some(
        (view) =>
          view.id !== id && view.name.toLowerCase() === name.toLowerCase(),
      )
    )
      throw Error("A view with this name already exists.");
    return name;
  }
  async saveView(input: string) {
    if (this.destroyed || this.pending)
      throw Error("Finish navigation before saving a view.");
    const name = this.viewName(input),
      entry = this.cleanEntries([
        { location: this.location, bookmark: this.bookmark() },
      ])[0];
    if (!entry) throw Error("This view is unavailable.");
    if (this.state.savedViews.length >= 32)
      throw Error(
        "You can keep up to 32 saved views. Remove one to save another.",
      );
    const id = "view:" + crypto.randomUUID();
    this.state.savedViews.push({ id, name, ...structuredClone(entry) });
    this.changed();
    await this.persist();
    return id;
  }
  async renameView(id: string, input: string) {
    if (!this.state.savedViews.some((view) => view.id === id))
      throw Error("Saved view is unavailable.");
    const name = this.viewName(input, id);
    this.state.savedViews = this.state.savedViews.map((view) =>
      view.id === id ? { ...view, name } : view,
    );
    this.changed();
    await this.persist();
  }
  async removeView(id: string) {
    if (!this.state.savedViews.some((view) => view.id === id))
      throw Error("Saved view is unavailable.");
    this.state.savedViews = this.state.savedViews.filter(
      (view) => view.id !== id,
    );
    this.changed();
    await this.persist();
  }
  async returnView(id: string) {
    const view = this.cleanSavedViews(this.state.savedViews).find(
      (view) => view.id === id,
    );
    if (!view) throw Error("Saved view is unavailable.");
    return this.go(view.location, view.bookmark, undefined, {
      history: [
        ...this.state.history,
        { location: this.location, bookmark: this.bookmark() },
      ],
      future: [],
    });
  }
  private cleanBookmark(bookmark: Bookmark): Bookmark {
    const spatial = validSpatialCamera(bookmark.spatial)
      ? structuredClone(bookmark.spatial)
      : undefined;
    if (spatial?.neighborhood && !this.nodes.has(spatial.neighborhood))
      delete spatial.neighborhood;
    return {
      camera: {
        x: bookmark.camera.x,
        y: bookmark.camera.y,
        zoom: bookmark.camera.zoom,
      },
      selected: this.nodes.has(bookmark.selected ?? "")
        ? bookmark.selected
        : null,
      ...(spatial ? { spatial } : {}),
    };
  }
  private followCanonical(
    location: Location,
    previous: Location,
    bookmark?: Bookmark,
  ) {
    this.state.future = [];
    if (bookmark)
      this.remember(
        previous,
        bookmark,
        JSON.stringify(previous) !== JSON.stringify(location),
      );
    this.state.location = location;
    this.applyBookmark(this.state.bookmarks[scopeOf(location)]);
  }
  private applyBookmark(bookmark?: Bookmark, preserveSpatial = false) {
    if (!preserveSpatial) this.spatial?.restore(bookmark?.spatial);
    this.selected = bookmark?.selected ?? null;
    this.move(bookmark?.camera ?? this.defaultCamera(), "navigation");
  }
  move(camera: Camera, cause = "camera") {
    if (!validCamera(camera)) throw new Error("Invalid camera");
    this.motion.target(this.motionId, pose(camera), cause);
    if (this.policy.reduced || this.policy.quiet || this.policy.hidden)
      this.motion.snap(this.motionId);
    this.changed();
  }
  setPolicy(policy: Partial<Policy>) {
    this.policy = { ...this.policy, ...policy };
    if (this.policy.reduced || this.policy.quiet || this.policy.hidden) {
      this.motion.snap(this.motionId);
      this.spatial?.interrupt(false);
      for (const id of this.motion.bodies.keys())
        if (id.startsWith(this.motionId + ":body:")) this.motion.snap(id);
    }
    this.changed();
  }
  zoom(factor: number, focusKey?: string) {
    if (!Number.isFinite(factor) || factor <= 0)
      throw new Error("Invalid zoom");
    this.spatial?.zoom(factor, focusKey);
    const p = this.motion.bodies.get(this.motionId)!.channels;
    this.move(
      {
        x: p.x.target,
        y: p.y.target,
        zoom: clamp(p.w.target * factor, 0.02, 4),
      },
      "zoom",
    );
  }
  pan(dx: number, dy: number) {
    if (!finite(dx) || !finite(dy)) return;
    this.spatial?.pan(dx, dy);
    const c = this.camera;
    this.move(
      { ...c, x: clamp(c.x + dx, -1e7, 1e7), y: clamp(c.y + dy, -1e7, 1e7) },
      "pan",
    );
  }
  interrupt() {
    this.spatial?.interrupt();
    this.motion.target(this.motionId, pose(this.camera), "interrupt", true);
    this.motion.snap(this.motionId);
    this.changed();
  }
  recenter() {
    this.spatial?.recenter();
    this.move(this.defaultCamera(), "recenter");
  }
  fit(key = this.selected) {
    this.spatial?.fit(key);
    const n = this.nodes.get(key ?? "");
    if (n)
      this.move(
        { ...n.point, zoom: n.kind === "project" ? 0.8 : 1.6 },
        "fit selection",
      );
  }
  select(key: string) {
    if (!this.nodes.has(key)) throw new Error("Destination unavailable");
    this.selected = key;
    this.changed();
  }
  search(query: string, limit = 40) {
    const q = query.trim().toLocaleLowerCase();
    return [...this.nodes.values()]
      .filter((n) => n.title.toLocaleLowerCase().includes(q))
      .slice(0, clamp(limit, 1, 100));
  }
  async locate(key: string, fit = true) {
    const n = this.nodes.get(key);
    if (!n) throw new Error("Destination unavailable");
    const projectId =
      this.snapshot.workspaces.find((w) => w.id === n.workspaceId)
        ?.project_id ??
      this.snapshot.resources.find((r) => r.id === n.resourceId)?.project_id;
    const parent: Location =
      n.kind === "project"
        ? { kind: "universe" }
        : n.kind === "workspace"
          ? n.parent
            ? { kind: "project", projectId: this.nodes.get(n.parent)!.id }
            : { kind: "universe" }
          : projectId
            ? { kind: "project", projectId }
            : { kind: "workspace", workspaceId: n.workspaceId! };
    const manualRevision = this.spatial?.manualRevision,
      travel = this.go(parent),
      generation = this.generation;
    await travel;
    if (generation !== this.generation || this.destroyed) return false;
    if (!this.nodes.has(key)) throw new Error("Destination unavailable");
    this.select(key);
    if (fit && manualRevision === this.spatial?.manualRevision) this.fit(key);
    return true;
  }
  async approach(key = this.selected) {
    const n = this.nodes.get(key ?? "");
    if (!n) throw new Error("Destination unavailable");
    if (n.kind === "resource")
      return this.openResource(n.resourceId ?? n.id, { nodeKey: n.key });
    if (!n.available) throw new Error("Destination unavailable");
    return this.go(
      n.kind === "project"
        ? { kind: "project", projectId: n.id }
        : { kind: "workspace", workspaceId: n.id },
    );
  }
  /** Open canonical content; placement and camera navigation are independent. */
  openResource(
    resourceId: string,
    hints: {
      nodeKey?: string;
      selection?: ResourceOpeningInput["selection"];
    } = {},
  ) {
    return this.dispatchResource({
      resourceId,
      preferredPresentation: "direct",
      origin: {
        source: "constellation",
        ...(hints.nodeKey ? { nodeKey: hints.nodeKey } : {}),
      },
      ...(hints.selection
        ? { selection: { messageId: hints.selection.messageId } }
        : {}),
    });
  }
  /** Explicitly request this placement, never an arbitrary workspace fallback. */
  async focusExistingPlacement(key = this.selected) {
    const node = this.nodes.get(key ?? "");
    if (!node || node.kind !== "resource" || !node.workspaceId)
      throw new Error("Select an existing workspace placement");
    return this.dispatchResource({
      resourceId: node.resourceId ?? node.id,
      preferredPresentation: "existing-placement",
      preferredPlacement: {
        workspaceId: node.workspaceId,
        blockId: node.key.slice("resource:".length),
      },
      origin: { source: "constellation", nodeKey: node.key },
    });
  }
  private availableResource(resourceId: string) {
    if (
      this.destroyed ||
      !this.snapshot.resources.some(
        (resource) =>
          resource.id === resourceId &&
          resource.visible !== false &&
          resource.available !== false,
      )
    )
      throw new Error("Destination unavailable");
  }
  private validateResourceRequest(request: ResourceOpeningInput) {
    this.availableResource(request.resourceId);
    if (request.preferredPresentation !== "existing-placement") return;
    const placement = request.preferredPlacement,
      node = placement && this.nodes.get(keyOf("resource", placement.blockId)),
      workspace =
        placement && this.nodes.get(keyOf("workspace", placement.workspaceId));
    if (
      !placement ||
      !node?.available ||
      !workspace?.available ||
      node.resourceId !== request.resourceId ||
      node.workspaceId !== placement.workspaceId
    )
      throw new Error("Destination unavailable");
  }
  private async dispatchResource(request: ResourceOpeningInput) {
    this.validateResourceRequest(request);
    const open = this.options.openResource;
    if (!open) throw new Error("Resource editor is unavailable in this host");
    const generation = ++this.resourceOpeningGeneration;
    this.error = "";
    this.changed();
    // Wait for real navigation already in flight without changing its state.
    // Viewer requests reach the host independently, so its latest-intent guard
    // can supersede an older load instead of waiting for that viewer to finish.
    const operation = this.navigationChain
      .catch(() => {})
      .then(async () => {
        if (generation !== this.resourceOpeningGeneration || this.destroyed)
          return;
        this.validateResourceRequest(request);
        const key = request.origin?.nodeKey,
          node = key ? this.nodes.get(key) : undefined,
          origin = {
            source: "constellation" as const,
            ...(node?.kind === "resource" &&
            node.id === request.resourceId &&
            node.available &&
            node.key.length <= 256
              ? { nodeKey: node.key }
              : {}),
          };
        const result = await open.call(this.options, { ...request, origin });
        if (generation !== this.resourceOpeningGeneration || this.destroyed)
          return;
        this.validateResourceRequest(request);
        return result;
      });
    try {
      return await operation;
    } catch (error) {
      if (generation === this.resourceOpeningGeneration && !this.destroyed) {
        this.error =
          error instanceof Error ? error.message : "Resource opening failed";
        throw error;
      }
    } finally {
      if (generation === this.resourceOpeningGeneration) this.changed();
    }
  }
  async zoomOut() {
    const l = this.location;
    if (l.kind === "surface")
      return this.go({ kind: "workspace", workspaceId: l.workspaceId });
    if (l.kind === "workspace") {
      const p = this.snapshot.workspaces.find(
        (w) => w.id === l.workspaceId,
      )?.project_id;
      return this.go(
        p ? { kind: "project", projectId: p } : { kind: "universe" },
      );
    }
    return this.go({ kind: "universe" });
  }
  async go(
    location: Location,
    returning?: Bookmark,
    spatialOverride?: SpatialCamera,
    historyTravel?: { history: HistoryEntry[]; future: HistoryEntry[] },
  ) {
    if (location.kind === "surface") {
      if (!returning && !historyTravel)
        return this.openResource(location.resourceId, {
          nodeKey: keyOf("resource", location.blockId),
        });
      // Legacy history represents navigation to its containing workspace, not
      // permission to reopen an editor as a side effect of restoring a view.
      location = { kind: "workspace", workspaceId: location.workspaceId };
    }
    if (!allowedLocation(location, this.nodes))
      throw new Error("Destination unavailable");
    this.resourceOpeningGeneration++;
    const generation = ++this.generation;
    const spatialRevision = this.spatial?.manualRevision;
    const from = this.location,
      origin = locationNode(location, this.nodes)?.point ?? this.camera;
    const beforeCanonical = canonicalLocation(this.snapshot);
    const old = this.bookmark();
    this.error = "";
    this.pending = true;
    this.changed();
    // Arrival is usable immediately after service success; camera never gates input.
    try {
      const target: Destination =
        location.kind === "universe"
          ? { kind: "constellation", projectId: null }
          : location.kind === "project"
            ? { kind: "constellation", projectId: location.projectId }
            : { kind: "workspace", workspaceId: location.workspaceId };
      const navigation = this.navigationChain
        .catch(() => {})
        .then(async () => {
          if (generation !== this.generation || this.destroyed) return;
          await this.options.navigate(target);
          if (generation !== this.generation || this.destroyed) return;
          if (!allowedLocation(location, this.nodes))
            throw new Error("Destination unavailable");
        });
      this.navigationChain = navigation;
      await navigation;
      if (generation !== this.generation || this.destroyed) return;
      if (!allowedLocation(location, this.nodes))
        throw new Error("Destination unavailable");
      this.remember(
        from,
        old,
        !returning && JSON.stringify(from) !== JSON.stringify(location),
      );
      if (historyTravel) {
        this.state.history = this.cleanEntries(historyTravel.history);
        this.state.future = this.cleanEntries(historyTravel.future);
      } else {
        this.state.future = [];
      }
      this.state.location = location;
      const bookmark = returning ?? this.state.bookmarks[scopeOf(location)],
        arrival = spatialOverride
          ? {
              camera: bookmark?.camera ?? this.defaultCamera(),
              selected: bookmark?.selected ?? this.selected,
              spatial: spatialOverride,
            }
          : bookmark;
      this.applyBookmark(
        arrival ? this.cleanBookmark(arrival) : undefined,
        spatialRevision !== this.spatial?.manualRevision,
      );
      this.options.onTransition?.({
        from,
        to: location,
        origin,
        camera: this.camera,
      });
      await this.persist();
    } catch (error) {
      if (generation === this.generation) {
        // The workspace switch may have succeeded before its editor vanished.
        // Keep that real canonical destination rather than display the old one.
        const canonical = canonicalLocation(this.snapshot);
        if (
          (JSON.stringify(canonical) !== JSON.stringify(beforeCanonical) ||
            !allowedLocation(from, this.nodes)) &&
          allowedLocation(canonical, this.nodes)
        )
          this.followCanonical(canonical, from, old);
        this.error =
          error instanceof Error ? error.message : "Navigation failed";
        throw error;
      }
    } finally {
      if (generation === this.generation) {
        this.pending = false;
        this.changed();
      }
    }
  }
  async back() {
    const h = this.state.history.at(-1);
    if (!h) return;
    return this.go(h.location, h.bookmark, undefined, {
      history: this.state.history.slice(0, -1),
      future: [
        ...this.state.future,
        { location: this.location, bookmark: this.bookmark() },
      ],
    });
  }
  async forward() {
    const h = this.state.future.at(-1);
    if (!h) return;
    return this.go(h.location, h.bookmark, undefined, {
      history: [
        ...this.state.history,
        { location: this.location, bookmark: this.bookmark() },
      ],
      future: this.state.future.slice(0, -1),
    });
  }
  async returnHistory(index: number) {
    const history = [...this.state.history],
      h = history[index];
    if (!h) return;
    return this.go(h.location, h.bookmark, undefined, {
      history: history.slice(0, index),
      future: [
        ...this.state.future,
        { location: this.location, bookmark: this.bookmark() },
        ...history.slice(index + 1).reverse(),
      ],
    });
  }
  async persist() {
    if (this.destroyed) return;
    this.state.bookmarks[scopeOf(this.location)] = this.bookmark();
    const copy = structuredClone(this.state);
    this.saveChain = this.saveChain
      .catch(() => {})
      .then(async () => {
        try {
          await this.options.persistence?.save(copy);
          if (this.error === viewSaveError) {
            this.error = "";
            this.changed();
          }
        } catch {
          this.error = viewSaveError;
          this.changed();
        }
      });
    await this.saveChain;
  }
  async pin(key: string, point: Point) {
    const n = this.nodes.get(key);
    if (!n || n.kind === "resource" || !finite(point.x) || !finite(point.y))
      throw new Error("Invalid anchor");
    this.state.anchors[key] = { ...point };
    this.update(this.snapshot);
    await this.persist();
  }
  can(action: GraphAction["type"]) {
    return (
      !!this.options.graphAction && this.options.capabilities?.[action] === true
    );
  }
  async act(action: GraphAction) {
    if (!this.can(action.type))
      throw Error("This graph operation is unavailable in the current host");
    const next = await this.options.graphAction!(action);
    this.update(next);
    return next;
  }
  visible(width: number, height: number) {
    const c = this.camera,
      l = this.location;
    if (l.kind === "workspace" || l.kind === "surface") return [];
    const max =
      this.policy.tier === "efficient"
        ? 40
        : this.policy.tier === "balanced"
          ? 80
          : 120;
    const candidates = [...this.nodes.values()]
      .filter((n) =>
        l.kind === "universe"
          ? n.kind === "project" || (n.kind === "workspace" && !n.parent)
          : n.key === keyOf("project", l.projectId) ||
            n.parent === keyOf("project", l.projectId) ||
            ((c.zoom > 1.4 || n.key === this.selected) &&
              n.kind === "resource" &&
              this.nodes.get(
                n.workspaceId ? keyOf("workspace", n.workspaceId) : n.parent!,
              )?.parent === keyOf("project", l.projectId)),
      )
      .filter(
        (n) =>
          Math.abs((n.point.x - c.x) * c.zoom) < width / 2 + 140 &&
          Math.abs((n.point.y - c.y) * c.zoom) < height / 2 + 100,
      )
      .sort((a, b) =>
        a.key === this.selected
          ? -1
          : b.key === this.selected
            ? 1
            : a.kind !== b.kind
              ? a.kind === "workspace"
                ? -1
                : b.kind === "workspace"
                  ? 1
                  : a.kind === "project"
                    ? -1
                    : 1
              : Math.hypot(a.point.x - c.x, a.point.y - c.y) -
                Math.hypot(b.point.x - c.x, b.point.y - c.y),
      );
    // Screen-space label culling: preserve anchors/selection; search retains all
    // authorized destinations. Never move a pinned anchor just to fit a label.
    const visible: Node[] = [];
    for (const n of candidates) {
      const nw = n.kind === "resource" ? 160 : 194,
        nh = n.kind === "resource" ? 110 : 150;
      const collides = visible.some((other) => {
        const ow = other.kind === "resource" ? 160 : 194,
          oh = other.kind === "resource" ? 110 : 150;
        return (
          Math.abs((n.point.x - other.point.x) * c.zoom) < (nw + ow) / 2 + 12 &&
          Math.abs((n.point.y - other.point.y) * c.zoom) < (nh + oh) / 2 + 12
        );
      });
      if (!collides) visible.push(n);
      if (visible.length === max) break;
    }
    return visible;
  }
  dispose() {
    this.spatial?.dispose();
    this.destroyed = true;
    this.generation++;
    this.resourceOpeningGeneration++;
    this.listeners.clear();
    this.motion.bodies.delete(this.motionId);
  }
}
