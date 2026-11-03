import type { WorkspaceOrganization, OrganizationUpdate, LayoutState, LayoutPreview, LayoutPreviewRequest, Geometry, BlockProjection, GridSpan, StructuredPreset, LayoutIntent, StructuredOrganization } from './contracts.mts';
import { ensure, defaults, presentation } from './geometry.mts';
import { findVacantPlacement, footprint, intersects, resolveCollisions, validateBounds, type CollisionPlacement } from './collisions.mts';
import { findVacantGridPlacement, snapStructuredTargets, structuredGridGuides } from './structured-grid.mts';

const idOrder = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const presets = ['balanced', 'focus', 'development', 'research'];
export function defaultOrganization(): WorkspaceOrganization {
  return { schemaVersion: 1, mode: 'fluid', gap: 12, revision: 1,
    structured: { rowHeight: 96, rowGap: 12, columnGap: 12, margin: 16, preset: 'balanced', order: [], spans: {} } };
}
export function updateOrganization(base: WorkspaceOrganization, patch: OrganizationUpdate = {}): WorkspaceOrganization {
  ensure(patch && typeof patch === 'object' && !Array.isArray(patch) && Object.keys(patch).every(k => ['mode', 'gap', 'structured'].includes(k)));
  ensure(patch.structured === undefined || (patch.structured && typeof patch.structured === 'object' && !Array.isArray(patch.structured)));
  const u = patch.structured ?? {};
  ensure(u && typeof u === 'object' && !Array.isArray(u) && Object.keys(u).every(k => ['columnCount', 'rowHeight', 'rowGap', 'columnGap', 'margin', 'preset', 'order', 'spans'].includes(k)));
  ensure(u.order === undefined || Array.isArray(u.order));
  ensure(u.spans === undefined || (u.spans && typeof u.spans === 'object' && !Array.isArray(u.spans)));
  const s: StructuredOrganization = { ...base.structured, ...u, columnCount: u.columnCount === null ? undefined : u.columnCount ?? base.structured.columnCount,
    order: [...(u.order ?? base.structured.order)], spans: { ...base.structured.spans, ...u.spans } };
  if (s.columnCount === undefined) delete s.columnCount;
  ensure(s.columnCount === undefined || (Number.isInteger(s.columnCount) && s.columnCount >= 1 && s.columnCount <= 12));
  ensure(Number.isFinite(s.rowHeight) && s.rowHeight >= 32 && s.rowHeight <= 512);
  for (const n of [s.rowGap, s.columnGap, s.margin]) ensure(Number.isFinite(n) && n >= 0 && n <= 256);
  ensure(presets.includes(s.preset) && Array.isArray(s.order) && s.order.every(id => typeof id === 'string' && id.length > 0 && id.length <= 512) && new Set(s.order).size === s.order.length);
  ensure(s.spans && typeof s.spans === 'object' && !Array.isArray(s.spans));
  for (const span of Object.values(s.spans)) ensure(span && Number.isInteger(span.columns) && span.columns > 0 && span.columns <= 128 && Number.isInteger(span.rows) && span.rows > 0 && span.rows <= 256);
  const o = { ...base, ...patch, structured: s };
  ensure(['fluid', 'freeform', 'structured'].includes(o.mode) && Number.isFinite(o.gap) && o.gap >= 0 && o.gap <= 256);
  return o;
}
export type PolicyOptions = { targets?: string[]; resizeIds?: string[]; bounds?: Geometry; intent?: LayoutIntent; order?: string[]; preset?: StructuredPreset; spanOverrides?: string[]; before?: LayoutState };
const entries = (state: LayoutState): CollisionPlacement[] => [
  ...state.blocks.map(b => ({ id: b.blockId, x: b.x, y: b.y, width: b.width, height: b.height, rotation: b.rotation, locked: b.locked })),
  { ...state.presence, keepVisible: true },
];
const changedGeometry = (a: Geometry, b: Geometry) => a.x !== b.x || a.y !== b.y || a.width !== b.width || a.height !== b.height;

/** Freeform allows card/card overlap. A gesture may move its own footprint
 * around Vela, and a Vela gesture treats all stationary cards as obstacles. */
