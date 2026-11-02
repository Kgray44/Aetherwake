const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld(
  "aerynthHost",
  Object.freeze({
    renderWhileVisible: process.argv.includes("--aerynth-capture-visible"),
    onActive(listener) {
      if (typeof listener === "function")
        ipcRenderer.on("host-active", (_e, active) => {
          if (typeof active === "boolean") listener(active);
        });
    },
    onEvent(listener) {
      if (typeof listener === "function")
        ipcRenderer.on("application-event", (_e, event) => listener(event));
    },
    async command(name, input) {
      if (
        ![
          "desktop",
          "capabilities",
          "replay",
          "executionStatus",
          "interrupt",
          "send",
          "viewState",
          "graphAction",
          "conversation",
          "vela",
          "library",
          "notes",
        ].includes(name)
      )
        throw new Error("unsupported_command");
      const reply = await ipcRenderer.invoke(
        "application-command",
        name,
        input,
      );
      if (!reply.ok) throw new Error(reply.error);
      return reply.result;
    },
  }),
);
