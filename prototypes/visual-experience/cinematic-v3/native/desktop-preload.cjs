const { contextBridge, ipcRenderer } = require("electron");
let lastResourceTimingAt = -Infinity;
contextBridge.exposeInMainWorld(
  "aerynthHost",
  Object.freeze({
    renderWhileVisible: process.argv.includes("--aerynth-capture-visible"),
    geometryObservation: process.argv.includes(
      "--aerynth-geometry-observation",
    ),
    observeResourceTiming(sample) {
      const { frameP95Ms, budgetRatioP95, samples, windowMs } = sample ?? {};
      const at = performance.now();
      if (at - lastResourceTimingAt >= 1500 && [frameP95Ms, budgetRatioP95, samples, windowMs].every(Number.isFinite)) {
        lastResourceTimingAt = at;
        ipcRenderer.send("application-resource-timing", { frameP95Ms, budgetRatioP95, samples, windowMs });
      }
    },
    onResourceFrameBudget(listener) {
      if (typeof listener === "function")
        ipcRenderer.on("application-resource-frame-budget", (_event, value) => {
          if (value === null || Number.isFinite(value) && value >= 1 && value <= 1000) listener(value);
        });
    },
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
    resourcePolicyInspection(action) {
      if (action !== "inspect" && action !== "mode" && action !== "rollback")
        throw new Error("invalid_resource_inspection_action");
      if (action !== "inspect" && navigator.userActivation?.isActive !== true)
        throw new Error("resource_policy_user_gesture_required");
      return ipcRenderer.invoke("application-resource-policy-inspection", action);
    },
    async command(name, input) {
      if (
        ![
          "desktop",
          "capabilities",
          "rendererEventPage",
          "rendererVelaOutput",
          "replay",
          "executionStatus",
          "conversationActivity",
          "reconcileConversationTurn",
          "media",
          "openResource",
          "providerConnection",
          "velaApiConnection",
          "velaVoice",
          "velaWake",
          "weatherPermission",
          "folders",
          "interrupt",
          "viewState",
          "graphAction",
          "conversation",
          "vela",
          "library",
          "notes",
          "agents",
          "checklists",
          "clockTimers",
          "timelines",
          "githubTimeline",
          "taskObjectives",
          "missions",
          "workspaceRecovery",
          "firstPartyChat",
          "personalMemoryCapture",
        ].includes(name)
      )
        throw new Error("unsupported_command");
      if (name === "personalMemoryCapture" && navigator.userActivation?.isActive !== true)
        throw new Error("personal_memory_user_gesture_required");
      if ((name === 'clockTimers' && ['create', 'mutate'].includes(input?.name) ||
           name === 'library' && input?.name === 'createBlock' && input?.input?.kind === 'clock_timer' ||
           name === 'desktop' && input?.type === 'createResource' && input?.kind === 'clock_timer') &&
          navigator.userActivation?.isActive !== true)
        throw new Error('timer_user_gesture_required');
      if (name === 'velaApiConnection' && !['status','usageStatus'].includes(input?.type) &&
          navigator.userActivation?.isActive !== true)
        throw new Error('api_user_gesture_required');
      if (name === 'velaVoice' && (['start','reconnect','audition','speak','createVoice','saveVoice'].includes(input?.name)||input?.name==='setSpeakReplies'&&input?.input?.enabled===true) &&
          navigator.userActivation?.isActive !== true)
        throw new Error('voice_user_gesture_required');
      if (name === 'weatherPermission' && input?.type !== 'status' &&
          navigator.userActivation?.isActive !== true)
        throw new Error('weather_user_gesture_required');
      if(name==='folders'&&input?.type==='openExternal'&&navigator.userActivation?.isActive!==true)throw Error('folder_user_gesture_required');
      if (name === 'velaWake' && ['enable','save'].includes(input?.name) &&
          navigator.userActivation?.isActive !== true)
        throw new Error('wake_user_gesture_required');
      if (name === "githubTimeline" && input?.name === "openCommit" &&
          navigator.userActivation?.isActive !== true)
        throw new Error("github_user_gesture_required");
      if (name === "workspaceRecovery" && input?.name === "apply" && navigator.userActivation?.isActive !== true)
        throw new Error("workspace_recovery_user_gesture_required");
      if (name === "vela" && ["request", "native", "apply", "pickSources", "fileProposal", "hostOperation"].includes(input?.name) && navigator.userActivation?.isActive !== true)
        throw new Error("vela_user_gesture_required");
      if (name === "reconcileConversationTurn" &&
          navigator.userActivation?.isActive !== true)
        throw new Error("turn_recovery_user_gesture_required");
      if (name === "missions" && ["plan", "start", "control", "revision-apply", "workroom-apply", "team-save", "team-archive", "post-report"].includes(input?.name) &&
          navigator.userActivation?.isActive !== true)
        throw new Error("mission_user_gesture_required");
      if (name === "media" &&
          ["chooseMediaForAdd", "openExternal", "acquirePlayback"].includes(input?.name) &&
          navigator.userActivation?.isActive !== true)
        throw new Error("media_user_gesture_required");
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