function protectPresence(state: LayoutState, input: CollisionPlacement[], options: PolicyOptions): CollisionPlacement[] {
  const repair = state.organization.mode === 'freeform' && options.intent === 'resolve';
  if (!repair && !options.targets?.length) return input;

  const prior = new Map((options.before ? entries(options.before) : []).map(item => [item.id, item]));
  const targets = new Set(options.targets);
  const changed = (item: CollisionPlacement) => {
    if (!targets.has(item.id)) return false;
    const old = prior.get(item.id);
    return !old || changedGeometry(item, old) || item.rotation !== old.rotation;
  };
  const { gap, mode } = state.organization;
  const findVacant = mode === 'structured' ? findVacantGridPlacement : findVacantPlacement;
  const separate = (item: CollisionPlacement, obstacles: CollisionPlacement[], clearance = obstacles) => {
    const box = footprint(item);
    if (!obstacles.some(obstacle => intersects(box, footprint(obstacle), gap))) return item;
    ensure(!item.locked, 'LOCKED_COLLISION');
    return findVacant(item, clearance, options.bounds, gap);
  };

  let presence = input.find(item => item.id === 'system:vela')!;
  if (changed(presence) || repair && !presence.locked) {
    presence = separate(presence, input.filter(item => item.id !== presence.id));
  }
  return input.map(item => {
    if (item.id === presence.id) return presence;
    if (changed(item) || repair && presence.locked) {
      const clearance = mode === 'structured' ? [presence, ...input.filter(other => other.id !== presence.id && other.id !== item.id)] : [presence];
      return separate(item, [presence], clearance);
    }
    return item;
  });
}

