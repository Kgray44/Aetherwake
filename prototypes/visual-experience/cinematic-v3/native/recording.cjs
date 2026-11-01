const { desktopCapturer } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomBytes, createHash } = require("node:crypto");

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
  const captureTitle = win.getTitle();
  const nativeHandle = win.getNativeWindowHandle();
  const nativeWindowNumber =
    nativeHandle.length >= 8
      ? nativeHandle.readBigUInt64LE().toString()
      : nativeHandle.readUInt32LE().toString();
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
        const matches = sources.filter(
          (source) =>
            source.id === sourceId &&
            source.name === captureTitle &&
            source.id.split(":")[1] === nativeWindowNumber,
        );
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
    const celestialArgument = process.argv.find((argument) =>
      argument.startsWith("--celestial-study="),
    );
    const celestialStudy = celestialArgument
      ? celestialArgument.slice("--celestial-study=".length)
      : null;
    if (
      celestialStudy !== null &&
      !["starlit", "shadow", "deep"].includes(celestialStudy)
    )
      throw new Error(
        "Recording celestial study must be starlit, shadow or deep",
      );
    const configuration = {
      localURL,
      maxBytes: MAX_BYTES,
      maxRecordingMs: MAX_RECORDING_MS,
      frameRate: FPS_REQUESTED,
      videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
      ambientStudy: process.argv.includes("--ambient-study"),
      celestialStudy,
      verificationColors: Array.from(
        randomBytes(12),
        (byte) => 64 + (byte % 128),
      ),
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
      sha256: createHash("sha256").update(bytes).digest("hex"),
      durationMs: result.durationMs,
      durationMeaning:
        "Recorder start-event to stop request on the renderer wall clock. Encoded packet/frame PTS and missing container duration require independent inspection of this exact video file.",
      requestedFrameRate: FPS_REQUESTED,
      requestedVideoBitsPerSecond: VIDEO_BITS_PER_SECOND,
      recorderVideoBitsPerSecond: result.recorderVideoBitsPerSecond,
      videoTrackSettings: result.videoTrackSettings,
      source: "Exact application BrowserWindow only",
      captureBinding: {
        uniqueWindowTitleMatched: true,
        nativeWindowHandleMatched: true,
        exactFrameMatched: true,
        livePixelPatternMatched: result.livePixelPatternMatched,
      },
      audio: false,
      journey: result.journey,
      finalState: result.finalState,
      capturedAtUTC: new Date().toISOString(),
      limitations: [
        "30 fps is a capture request, not a measurement of presented frames or application FPS.",
        "MediaRecorder encoding and native window capture add overhead; this run is motion evidence, not a performance benchmark.",
        "Agent and Vela activity shown in the application remains explicitly synthetic.",
        "Scripted pointer events demonstrate rendered parallax, not physical mouse input latency or monitor presentation.",
        "Journey offsets use the renderer wall clock and must not be silently substituted for encoded video PTS.",
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
  let marker = null,
    probeVideo = null;
  let bytes = 0;
  const chunks = [];
  const journey = [];
  const sleep = async (ms) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    if (fatal) throw new Error(fatal);
    if (stopping)
      throw new Error("Recording stopped before the journey completed");
  };
  const mark = (scene) => {
    const state = api.snapshot();
    journey.push({
      scene,
      offsetMs: performance.now() - startAt,
      visualClockMs: state.visualClock,
      celestialStudy: state.celestialStudy,
      environmentPhaseOverrideSeconds: state.environmentPhase,
      architecture: state.gpu?.architecture ?? null,
      cosmos: state.gpu?.cosmos ?? null,
    });
  };
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
    api.setStudy("architecture");
    api.setArchitectureConcept("ring");
    if (configuration.celestialStudy)
      api.setCelestialStudy(configuration.celestialStudy);
    api.setEnvironmentPhase(null);
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
    // Verify actual media pixels before starting the recorder, in addition to
    // the exact frame, native handle and unique window title checks.
    marker = document.createElement("div");
    marker.style.cssText =
      "position:fixed;left:16px;top:64px;width:64px;height:16px;display:flex;z-index:2147483647;pointer-events:none";
    for (let i = 0; i < 4; i++) {
      const block = document.createElement("span");
      block.style.cssText = `width:16px;height:16px;background:rgb(${configuration.verificationColors.slice(i * 3, i * 3 + 3).join(",")})`;
      marker.append(block);
    }
    document.body.append(marker);
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
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
    probeVideo = document.createElement("video");
    probeVideo.muted = true;
    probeVideo.srcObject = stream;
    await probeVideo.play();
    const probe = document.createElement("canvas");
    const context = probe.getContext("2d", { willReadFrequently: true });
    let patternMatched = false;
    for (let attempt = 0; attempt < 12 && !patternMatched; attempt++) {
      await sleep(100);
      if (!probeVideo.videoWidth || !probeVideo.videoHeight) continue;
      probe.width = probeVideo.videoWidth;
      probe.height = probeVideo.videoHeight;
      context.drawImage(probeVideo, 0, 0);
      const sx = probe.width / innerWidth,
        sy = probe.height / innerHeight;
      for (let dy = -8; dy <= 8 && !patternMatched; dy += 2)
        for (let dx = -8; dx <= 8 && !patternMatched; dx += 2) {
          patternMatched = [0, 1, 2, 3].every((i) => {
            const pixel = context.getImageData(
              Math.round((24 + i * 16) * sx + dx),
              Math.round(72 * sy + dy),
              1,
              1,
            ).data;
            return [0, 1, 2].every(
              (c) =>
                Math.abs(
                  pixel[c] - configuration.verificationColors[i * 3 + c],
                ) < 32,
            );
          });
        }
    }
    marker.remove();
    marker = null;
    probeVideo.pause();
    probeVideo.srcObject = null;
    probeVideo = null;
    if (!patternMatched)
      throw new Error(
        "Capture pixel verification failed; no recording was started or saved",
      );
    await sleep(150);
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

    if (configuration.ambientStudy) {
      mark(
        "Celestial sky / fixed-light ring rotation and physical specular response / autonomous Vela / no pointer input or phase override",
      );
      await sleep(10000);
      mark(
        "Ambient +10 seconds / actual environment clock, unchanged study and light rig",
      );
      await sleep(10000);
      mark(
        "Ambient +20 seconds / actual environment clock, unchanged study and light rig",
      );
      await sleep(10000);
      mark("Ambient end / actual environment clock");
    } else {
      mark(
        "Luminous Architecture / monumental arc / autonomous Vela without input",
      );
      await sleep(1000);
      mark(
        "Scripted pointer-event parallax / rendered response, not physical mouse latency",
      );
      for (let step = 0; step < 20; step++) {
        const angle = (step / 19) * Math.PI * 2;
        document.dispatchEvent(
          new PointerEvent("pointermove", {
            clientX: innerWidth * (0.5 + Math.sin(angle) * 0.18),
            clientY: innerHeight * (0.5 + Math.cos(angle) * 0.08),
            pointerType: "mouse",
            bubbles: true,
          }),
        );
        await sleep(40);
      }
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          clientX: innerWidth * 0.5,
          clientY: innerHeight * 0.5,
          pointerType: "mouse",
          bubbles: true,
        }),
      );
      await sleep(1500);
      api.setStudy("living");
      mark("Living Intelligence appears around the same persistent resources");
      await sleep(1200);
      api.select("conversation-tidal");
      mark("Resource selection");
      await sleep(500);
      api.expand("conversation-tidal");
      await sleep(120);
      api.home();
      mark("Interrupted expansion reverses continuously");
      await sleep(350);
      api.expand("conversation-tidal");
      mark("Conversation unfolds into working plane");
      await sleep(1400);
      const reading = document.querySelector(".message-stream");
      reading.scrollTop = 80;
      const passage = reading.querySelector(".message p");
      const range = document.createRange();
      range.selectNodeContents(passage);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      mark("Real DOM reading, scrolling and text selection");
      api.setStudy("architecture");
      mark("Focused work stays intact as the environment transforms");
      await sleep(800);
      getSelection().removeAllRanges();
      click(".conversation-actions button:last-child");
      mark("Vela receives local typed input");
      await sleep(250);
      const input = document.querySelector("#vela-input");
      input.value = "Explore the material study.";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      click("#vela-send");
      await sleep(250);
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
      await sleep(600);
      api.setStudy("living");
      api.move("conversation-tidal", 2);
      mark("Workspace rearranges / field follows");
      await sleep(700);
      click("#undo");
      mark("Arrangement restored by undo");
      await sleep(700);
      if (api.snapshot().order.join("|") !== originalOrder)
        throw new Error(
          "Journey undo did not restore the original arrangement",
        );
      api.select("research-material");
      mark("Material lens selected");
      await sleep(400);
      api.expand("research-material");
      mark("Lens transforms into readable research plane");
      await sleep(900);
      api.home();
      await sleep(450);
      api.select("note-field");
      await sleep(200);
      api.expand("note-field");
      await sleep(800);
      const editor = document.querySelector(
        '[data-resource="note-field"] textarea',
      );
      if (!editor) throw new Error("Focused notebook editor is unavailable");
      const originalNote = editor.value;
      editor.focus();
      editor.value +=
        "\n\nSynthetic capture observation: the reading plane stays calm while the surrounding architecture retains depth.";
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      editor.setSelectionRange(editor.value.length, editor.value.length);
      editor.scrollTop = editor.scrollHeight;
      mark("Focused local editing / environment yields");
      await sleep(1000);
      editor.value = originalNote;
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      editor.blur();
      api.home();
      api.setVela("idle");
      api.setStudy("architecture");
      mark("Return to calm workspace");
      await sleep(1700);
    }
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
      livePixelPatternMatched: true,
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
        study: final.study,
        architectureConcept: final.architectureConcept,
        celestialStudy: final.celestialStudy,
        environmentPhaseOverrideSeconds: final.environmentPhase,
      },
    };
  } finally {
    marker?.remove();
    if (probeVideo) {
      probeVideo.pause();
      probeVideo.srcObject = null;
    }
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
