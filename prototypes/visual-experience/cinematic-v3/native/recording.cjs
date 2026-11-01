const { desktopCapturer } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const MAX_BYTES = 32 * 1024 * 1024;
const MAX_RECORDING_MS = 35000;
const FPS_REQUESTED = 30;
const VIDEO_BITS_PER_SECOND = 6000000;

/**
 * CLI-only native window recording. Normal permission policy is owned by main.
 * The handler grants one video-only request from the exact local main frame,
 * and only the exact BrowserWindow source. There is no display/window fallback.
 */
async function recordNative(win, session, localURL, outputPath) {
  if (!process.argv.includes("--record")) {
    throw new Error(
      "Native recording is available only in explicit --record mode",
    );
  }
  if (win.isDestroyed() || win.webContents.isDestroyed()) {
    throw new Error("Cannot record a destroyed native window");
  }
  if (win.webContents.session !== session) {
    throw new Error("Recording session does not belong to the supplied window");
  }
  if (
    new URL(localURL).protocol !== "file:" ||
    win.webContents.getURL() !== localURL
  ) {
    throw new Error("Recording requires the exact local application URL");
  }
  const runtime = path.resolve(__dirname, "..", ".runtime");
  const destination = path.resolve(outputPath);
  const relative = path.relative(runtime, destination);
  if (
    !relative ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    path.extname(destination).toLowerCase() !== ".webm"
  ) {
    throw new Error(
      "Recording output must be a new .webm file inside this prototype's .runtime directory",
    );
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const realRuntime = await fs.realpath(runtime);
  const realParent = await fs.realpath(path.dirname(destination));
  const realRelative = path.relative(realRuntime, realParent);
  if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
    throw new Error("Recording output parent resolves outside .runtime");
  }
  try {
    await fs.access(destination);
    throw new Error(
      "Recording output already exists; existing evidence will not be overwritten",
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const sourceId = win.getMediaSourceId();
  if (!sourceId.startsWith("window:")) {
    throw new Error(
      "Supplied native window did not expose a window capture source",
    );
  }
  const mainFrame = win.webContents.mainFrame;
  const routingId = mainFrame.routingId;
  const processId = mainFrame.processId;
  let accepting = true;
  let requestUsed = false;
  let handlerFailure = null;
  let granted = false;
  let timeout;

  const isExactFrame = (frame) => {
    try {
      return (
        accepting &&
        !win.isDestroyed() &&
        !win.webContents.isDestroyed() &&
        frame &&
        frame.routingId === routingId &&
        frame.processId === processId &&
        frame.url === localURL &&
        win.webContents.getURL() === localURL &&
        win.webContents.mainFrame.routingId === routingId &&
        win.webContents.mainFrame.processId === processId
      );
    } catch {
      return false;
    }
  };

  session.setDisplayMediaRequestHandler(
    async (request, callback) => {
      if (
        requestUsed ||
        !isExactFrame(request.frame) ||
        !request.videoRequested ||
        request.audioRequested ||
        !request.userGesture
      ) {
        callback(null);
        return;
      }
      requestUsed = true;
      try {
        const sources = await desktopCapturer.getSources({
          types: ["window"],
          thumbnailSize: { width: 0, height: 0 },
          fetchWindowIcons: false,
        });
        const matches = sources.filter((source) => source.id === sourceId);
        if (
          matches.length !== 1 ||
          !isExactFrame(request.frame) ||
          win.getMediaSourceId() !== sourceId
        ) {
          throw new Error(
            "Exact application window capture source is unavailable or changed",
          );
        }
        granted = true;
        callback({ video: matches[0] });
      } catch (error) {
        handlerFailure = String(error);
        callback(null);
      }
    },
    { useSystemPicker: false },
  );

  try {
    const configuration = {
      localURL,
      maxBytes: MAX_BYTES,
      maxRecordingMs: MAX_RECORDING_MS,
      frameRate: FPS_REQUESTED,
      videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
    };
    const execution = win.webContents.executeJavaScript(
      `(${recordJourney.toString()})(${JSON.stringify(configuration)})`,
      true,
    );
    const result = await Promise.race([
      execution,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new Error(
                "Native recording did not finish within its bounded run",
              ),
            ),
          49000,
        );
      }),
    ]);
    if (!granted)
      throw new Error("No exact native-window recording request was granted");
    if (
      !result ||
      !Number.isFinite(result.durationMs) ||
      result.durationMs <= 0 ||
      result.durationMs > MAX_RECORDING_MS + 1000
    ) {
      throw new Error("Recorder returned an invalid or excessive duration");
    }
    if (typeof result.dataURL !== "string")
      throw new Error("Recorder did not return video data");
    const comma = result.dataURL.indexOf(",");
    const header = result.dataURL.slice(0, comma);
    const encoded = result.dataURL.slice(comma + 1);
    if (
      !/^data:video\/webm(?:;codecs=[a-zA-Z0-9]+)?;base64$/.test(header) ||
      encoded.length > Math.ceil(MAX_BYTES / 3) * 4 + 4 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
    ) {
      throw new Error("Recorder returned invalid or excessive WebM data");
    }
    const bytes = Buffer.from(encoded, "base64");
    if (
      !bytes.length ||
      bytes.length > MAX_BYTES ||
      bytes.length !== result.byteCount ||
      bytes.readUInt32BE(0) !== 0x1a45dfa3
    ) {
      throw new Error(
        "Recorded WebM failed its size or container-header check",
      );
    }
    await fs.writeFile(destination, bytes, { flag: "wx" });
    return {
      outputPath: destination,
      format: "WebM",
      mimeType: result.mimeType,
      byteCount: bytes.length,
      durationMs: result.durationMs,
      requestedFrameRate: FPS_REQUESTED,
      requestedVideoBitsPerSecond: VIDEO_BITS_PER_SECOND,
      recorderVideoBitsPerSecond: result.recorderVideoBitsPerSecond,
      videoTrackSettings: result.videoTrackSettings,
      source: "Exact application BrowserWindow only",
      audio: false,
      journey: result.journey,
      finalState: result.finalState,
      capturedAtUTC: new Date().toISOString(),
      limitations: [
        "30 fps is a capture request, not a measurement of presented frames or application FPS.",
        "MediaRecorder encoding and native window capture add overhead; this run is motion evidence, not a performance benchmark.",
        "Agent and Vela activity shown in the application remains explicitly synthetic.",
      ],
    };
  } catch (error) {
    throw new Error(
      `Native window recording failed: ${String(error)}${handlerFailure ? `; display request: ${handlerFailure}` : ""}`,
    );
  } finally {
    accepting = false;
    clearTimeout(timeout);
    session.setDisplayMediaRequestHandler(null);
    if (
      !win.isDestroyed() &&
      !win.webContents.isDestroyed() &&
      win.webContents.getURL() === localURL
    ) {
      try {
        await Promise.race([
          win.webContents.executeJavaScript(
            "window.__aerynthNativeRecordingStop?.()",
            true,
          ),
          new Promise((resolve) => setTimeout(resolve, 2000)),
        ]);
      } catch {
        // A destroyed/crashed renderer has no surviving capture track.
      }
    }
  }
}

