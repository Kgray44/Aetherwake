/** Electron destruction can race an already-queued child/renderer callback. */
function sendToWindow(win, channel, ...args) {
  try {
    if (!win || win.isDestroyed()) return false;
    const contents = win.webContents;
    if (!contents || contents.isDestroyed()) return false;
    contents.send(channel, ...args);
    return true;
  } catch {
    // No live renderer remains to notify. Never turn shutdown into a main-process crash.
    return false;
  }
}
module.exports = { sendToWindow };
