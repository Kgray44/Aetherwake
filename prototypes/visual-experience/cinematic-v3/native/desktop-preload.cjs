const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld(
  "aerynthHost",
  Object.freeze({
    renderWhileVisible: process.argv.includes("--aerynth-capture-visible"),
    geometryObservation: process.argv.includes(
      "--aerynth-geometry-observation",
    ),
    onActive(listener) {
      if (typeof listener === "function")
        ipcRenderer.on("host-active", (_e, active) => {
          if (typeof active === "boolean") listener(active);
        });
    },
    onEvent(listener) {
      if (typeof listener !== "function") return () => {};
      const handler = (_e, event) => listener(event);
      ipcRenderer.on("application-event", handler);
      return () => ipcRenderer.removeListener("application-event", handler);
    },
    async copyText(text) {
      // The isolated preload observes current Blink activation synchronously.
      // A renderer/model DTO cannot provide a gesture flag or native grant.
      if (
        typeof navigator === "undefined" ||
        navigator.userActivation?.isActive !== true
      )
        return {
          contract: "aerynth.clipboard@1",
          status: "denied",
          code: "clipboard_user_gesture_required",
        };
      if (typeof text !== "string" || text.length > 256 * 1024)
        return {
          contract: "aerynth.clipboard@1",
          status: "denied",
          code: "clipboard_invalid_request",
        };
      return ipcRenderer.invoke("application-copy-text", {
        type: "copyText",
        text,
      });
    },
    async command(name, input) {
      if (
        ![
          "desktop",
          "capabilities",
          "replay",
          "executionStatus",
          "conversationActivity",
          "openResource",
          "providerConnection",
          "interrupt",
          "send",
          "viewState",
          "graphAction",
          "conversation",
          "vela",
          "library",
          "notes",
          "firstPartyChat",
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