/** This function is serialized into the isolated local renderer, with no Node/IPC bridge. */
async function recordJourney(configuration) {
  if (location.href !== configuration.localURL || window.top !== window) {
    throw new Error(
      "Recording script requires the exact top-level local document",
    );
  }
  const api = window.__aerynth;
  if (
    !api ||
    !navigator.mediaDevices?.getDisplayMedia ||
    typeof MediaRecorder === "undefined"
  ) {
    throw new Error(
      "Native media capture or the local prototype controller is unavailable",
    );
  }
  if (window.__aerynthNativeRecordingStop)
    throw new Error("Another recording is already active");
  const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8"].find(
    (mime) => MediaRecorder.isTypeSupported(mime),
  );
  if (!mimeType)
    throw new Error("Neither VP9 nor VP8 WebM recording is supported");
  const initial = api.snapshot();
  if (
    initial.graphicsFailed ||
    !initial.resources.some((resource) => resource.id === "research-material")
  ) {
    throw new Error(
      "Cannot record an unavailable or incomplete prototype scene",
    );
  }
  const originalOrder = initial.order.join("|");
  let stream = null;
  let recorder = null;
  let deadline;
  let acquisitionDeadline;
  let activityKeeper;
  let startAt = 0;
  let stopAt = 0;
  let stopping = false;
  let acquisitionCancelled = false;
  let fatal = null;
  let bytes = 0;
  const chunks = [];
  const journey = [];
  const sleep = async (ms) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    if (fatal) throw new Error(fatal);
    if (stopping)
      throw new Error("Recording stopped before the journey completed");
  };
  const mark = (scene) =>
    journey.push({ scene, offsetMs: performance.now() - startAt });
  const click = (selector) => {
    const element = document.querySelector(selector);
    if (!element || element.disabled || !element.getClientRects().length) {
      throw new Error(`Journey control unavailable: ${selector}`);
    }
    element.click();
  };
  const stop = (reason) => {
    if (reason && !fatal) fatal = reason;
    if (!stopping) {
      stopping = true;
      stopAt = performance.now();
      if (recorder && recorder.state !== "inactive") recorder.stop();
      stream?.getTracks().forEach((track) => track.stop());
    }
  };
  window.__aerynthNativeRecordingStop = () =>
    stop("Recording aborted by native cleanup");
  try {
    api.stopDemo();
    api.home();
    api.setStudy("living");
    api.setQuality("cinematic");
    api.setReduced(false);
    api.setVela("idle");
    api.setActive(true);
    for (const selector of [
      "#settings-close",
      "#stream-close",
      "#vela-close",
    ]) {
      const control = document.querySelector(selector);
      if (control?.getClientRects().length) control.click();
    }
    const acquisition = navigator.mediaDevices
      .getDisplayMedia({
        video: { frameRate: configuration.frameRate },
        audio: false,
      })
      .then((media) => {
        if (acquisitionCancelled)
          media.getTracks().forEach((track) => track.stop());
        return media;
      });
    stream = await Promise.race([
      acquisition,
      new Promise((_, reject) => {
        acquisitionDeadline = setTimeout(() => {
          acquisitionCancelled = true;
          reject(new Error("Exact-window media acquisition timed out"));
        }, 8000);
      }),
    ]);
    clearTimeout(acquisitionDeadline);
    if (
      stream.getVideoTracks().length !== 1 ||
      stream.getAudioTracks().length
    ) {
      throw new Error(
        "Capture must contain exactly one video track and no audio",
      );
    }
    const track = stream.getVideoTracks()[0];
    const settings = track.getSettings();
    const videoTrackSettings = {
      width: settings.width ?? null,
      height: settings.height ?? null,
      frameRate: settings.frameRate ?? null,
      displaySurface: settings.displaySurface ?? null,
    };
    recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: configuration.videoBitsPerSecond,
    });
    let resolveStopped;
    const stopped = new Promise((resolve) => {
      resolveStopped = resolve;
    });
    recorder.addEventListener("dataavailable", (event) => {
      if (!event.data.size) return;
      if (bytes + event.data.size > configuration.maxBytes) {
        stop("Recording exceeded its 32 MiB admission limit");
        return;
      }
      bytes += event.data.size;
      chunks.push(event.data);
    });
    recorder.addEventListener("error", (event) =>
      stop(`MediaRecorder error: ${event.error?.message || "unknown"}`),
    );
    recorder.addEventListener(
      "stop",
      () => {
        clearTimeout(deadline);
        stream.getTracks().forEach((mediaTrack) => mediaTrack.stop());
        resolveStopped();
      },
      { once: true },
    );
    track.addEventListener(
      "ended",
      () => {
        if (!stopping) stop("Native window capture ended unexpectedly");
      },
      { once: true },
    );
    const started = new Promise((resolve, reject) => {
      recorder.addEventListener(
        "start",
        () => {
          startAt = performance.now();
          deadline = setTimeout(
            () => stop("Recording reached its 35-second deadline"),
            configuration.maxRecordingMs,
          );
          resolve();
        },
        { once: true },
      );
      recorder.addEventListener(
        "error",
        (event) =>
          reject(new Error(event.error?.message || "Recorder failed to start")),
        { once: true },
      );
    });
    recorder.start(500);
    await started;
    // Explicit recording mode keeps only this captured renderer alive if focus moves.
    // Normal application visibility policy is unchanged.
    activityKeeper = setInterval(() => api.setActive(true), 250);

    mark("Initial dimensional environment / Vela idle");
    await sleep(4000);
    api.select("conversation-tidal");
    mark("Resource selection");
    await sleep(500);
    api.expand("conversation-tidal");
    await sleep(120);
    api.home();
    mark("Interrupted expansion reverses continuously");
    await sleep(450);
    api.expand("conversation-tidal");
    mark("Conversation unfolds into working plane");
    await sleep(1400);
    const reading = document.querySelector(".message-stream");
    reading.scrollTop = 80;
    click(".conversation-actions button:last-child");
    mark("Vela receives local typed input");
    await sleep(400);
    const input = document.querySelector("#vela-input");
    input.value = "Explore the material study.";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    click("#vela-send");
    await sleep(400);
    click("#vela-close");
    await sleep(150);
    click("#demo");
    mark("Explicit synthetic activity / Intelligence Stream");
    await sleep(11250);
    const afterDemo = api.snapshot();
    if (
      afterDemo.vela !== "idle" ||
      !afterDemo.events.some(
        (event) =>
          event.kind === "fixture.check.passed" &&
          event.evidence === "local-observed",
      )
    ) {
      throw new Error(
        "Synthetic sequence did not reach its recorded fixture check and idle state",
      );
    }
    click("#stream-close");
    api.home();
    mark("Same resource returns to its workspace arrangement");
    await sleep(800);
    api.move("conversation-tidal", 2);
    mark("Workspace rearranges / field follows");
    await sleep(800);
    click("#undo");
    mark("Arrangement restored by undo");
    await sleep(800);
    if (api.snapshot().order.join("|") !== originalOrder)
      throw new Error("Journey undo did not restore the original arrangement");
    api.select("research-material");
    mark("Material lens selected");
    await sleep(400);
    api.expand("research-material");
    mark("Lens transforms into readable research plane");
    await sleep(1100);
    api.home();
    await sleep(600);
    api.select("note-field");
    await sleep(300);
    api.expand("note-field");
    await sleep(800);
    const editor = document.querySelector(
      '[data-resource="note-field"] textarea',
    );
    if (!editor) throw new Error("Focused notebook editor is unavailable");
    editor.focus();
    mark("Focused writing surface / environment yields");
    await sleep(1400);
    editor.blur();
    api.home();
    api.setVela("idle");
    mark("Return to calm workspace");
    await sleep(2200);
    const final = api.snapshot();
    stop();
    await Promise.race([
      stopped,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Recorder did not flush after stop")),
          5000,
        ),
      ),
    ]);
    if (fatal) throw new Error(fatal);
    const durationMs = stopAt - startAt;
    if (
      durationMs <= 0 ||
      durationMs > configuration.maxRecordingMs + 1000 ||
      !bytes ||
      bytes > configuration.maxBytes
    ) {
      throw new Error(
        "Recorded duration or bytes are outside the bounded limits",
      );
    }
    const blob = new Blob(chunks, { type: mimeType });
    const dataURL = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () =>
        reject(new Error("Recorded WebM could not be read"));
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
    return {
      dataURL,
      mimeType,
      byteCount: blob.size,
      durationMs,
      recorderVideoBitsPerSecond: recorder.videoBitsPerSecond,
      videoTrackSettings,
      journey,
      finalState: {
        expanded: final.expanded,
        vela: final.vela,
        resourceCount: final.resources.length,
        eventCount: final.events.length,
      },
    };
  } finally {
    acquisitionCancelled = true;
    clearTimeout(acquisitionDeadline);
    clearTimeout(deadline);
    clearInterval(activityKeeper);
    stop();
    stream?.getTracks().forEach((track) => track.stop());
    api.stopDemo();
    delete window.__aerynthNativeRecordingStop;
  }
}

module.exports = { recordNative };
