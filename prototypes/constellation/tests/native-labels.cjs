const assert = require("node:assert/strict");

/** Read-only assertion in the integration lead's existing synthetic QA window. */
exports.checkLabelClearance = async (win) => {
  const result = await win.webContents.executeJavaScript(
    `(()=>{
    const visible=e=>!e.hidden&&e.getClientRects().length>0&&getComputedStyle(e).visibility==='visible';
    const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom};};
    const ui=[...document.querySelectorAll('.aw-constellation-bar,.aw-camera-tools,.aw-spatial-detail,.aw-spatial-status,.aw-destinations,.aw-camera-settings[open] > div,.aw-graph-dialog[open],#vela,#vela .vela-label,#vela .vela-grip')].filter(visible).map(e=>({role:e.id||e.className,bounds:rect(e)})).filter(item=>item.bounds.right>item.bounds.left&&item.bounds.bottom>item.bounds.top);
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
