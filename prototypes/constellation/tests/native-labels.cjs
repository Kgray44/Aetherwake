const assert = require("node:assert/strict");

/** Read-only assertion in the integration lead's existing synthetic QA window. */
exports.checkLabelClearance = async (win) => {
  const result = await win.webContents.executeJavaScript(
    `(()=>{
    const visible=e=>!e.hidden&&e.getClientRects().length>0&&getComputedStyle(e).visibility==='visible';
    const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom};};
    const ui=[...document.querySelectorAll('.aw-constellation-bar,.aw-spatial-detail,.aw-spatial-status,.aw-destinations,.aw-navigation-guide,.aw-graph-dialog[open],#vela,#vela .vela-label,#vela .vela-grip')].filter(visible).map(e=>({role:e.id||e.className,bounds:rect(e)})).filter(item=>item.bounds.right>item.bounds.left&&item.bounds.bottom>item.bounds.top);
    const labels=[...document.querySelectorAll('.aw-spatial-label')].filter(visible).map(e=>({key:e.dataset.key,bounds:rect(e)}));
    const intersects=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
    return {viewport:{width:innerWidth,height:innerHeight},labels,ui,collisions:labels.flatMap(label=>ui.filter(item=>intersects(label.bounds,item.bounds)).map(item=>({key:label.key,ui:item.role,label:label.bounds,bounds:item.bounds})))};
  })()`,
    true,
  );
  assert.ok(
    result.labels.length > 0,
    "overview has a visible destination label",
  );
  assert.deepEqual(
    result.collisions,
    [],
    "native destination labels clear actual controls and Vela/caption",
  );
  return result;
};

/** Short, reversible UI smoke in Integration's existing overview window.
 * No window, recording, canonical mutation or process is created here.
 */
exports.verifyCompactNavigation = async (win) => {
  const {
    createDriver,
  } = require("../../visual-experience/cinematic-v3/native/desktop-verify.cjs");
  const { js, click, wait } = await createDriver(win);
  const location = await js("window.__aerynth.snapshot().spatial.location");
  assert.ok(
    ["project", "universe"].includes(location.kind),
    "start in an actual overview",
  );
  const key = async (keyCode, modifiers = []) => {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    await new Promise((resolve) => setTimeout(resolve, 150));
  };
  assert.equal(
    await js(
      'document.querySelectorAll(".aw-constellation-bar button").length',
    ),
    2,
  );
  assert.equal(
    await js('document.querySelectorAll(".aw-camera-tools").length'),
    0,
  );
  await click('.aw-quiet-control[aria-label="Navigation guide"]');
  await wait('!document.querySelector(".aw-navigation-guide").hidden');
  const guide = await js(
    '(()=>{const e=document.querySelector(".aw-navigation-guide"),r=e.getBoundingClientRect();return {width:r.width,height:r.height,text:e.textContent,material:getComputedStyle(e).backdropFilter,buttons:e.querySelectorAll("button").length}})()',
  );
  assert.ok(guide.width <= 360 && guide.height > 100);
  assert.equal(guide.buttons, 0);
  assert.notEqual(guide.material, "none");
  assert.ok(
    guide.text.includes("Alt + drag") && guide.text.includes("Ctrl + K"),
  );
  await new Promise((resolve) => setTimeout(resolve, 200));
  const clearance = await exports.checkLabelClearance(win);
  await key("Escape");
  await wait('document.querySelector(".aw-navigation-guide").hidden');
  await key("F1");
  await wait('!document.querySelector(".aw-navigation-guide").hidden');
  await key("Escape");
  await key("k", ["control"]);
  await wait('!document.querySelector(".aw-destinations").hidden');
  assert.equal(
    await js('document.querySelector("#command-surface").open'),
    false,
    "Ctrl K must not also open the host manager",
  );
  await key("Escape");
  await wait('document.querySelector(".aw-destinations").hidden');
  return {
    location,
    guide,
    labelCount: clearance.labels.length,
    checks: [
      "two-quiet-controls",
      "compact-glass-guide",
      "actual-label-clearance",
      "native-F1-and-Escape",
      "CtrlK-without-host-double-opening",
    ],
  };
};
