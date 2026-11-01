const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const root = path.resolve(__dirname, "..");
const runtime = path.join(root, ".runtime");
app.setPath("userData", path.join(runtime, "video-inspection-profile"));
app
  .whenReady()
  .then(async () => {
    const input = path.resolve(process.argv[2]);
    if (
      !input.startsWith(runtime + path.sep) ||
      path.extname(input) !== ".webm"
    )
      throw new Error("Only an existing local prototype WebM may be inspected");
    session.defaultSession.setPermissionRequestHandler((_w, _p, cb) =>
      cb(false),
    );
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ["http://*/*", "https://*/*"] },
      (_d, cb) => cb({ cancel: true }),
    );
    const html = path.join(runtime, "video-inspection.html");
    await fs.writeFile(
      html,
      '<!doctype html><meta charset="utf-8"><video id="v" muted></video><canvas id="c"></canvas>',
    );
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });
    await window.loadFile(html);
    const result = await window.webContents.executeJavaScript(
      `(async()=>{
    const v=document.getElementById('v');v.src=${JSON.stringify(pathToFileURL(input).href)};
    await new Promise((resolve,reject)=>{v.onloadeddata=resolve;v.onerror=()=>reject(new Error('Video decode failed'));});
    const c=document.getElementById('c');c.width=v.videoWidth;c.height=v.videoHeight;const ctx=c.getContext('2d');const frames=[];
    for(const time of [.3,2.8,6.3,10,12.5,15.8,21.5,26.5]){v.currentTime=time;await new Promise(resolve=>v.onseeked=resolve);ctx.drawImage(v,0,0);frames.push({time,data:c.toDataURL('image/png')});}
    return {width:v.videoWidth,height:v.videoHeight,duration:v.duration,frames};
  })()`,
      true,
    );
    for (const frame of result.frames)
      await fs.writeFile(
        path.join(runtime, `video-frame-${frame.time}.png`),
        Buffer.from(frame.data.split(",")[1], "base64"),
      );
    console.log(
      JSON.stringify({
        width: result.width,
        height: result.height,
        duration: result.duration,
        frames: result.frames.map((f) => f.time),
      }),
    );
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