function structured(state: LayoutState, input: CollisionPlacement[], options: PolicyOptions): { items: CollisionPlacement[]; organization: WorkspaceOrganization; guides: LayoutPreview['guides'] } {
  const organization = updateOrganization(state.organization), cfg = organization.structured;
  const area = options.bounds ?? { x: 0, y: 0, width: 1280, height: 720 };
  const columns = cfg.columnCount ?? Math.max(1, Math.min(12, Math.floor((area.width - cfg.margin * 2 + cfg.columnGap) / (320 + cfg.columnGap))));
  const cellWidth = Math.max(128, (area.width - cfg.margin * 2 - (columns - 1) * cfg.columnGap) / columns);
  const stepX = cellWidth + cfg.columnGap, stepY = cfg.rowHeight + cfg.rowGap;
  const origin = { x: area.x + cfg.margin, y: area.y + cfg.margin };
  const ids = new Set(input.map(p => p.id));
  const existing = cfg.order.filter(id => ids.has(id));
  const remaining = input.filter(p => !existing.includes(p.id)).toSorted((a, b) => a.y - b.y || a.x - b.x || idOrder(a.id, b.id));
  let order = [...existing, ...remaining.map(p => p.id)];
  if (options.order) {
    ensure(Array.isArray(options.order), 'INVALID_ORDER');
    ensure(options.order.length === input.length && new Set(options.order).size === input.length && options.order.every(id => ids.has(id)), 'INVALID_ORDER');
    order = [...options.order];
  }
  const spans: Record<string, GridSpan> = {}, occupied: Geometry[] = [], placed = new Map<string, CollisionPlacement>();
  const overlaps = (a: Geometry, b: Geometry) => a.x < b.x + b.width + cfg.columnGap - 1e-7 && a.x + a.width + cfg.columnGap > b.x + 1e-7
    && a.y < b.y + b.height + cfg.rowGap - 1e-7 && a.y + a.height + cfg.rowGap > b.y + 1e-7;
  for (const p of input.filter(p => p.locked)) {
    const box = footprint(p); ensure(!occupied.some(b => overlaps(box, b)), 'LOCKED_COLLISION'); occupied.push(box); placed.set(p.id, { ...p });
  }
  const derivedSpan = (p: CollisionPlacement): GridSpan => {
    const f = footprint(p); return { columns: Math.max(1, Math.ceil((f.width + cfg.columnGap - 1e-7) / stepX)), rows: Math.max(1, Math.ceil((f.height + cfg.rowGap - 1e-7) / stepY)) };
  };
  // Keep visible reading order consistent with the persistent order. Restarting
  // first-fit at row zero let a late small placement backfill an earlier gap,
  // so dragging it after a visibly later card could appear to do nothing.
  // Locked placements remain exact reservations rather than ordering anchors.
  let cursor = 0;
  for (const id of order) {
    const p = input.find(p => p.id === id)!;
    let span = options.spanOverrides?.includes(id) ? cfg.spans[id] : options.intent === 'mode' || options.resizeIds?.includes(id) ? derivedSpan(p) : cfg.spans[id] ?? derivedSpan(p);
    if (options.preset && id !== 'system:vela' && !p.locked) {
      const primary = id === order.find(id => id !== 'system:vela');
      if (options.preset === 'focus') span = primary ? { columns: Math.max(1, Math.min(columns, 2)), rows: 4 } : { columns: 1, rows: 2 };
      if (options.preset === 'development') span = primary ? { columns: Math.max(1, columns - 1), rows: 5 } : { columns: 1, rows: 2 };
      if (options.preset === 'research') span = { columns: Math.min(2, columns), rows: 3 };
    }
    if (p.locked) { spans[id] = derivedSpan(p); continue; }
    const block = state.blocks.find(b => b.blockId === id);
    const quantized = block && block.shape !== 'circle' && !block.rotation;
    const next = { ...p,
      width: quantized ? Math.max(128, Math.min(4096, span.columns * stepX - cfg.columnGap)) : p.width,
      height: quantized ? Math.max(96, Math.min(4096, span.rows * stepY - cfg.rowGap)) : p.height,
    };
    span = derivedSpan(next); spans[id] = span;
    const box = footprint(next), dx = box.x - next.x, dy = box.y - next.y;
    let found = false;
    for (let row = Math.floor(cursor / columns); !found && origin.y + row * stepY <= 1e6; row++) {
      const lastColumn = span.columns > columns ? 0 : columns - span.columns;
      const firstColumn = row === Math.floor(cursor / columns) ? cursor % columns : 0;
      for (let col = firstColumn; col <= lastColumn; col++) {
        const candidate = { ...box, x: origin.x + col * stepX, y: origin.y + row * stepY };
        if (occupied.some(b => overlaps(candidate, b))) continue;
        const result = { ...next, x: candidate.x - dx, y: candidate.y - dy };
        ensure(Math.abs(result.x) <= 1e6 && Math.abs(result.y) <= 1e6, 'LAYOUT_SPACE_EXHAUSTED');
        placed.set(id, result); occupied.push(candidate); cursor = row * columns + col + 1; found = true; break;
      }
    }
    ensure(found, 'LAYOUT_SPACE_EXHAUSTED');
  }
  cfg.order = order; cfg.spans = spans; if (options.preset) cfg.preset = options.preset;
  const guides: LayoutPreview['guides'] = [];
  for (let c = 0; c <= columns; c++) guides.push({ axis: 'x', position: origin.x + c * stepX, from: area.y, to: area.y + area.height });
  for (let r = 0; r < Math.min(128, Math.ceil(area.height / stepY)); r++) guides.push({ axis: 'y', position: origin.y + r * stepY, from: area.x, to: area.x + area.width });
  return { items: input.map(p => placed.get(p.id)!), organization, guides };
}

