const { personalMemoryCommand } = require("./personal-memory-command.cjs");

function applicationFrameTrust(win, localURL) {
  const trustedApplicationFrame = event =>
    !win.isDestroyed() && !win.webContents.isDestroyed() &&
    event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame &&
    event.senderFrame?.url === localURL;
  const trustedActiveFrame = event =>
    trustedApplicationFrame(event) && win.isVisible() && !win.isMinimized() && win.isFocused();
  return { trustedApplicationFrame, trustedActiveFrame };
}

function nativeReviewBoundary({ dialog, checkDesktopTest }) {
  let busy = false;
  const nativeReviewGate = async work => {
    checkDesktopTest();
    if (busy) throw Error("native_review_busy");
    busy = true;
    try { return await work(); }
    finally { busy = false; }
  };
  return {
    nativeReviewGate,
    reviewDialogs: {
      showMessageBox: (...args) => nativeReviewGate(() => dialog.showMessageBox(...args)),
      showOpenDialog: (...args) => nativeReviewGate(() => dialog.showOpenDialog(...args)),
      showSaveDialog: (...args) => nativeReviewGate(() => dialog.showSaveDialog(...args)),
    },
  };
}

function createPersonalMemoryDesktopRoute({
  win, frames, backendIdentity, backendReady, allowWrite, call, reviewDialogs, writeExport,
}) {
  return (event, input) => {
    const owner = backendIdentity();
    const currentFrame = () => backendReady() && backendIdentity() === owner &&
      frames.trustedApplicationFrame(event) && win.isVisible() && !win.isMinimized();
    return personalMemoryCommand({
      input, event, win, currentFrame, trustedActiveFrame: frames.trustedActiveFrame,
      allowWrite, call, reviewDialogs, writeExport,
    });
  };
}

module.exports = { applicationFrameTrust, nativeReviewBoundary, createPersonalMemoryDesktopRoute };
