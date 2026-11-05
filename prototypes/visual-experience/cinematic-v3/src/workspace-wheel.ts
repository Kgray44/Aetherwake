type WheelInput = Pick<
  WheelEvent,
  | "deltaX"
  | "deltaY"
  | "deltaMode"
  | "defaultPrevented"
  | "cancelable"
  | "ctrlKey"
  | "metaKey"
  | "altKey"
  | "shiftKey"
>;
type WorkspaceWheelContext = {
  workspace: boolean;
  background: boolean;
  blocked: boolean;
  hidden: boolean;
  pageHeight: number;
};

/** The host admits empty workspace background only. The existing Constellation
 * controller owns camera motion, traversal thresholds and canonical navigation. */
export function workspaceWheelFactor(
  event: WheelInput,
  context: WorkspaceWheelContext,
): number | null {
  if (
    !context.workspace ||
    !context.background ||
    context.blocked ||
    context.hidden ||
    event.defaultPrevented ||
    !event.cancelable ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.shiftKey ||
    !Number.isFinite(event.deltaX) ||
    !Number.isFinite(event.deltaY) ||
    ![0, 1, 2].includes(event.deltaMode) ||
    !Number.isFinite(context.pageHeight) ||
    context.pageHeight <= 0 ||
    Math.abs(event.deltaY) <= Math.abs(event.deltaX)
  )
    return null;
  const unit =
    event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? context.pageHeight : 1;
  const pixels = Math.max(-150, Math.min(150, event.deltaY * unit));
  return Math.exp(-pixels * 0.003);
}
