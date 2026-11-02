/** Native dialog close events arrive after an action may have deliberately
 * focused a resource. Restore the trigger only if focus still needs a home. */
export function returnFocusAfterDialogClose(
  surface: HTMLElement,
  trigger: HTMLElement | null,
): void {
  if (!trigger?.isConnected) return;
  const document = surface.ownerDocument;
  const active = document.activeElement;
  if (
    active &&
    active !== document.body &&
    active !== surface &&
    !surface.contains(active)
  )
    return;
  trigger.focus();
}
