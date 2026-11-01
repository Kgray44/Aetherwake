const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld(
  "aerynthHost",
  Object.freeze({
    renderWhileVisible: process.argv.includes("--render-while-visible"),
    onActive(listener) {
      if (typeof listener !== "function") return;
      ipcRenderer.on("host-active", (_event, active) => {
        if (typeof active === "boolean") listener(active);
      });
    },
  }),
);
