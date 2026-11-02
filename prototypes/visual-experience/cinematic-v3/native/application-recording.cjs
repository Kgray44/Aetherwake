const { desktopCapturer } = require("electron");
const fs = require("node:fs/promises");
const { createHash } = require("node:crypto");
/** Bounded, video-only capture of this exact synthetic verification window. */
async function startWindowRecording(win, session, localURL) {
  if (
    !process.argv.includes("--integration-environments") &&
    !process.argv.includes("--integration-resource-opening") &&
    !process.argv.includes("--integration-constellation") &&
    !process.argv.includes("--integration-organization") &&
    !process.argv.includes("--integration-expanded") &&
    !process.argv.includes("--integration-product-ui") &&
    !process.argv.includes("--integration-drag-glide")
  )
    throw new Error("recording_mode_required");
  const maxBytes =
    (process.argv.includes("--integration-environments") ? 32 : 48) *
    1024 *
    1024;
  const sourceId = win.getMediaSourceId(),
    title = win.getTitle(),
    frame = win.webContents.mainFrame;
  let granted = false,
    used = false;
  session.setPermissionCheckHandler(
    (contents, permission) =>
      contents === win.webContents &&
      contents.getURL() === localURL &&
      permission === "display-capture",
  );
  session.setPermissionRequestHandler((contents, permission, callback) =>
    callback(
      contents === win.webContents &&
        contents.getURL() === localURL &&
        permission === "display-capture",
    ),
  );
  session.setDisplayMediaRequestHandler(
    async (request, callback) => {
      if (
        used ||
        !request.videoRequested ||
        request.audioRequested ||
        !request.userGesture ||
        !request.frame ||
        request.frame.routingId !== frame.routingId ||
        request.frame.processId !== frame.processId ||
        request.frame.url !== localURL
      ) {
        callback(null);
        return;
      }
      used = true;
      try {
        const sources = await desktopCapturer.getSources({
          types: ["window"],
          thumbnailSize: { width: 0, height: 0 },
          fetchWindowIcons: false,
        });
        const matches = sources.filter(
          (s) => s.id === sourceId && s.name === title,
        );
        if (matches.length !== 1)
          throw new Error("exact_capture_source_unavailable");
        granted = true;
        callback({ video: matches[0] });
      } catch {
        callback(null);
      }
    },
    { useSystemPicker: false },
  );
  const ready = await win.webContents.executeJavaScript(
    `(async()=>{
    const stream=await navigator.mediaDevices.getDisplayMedia({audio:false,video:{frameRate:30}});
    const mimeType=['video/webm;codecs=vp9','video/webm;codecs=vp8'].find(m=>MediaRecorder.isTypeSupported(m));
    if(!mimeType){stream.getTracks().forEach(t=>t.stop());throw Error('webm_unavailable');}
    const chunks=[];let bytes=0,problem=null,started=0,firstChunkResolve;
    const firstChunk=new Promise(resolve=>{firstChunkResolve=resolve;});
    const recorder=new MediaRecorder(stream,{mimeType,videoBitsPerSecond:6000000});
    const done=new Promise((resolve,reject)=>{recorder.ondataavailable=e=>{bytes+=e.data.size;if(e.data.size)firstChunkResolve();if(bytes>${maxBytes}){problem='capture_size_limit';recorder.stop();}else chunks.push(e.data);};recorder.onerror=()=>{problem='capture_failed';};recorder.onstop=()=>{stream.getTracks().forEach(t=>t.stop());if(problem){reject(Error(problem));return;}const reader=new FileReader();reader.onload=()=>resolve({dataURL:reader.result,bytes,durationMs:performance.now()-started,mimeType});reader.onerror=()=>reject(Error('capture_read_failed'));reader.readAsDataURL(new Blob(chunks,{type:mimeType}));};});
    done.catch(()=>{});recorder.start(500);started=performance.now();const timer=setTimeout(()=>{if(recorder.state!=='inactive')recorder.stop();},60000);
    window.__aerynthVerificationCaptureStop=async()=>{clearTimeout(timer);if(recorder.state!=='inactive')recorder.stop();return done;};
    let warmTimer;try{await Promise.race([firstChunk,new Promise((_,reject)=>{warmTimer=setTimeout(()=>reject(Error('capture_warmup_timeout')),5000);})]);}catch(error){clearTimeout(timer);if(recorder.state!=='inactive')recorder.stop();stream.getTracks().forEach(t=>t.stop());throw error;}finally{clearTimeout(warmTimer);}return {startedAt:performance.timeOrigin+started,readyAt:Date.now()};
  })()`,
    true,
  );
  if (!granted) throw new Error("capture_not_bound_to_window");
  return {
    startedAt: ready.startedAt,
    readyAt: ready.readyAt,
    async stop(destination) {
      try {
        const result = await win.webContents.executeJavaScript(
          "window.__aerynthVerificationCaptureStop()",
          true,
        );
        const bytes = Buffer.from(result.dataURL.split(",")[1], "base64");
        if (
          !bytes.length ||
          bytes.length > maxBytes ||
          bytes.readUInt32BE(0) !== 0x1a45dfa3
        )
          throw new Error("invalid_webm");
        await fs.writeFile(destination, bytes, { flag: "wx" });
        return {
          file: require("node:path").basename(destination),
          byteCount: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          durationMs: result.durationMs,
          startedAt: ready.startedAt,
          readyAt: ready.readyAt,
          mimeType: result.mimeType,
          source: "Exact application BrowserWindow",
          audio: false,
          requestedFrameRate: 30,
          limitations: [
            "Capture frame-rate request is not monitor-presented frame timing.",
            "This native window recording is motion evidence and includes capture/encoding overhead.",
          ],
        };
      } finally {
        session.setDisplayMediaRequestHandler(null);
        session.setPermissionCheckHandler(() => false);
        session.setPermissionRequestHandler((_c, _p, cb) => cb(false));
      }
    },
  };
}
module.exports = { startWindowRecording };
