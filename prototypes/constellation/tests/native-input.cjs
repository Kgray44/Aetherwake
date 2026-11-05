/** Never reclaim OS focus. Stop the action when the operator leaves its window. */
function assertNativeOwner(win) {
  if (
    win.isDestroyed() ||
    win.webContents.isDestroyed() ||
    !win.isVisible() ||
    win.isMinimized() ||
    !win.isFocused()
  ) {
    const error = new Error("native_owner_window_inactive");
    error.code = "native_owner_window_inactive";
    throw error;
  }
}

function nativeInput(win, event) {
  assertNativeOwner(win);
  win.webContents.sendInputEvent(event);
}

module.exports = { assertNativeOwner, nativeInput };