/** Browser-safe policy shared verbatim by preview and the trusted commit service. */
export function applyOrganizationPolicy(state: LayoutState, options: PolicyOptions = {}): LayoutPreview {
  if (options.bounds) validateBounds(options.bounds);
  const input = entries(state); let items = input, organization = updateOrganization(state.organization), guides: LayoutPreview['guides'] = [];
  let viewport = { ...state.viewport };
  if (options.intent === 'recover') {
    ensure(options.bounds, 'BOUNDS_REQUIRED');
    const boxes = input.map(footprint), left = Math.min(...boxes.map(b => b.x)), top = Math.min(...boxes.map(b => b.y));
    const right = Math.max(...boxes.map(b => b.x + b.width)), bottom = Math.max(...boxes.map(b => b.y + b.height));
    const width = right - left, height = bottom - top;
    const safeWidth = options.bounds.width * viewport.zoom, safeHeight = options.bounds.height * viewport.zoom;
    const zoom = Math.min(1, safeWidth / (width + 32), safeHeight / (height + 32));
    ensure(Number.isFinite(zoom) && zoom > 0, 'INVALID_VIEWPORT');
    // Bounds arrive in the old camera's world space. Center the padded footprint
    // in the same screen area under the new camera.
    const safeCenterX = (options.bounds.x - viewport.x) * viewport.zoom + safeWidth / 2;
    const safeCenterY = (options.bounds.y - viewport.y) * viewport.zoom + safeHeight / 2;
    const x = left + width / 2 - safeCenterX / zoom;
    const y = top + height / 2 - safeCenterY / zoom;
    // A repeated fit can round differently after the screen bounds round-trip.
    // Preserve an already fitted pose so that roundoff cannot create an undo step.
    const alreadyFitted = viewport.zoom <= 1 && Math.abs(viewport.zoom - zoom) <= 4 * Number.EPSILON * zoom
      && Math.abs(viewport.x - x) * zoom < 1e-7 && Math.abs(viewport.y - y) * zoom < 1e-7;
    if (!alreadyFitted) viewport = { ...viewport, x, y, zoom };
  } else if (options.intent === 'view') {
    // Camera-only operations cannot reinterpret or repair legacy/manual geometry.
  } else if (organization.mode === 'fluid') {
    items = resolveCollisions(input, options.targets ?? [], options.bounds, { gap: organization.gap, yieldVisible: true, protectNeighbors: true });
    // World-space overflow must stay visible when Fluid displaces a card.
    // Unchanged offscreen/manual positions and camera-only operations stay exact.
    if(options.intent==='mode'&&options.bounds&&items.some(item=>{const box=footprint(item);return (box.x<options.bounds!.x||box.y<options.bounds!.y||box.x+box.width>options.bounds!.x+options.bounds!.width||box.y+box.height>options.bounds!.y+options.bounds!.height);})){const boxes=items.map(footprint),left=Math.min(...boxes.map(box=>box.x)),top=Math.min(...boxes.map(box=>box.y)),width=Math.max(...boxes.map(box=>box.x+box.width))-left+32,height=Math.max(...boxes.map(box=>box.y+box.height))-top+32;
      const nextZoom=Math.min(state.viewport.zoom,options.bounds.width*state.viewport.zoom/width,options.bounds.height*state.viewport.zoom/height);ensure(Number.isFinite(nextZoom)&&nextZoom>0,'INVALID_VIEWPORT');const safeX=(options.bounds.x-state.viewport.x)*state.viewport.zoom,safeY=(options.bounds.y-state.viewport.y)*state.viewport.zoom;viewport={...viewport,x:left-16-safeX/nextZoom,y:top-16-safeY/nextZoom,zoom:nextZoom};}
  } else if (organization.mode === 'freeform') {
    if (options.intent !== 'mode') items = protectPresence(state, input, options);
  } else if (organization.mode === 'structured') {
    if (options.preset || options.order || options.intent === 'resolve' || options.intent === 'reorder') {
      const result = structured(state, input, options); items = result.items; organization = result.organization; guides = result.guides;
    } else {
      // Mode/configuration selection enables the grid; it never arranges the
      // current workspace. Only the user's later active geometry is snapped.
      guides = structuredGridGuides(options.bounds);
      if (options.intent !== 'mode') {
        items = snapStructuredTargets(state, input, options.before, options.targets ?? [], options.bounds);
        items = protectPresence(state, items, options);
      }
      if (options.resizeIds?.length) {
        const cfg = organization.structured, area = options.bounds ?? { x: 0, y: 0, width: 1280, height: 720 };
        const columns = cfg.columnCount ?? Math.max(1, Math.min(12, Math.floor((area.width - cfg.margin * 2 + cfg.columnGap) / (320 + cfg.columnGap))));
        const stepX = Math.max(128, (area.width - cfg.margin * 2 - (columns - 1) * cfg.columnGap) / columns) + cfg.columnGap, stepY = cfg.rowHeight + cfg.rowGap;
        for (const id of options.resizeIds) {
          const item = items.find(item => item.id === id); if (!item) continue;
          const box = footprint(item); cfg.spans[id] = { columns: Math.max(1, Math.ceil((box.width + cfg.columnGap - 1e-7) / stepX)), rows: Math.max(1, Math.ceil((box.height + cfg.rowGap - 1e-7) / stepY)) };
        }
      }
    }
  }
  const byId = new Map(items.map(p => [p.id, p]));
  const blocks = state.blocks.map(b => { const p = byId.get(b.blockId)!; return { ...b, x: p.x, y: p.y, width: p.width, height: p.height }; });
  const p = byId.get('system:vela')!, presence = { ...state.presence, x: p.x, y: p.y, width: p.width, height: p.height };
  const affectedPlacementIds = items.filter(p => changedGeometry(p, input.find(b => b.id === p.id)!)).map(p => p.id);
  const areas = (options.targets ?? []).map(id => byId.get(id)).filter((p): p is CollisionPlacement => !!p).map(footprint);
  return { canonical: false, baseRevision: state.revision, blocks, presence, organization, viewport, affectedPlacementIds, guides, placementAreas: areas };
}

