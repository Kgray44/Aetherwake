export type WorkspaceView = { x: number; y: number; zoom: number };
type Rect = { x: number; y: number; width: number; height: number };
type Body = {
  width: number;
  height: number;
  bodyWidth: number;
  bodyHeight: number;
};

/** Camera framing only. The canonical block and the caller's return view are
 * never mutated. Fixed chrome and actual empty body boxes remain measurable. */
export function approachWorkspaceCard(input: {
  block: Rect & { rotation?: number };
  view: WorkspaceView;
  body: Body;
  minimum: { minimumBodyWidth: number; minimumBodyHeight: number };
  safe: Rect;
}): { viewport: WorkspaceView; constrained: boolean } {
  const { block, view, body, minimum, safe } = input;
  if (
    ![block.x, block.y, view.x, view.y, safe.x, safe.y].every(
      Number.isFinite,
    ) ||
    ![
      block.width,
      block.height,
      view.zoom,
      body.width,
      body.height,
      minimum.minimumBodyWidth,
      minimum.minimumBodyHeight,
      safe.width,
      safe.height,
    ].every((value) => Number.isFinite(value) && value > 0) ||
    ![body.bodyWidth, body.bodyHeight].every(
      (value) => Number.isFinite(value) && value >= 0,
    ) ||
    !Number.isFinite(block.rotation ?? 0) ||
    view.zoom > 4
  )
    throw new Error("card_approach_geometry_unavailable");
  const growth = (outer: number, inner: number, wanted: number) =>
    inner > 0 ? wanted / inner : (outer + wanted) / outer;
  const wanted = Math.max(
    view.zoom,
    (body.width / block.width) *
      growth(body.width, body.bodyWidth, minimum.minimumBodyWidth),
    (body.height / block.height) *
      growth(body.height, body.bodyHeight, minimum.minimumBodyHeight),
  );
  const angle = ((block.rotation ?? 0) * Math.PI) / 180;
  const paintedWidth =
    Math.abs(Math.cos(angle)) * block.width +
    Math.abs(Math.sin(angle)) * block.height;
  const paintedHeight =
    Math.abs(Math.sin(angle)) * block.width +
    Math.abs(Math.cos(angle)) * block.height;
  const limit = Math.min(
    4,
    safe.width / paintedWidth,
    safe.height / paintedHeight,
  );
  const zoom = Math.min(wanted, limit);
  if (zoom < view.zoom - 1e-8) throw new Error("card_approach_needs_more_room");
  return {
    viewport: {
      x: block.x + block.width / 2 - (safe.x + safe.width / 2) / zoom,
      y: block.y + block.height / 2 - (safe.y + safe.height / 2) / zoom,
      zoom,
    },
    constrained: zoom + 1e-8 < wanted,
  };
}