/** Never reads/writes SQLite, revisions, provider state, editor nodes or MotionCoordinator. */
export function previewLayout(state: LayoutState, request: LayoutPreviewRequest = {}): LayoutPreview {
  ensure(request.expectedRevision === undefined || request.expectedRevision === state.revision, 'CONFLICT');
  const next = { ...state, blocks: state.blocks.map(b => ({ ...b })), presence: { ...state.presence }, organization: updateOrganization(state.organization, request.organization) };
  if (request.viewport) {
    const v = request.viewport;
    ensure([v.x, v.y, v.zoom].every(Number.isFinite) && Math.abs(v.x) <= 1e12 && Math.abs(v.y) <= 1e12 && v.zoom > 0 && v.zoom <= 4);
    next.viewport = { ...v };
  }
  const targets: string[] = [], resizeIds: string[] = [], seen = new Set<string>();
  for (const update of request.placements ?? []) {
    ensure(!seen.has(update.blockId), 'DUPLICATE_ID'); seen.add(update.blockId);
    const b = next.blocks.find(b => b.blockId === update.blockId); ensure(b, 'NOT_FOUND'); ensure(b.version === update.expectedVersion, 'CONFLICT');
    ensure(!b.locked || (Object.keys(update.presentation).length === 1 && update.presentation.locked === false), 'LOCKED');
    const base = Object.fromEntries(Object.keys(defaults).map(key => [key, b[key as keyof BlockProjection]])) as unknown as typeof defaults;
    const p = presentation(update.presentation, base);
    if (p.width !== b.width || p.height !== b.height) resizeIds.push(b.blockId);
    Object.assign(b, p); targets.push(b.blockId);
  }
  if (request.presence) {
    const u = request.presence; ensure(u.expectedVersion === state.presence.version, 'CONFLICT');
    ensure(u.presentation && Object.keys(u.presentation).every(k => ['x', 'y', 'width', 'height', 'locked'].includes(k)));
    ensure(!next.presence.locked || (Object.keys(u.presentation).length === 1 && u.presentation.locked === false), 'LOCKED');
    const resized = (u.presentation.width !== undefined && u.presentation.width !== next.presence.width) || (u.presentation.height !== undefined && u.presentation.height !== next.presence.height);
    Object.assign(next.presence, u.presentation);
    const p = next.presence; ensure([p.x, p.y, p.width, p.height].every(Number.isFinite) && Math.abs(p.x) <= 1e6 && Math.abs(p.y) <= 1e6 && p.width >= 128 && p.height >= 96 && p.width <= 4096 && p.height <= 4096 && typeof p.locked === 'boolean');
    targets.push(p.id); if (resized) resizeIds.push(p.id);
  }
  if (request.structuredPreset) next.organization = updateOrganization(next.organization, { mode: 'structured', structured: { preset: request.structuredPreset } });
  if (request.order) ensure(next.organization.mode === 'structured', 'UNSUPPORTED_POLICY');
  let intent = request.intent;
  if (!intent) {
    if (request.organization || request.structuredPreset) intent = 'mode';
    else if (resizeIds.length) intent = 'resize';
    else if (targets.length) intent = 'move';
    else if (request.viewport || next.organization.mode === 'freeform' || request.placements && next.organization.mode === 'structured') intent = 'view';
    else intent = 'resolve';
  }
  const result = applyOrganizationPolicy(next, { targets, resizeIds, bounds: request.bounds, intent, order: request.order, preset: request.structuredPreset, spanOverrides: Object.keys(request.organization?.structured?.spans ?? {}), before: state });
  const old = entries(state), output = [...result.blocks.map(b => ({ ...b, id: b.blockId })), result.presence];
  result.affectedPlacementIds = output.filter(p => changedGeometry(p, old.find(b => b.id === p.id)!)).map(p => p.id);
  return result;
}
