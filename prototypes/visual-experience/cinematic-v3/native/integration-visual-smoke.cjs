/* Existing synthetic profile only. No launch, editing, provider probe, recording, or rendering override. */
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createDriver } = require('./desktop-verify.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = value => createHash('sha256').update(value).digest('hex');
const inside = (root, target) => { const part = path.relative(root, target); return !!part && !part.startsWith('..') && !path.isAbsolute(part); };
const expressions = {
  graphics: `(()=>{const s=window.__aerynth.snapshot();return {active:s.active,failed:s.graphicsFailed,errors:s.metrics.errors,draws:s.metrics.draws,frames:s.gpu?.framesRendered,contextLost:s.gpu?.contextLost,presence:s.gpu?.presenceProjection,bounds:s.gpu?.presenceBounds}})()`,
  writer: `(()=>{const e=document.activeElement;return !!e&&(e.tagName==='TEXTAREA'||e.tagName==='INPUT'||e.isContentEditable)})()`,
  panel: id => `(()=>{const e=document.querySelector(${JSON.stringify('[data-block="' + id + '"]')}),w=e?.querySelector('.working-content[data-note-state]');if(!e||!w||!e.classList.contains('expanded')||!w.getClientRects().length)return null;let opacity=1;for(let n=w;n&&n!==document.body;n=n.parentElement){const s=getComputedStyle(n);if(s.display==='none'||s.visibility==='hidden')return null;opacity*=Number(s.opacity)}const r=e.getBoundingClientRect();return {opacity,state:w.dataset.noteState,x:r.x,y:r.y,width:r.width,height:r.height,inBounds:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}})()`,
  fonts: id => `(()=>{const root=document.querySelector(${JSON.stringify('[data-block="' + id + '"] .working-content[data-note-state]')});if(!root)throw Error('Note experience missing');const visible=e=>e.getClientRects().length&&!e.hidden&&getComputedStyle(e).visibility!=='hidden',editor=root.querySelector('textarea'),reader=root.querySelector('.aw-note-reading');let nodes=editor&&visible(editor)?[editor]:reader&&visible(reader)?[reader,...reader.querySelectorAll('p,li,blockquote,pre,code')].filter(visible).slice(0,12):[];return {noteState:root.dataset.noteState,items:nodes.map(e=>{const s=getComputedStyle(e);return {tag:e.tagName,pixels:parseFloat(s.fontSize),scale:parseFloat(s.getPropertyValue('--aw-block-text-scale')||'1'),lineHeight:s.lineHeight}})}})()`,
};

exports.verify = async ({ win, app, privateRoot, source, startupErrors = [] }) => {
  const started = Date.now(), end = started + 20000;
  const runtime = path.resolve(__dirname, '../.runtime'), out = path.join(runtime, 'application-evidence', 'visual-smoke-' + started);
  const receipt = { contract: 'aerynth.actual-visual-smoke@1', startedAt: new Date(started).toISOString(), source, syntheticProfile: true, passed: false, actions: [], captures: [], consoleErrors: [], shaderErrors: [], checks: [], limits: { milliseconds: 20000, pngs: 2, pngBytes: 8 * 1024 * 1024 }, boundary: 'Focused actual GPU draws and PNGs only; no artistic, monitor-presentation or performance acceptance.' };
  let expired = false, timer, driver, totalBytes = 0, tabUsed = false, errorCount = 0;
  const foreground = () => { assert(!expired && Date.now() < end, 'visual_smoke_deadline'); assert(!win.isDestroyed() && win.isVisible() && !win.isMinimized() && win.isFocused(), 'native_verification_focus_lost'); };
  const consoleError = (_event, details, message) => {
    const structured = details && typeof details === 'object', level = structured ? details.level : details, text = String(structured ? details.message : message).slice(0, 1600);
    if (/shader.*(?:error|failed)|THREE\.WebGLProgram|VALIDATE_STATUS|ERROR:\s*\d+:\d+/i.test(text)) { errorCount++; if (receipt.shaderErrors.length < 16) receipt.shaderErrors.push(text); }
    if (level === 'error' || level === 3) { errorCount++; if (receipt.consoleErrors.length < 16) receipt.consoleErrors.push(text); }
  };
  const canonical = snapshot => ({ resources: snapshot.resources, blocks: snapshot.navigationBlocks ?? snapshot.blocks, projects: snapshot.projects, workspaces: snapshot.workspaces, relationships: snapshot.relationships, presence: snapshot.presence });
  const observedStartup = () => startupErrors.slice(0, 16).map(value => typeof value === 'string' ? value.slice(0, 1600) : { message: String(value?.message ?? value).slice(0, 1600), line: value?.line, source: String(value?.source ?? '').slice(0, 300) });
  const run = async () => {
    assert(Array.isArray(startupErrors), 'Startup errors must be the host-observed bounded array'); receipt.startupErrors = observedStartup(); assert.equal(startupErrors.length, 0, 'Observed startup shader/console errors');
    assert(path.isAbsolute(privateRoot) && path.basename(path.resolve(privateRoot)) === 'review-expanded-20261101-g', 'Expected the authorized existing synthetic g profile');
    assert(inside(runtime, out), 'Invalid private evidence path'); await fs.mkdir(out, { recursive: true });
    receipt.sourceHashes = {};
    for (const relative of ['native/integration-visual-smoke.cjs', 'native/desktop-verify.cjs', 'src/instrument-materials.ts', 'src/renderer.ts', 'src/presence-projection.ts', 'src/application.ts', '../../block-library/note-view.css']) receipt.sourceHashes[relative] = hash(await fs.readFile(path.resolve(__dirname, '..', relative)));
    assert(source?.buildAssets && Object.keys(source.buildAssets).length, 'Actual loaded build hashes required'); receipt.buildAssets = {};
    const assetRoot = path.resolve(__dirname, '../dist/assets');
    for (const [name, expected] of Object.entries(source.buildAssets)) { const file = path.resolve(assetRoot, name); assert(inside(assetRoot, file), 'Invalid build asset path'); const actual = hash(await fs.readFile(file)); assert.equal(actual, expected, 'Loaded build hash ' + name); receipt.buildAssets[name] = actual; }
    foreground(); driver = await createDriver(win); foreground();
    const js = async code => { foreground(); const value = await driver.js(code); foreground(); return value; };
    const desktop = () => js("window.aerynthHost.command('desktop',{type:'snapshot'})");
    const noExecution = async () => { const executions = await js("window.aerynthHost.command('executionStatus',{})"); assert(Array.isArray(executions), 'Execution status unavailable'); assert(!executions.some(e => ['running', 'dispatching', 'unknown'].includes(e.state)), 'Active or unknown provider execution forbids this smoke'); };
    const healthy = value => { assert(value.active && !value.failed && !value.contextLost, 'Actual focused GPU unavailable'); assert(Array.isArray(value.errors) && !value.errors.length && !errorCount, 'Renderer/shader/console errors'); assert(Number.isFinite(value.draws) && Number.isFinite(value.frames), 'Actual draw counters unavailable'); };
    await noExecution(); const before = await desktop(); assert(before.navigation.kind === 'workspace' && before.activeWorkspaceId, 'Existing active workspace required');
    const notes = before.resources.filter(r => r.kind === 'note' && r.title === 'Review note native inspection' && r.available !== false && r.state !== 'archived'); assert.equal(notes.length, 1, 'Expected one saved inspection note');
    const note = notes[0], block = before.blocks.find(b => b.resource_id === note.id && b.workspace_id === before.activeWorkspaceId); assert(block, 'Saved note must already be placed in the active workspace'); assert(/^[\w.:-]+$/.test(block.id), 'Invalid canonical block ID'); assert.equal(before.presence?.id, 'system:vela');
    receipt.selection = { resourceId: note.id, blockId: block.id, workspaceId: before.activeWorkspaceId }; receipt.beforeCanonicalDigest = hash(JSON.stringify(canonical(before)));
    const capture = async (name, panel = false) => {
      assert(receipt.captures.length < 2, 'PNG count exceeded'); const prior = await js(expressions.graphics); healthy(prior); let last, stable = panel ? 0 : 3, acknowledgement;
      while (Date.now() < end - 1500) {
        foreground(); const value = await js(expressions.graphics); healthy(value);
        if (panel) { const current = await js(expressions.panel(block.id)); if (current?.opacity >= .995 && current.inBounds && current.state === 'clean' && last && ['x', 'y', 'width', 'height'].every(key => Math.abs(current[key] - last[key]) < .75)) stable++; else stable = 0; last = current; receipt.lastPanel = current; }
        if (stable >= 3 && value.frames > prior.frames && value.draws > prior.draws) { acknowledgement = value; break; }
        if (!tabUsed && Date.now() - started > 800 && await js(expressions.writer)) { foreground(); for (const type of ['keyDown', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode: 'Tab' }); tabUsed = true; receipt.actions.push({ type: 'native-keyboard', key: 'Tab', reason: 'Leave writing focus so production ambient policy can resume normally' }); }
        await pause(80);
      }
      assert(acknowledgement, 'Fresh focused GPU draw/stable panel not acknowledged');
      if (panel) { const fonts = await js(expressions.fonts(block.id)); assert(fonts.items.length, 'Visible note editor/reader required'); for (const item of fonts.items) assert(Number.isFinite(item.scale) && item.scale > 0 && item.pixels + .05 >= 16 * item.scale, 'Note body font below configured 16px scale: ' + JSON.stringify(item)); receipt.noteFonts = fonts; }
      foreground(); const png = (await win.webContents.capturePage()).toPNG(); foreground(); assert(totalBytes + png.length <= receipt.limits.pngBytes, 'PNG byte budget exceeded');
      const file = path.join(out, name + '.png'), captureRecord = { name, file, bytes: png.length, sha256: hash(png), focused: true, before: prior, acknowledgement, written: false, ...(panel ? { panel: last } : {}) }; totalBytes += png.length; receipt.captures.push(captureRecord); await fs.writeFile(file, png); captureRecord.written = true;
    };
    await capture('01-resting-workspace');
    const actions = '.aw-workspace-layout button[aria-label="Workspace actions"]'; await driver.click(actions); foreground(); receipt.actions.push({ type: 'native-mouse', selector: actions });
    const locate = '[data-locate="' + block.id + '"]'; await driver.click(locate); foreground(); receipt.actions.push({ type: 'native-mouse', selector: locate });
    await capture('02-focused-existing-note', true); await noExecution(); const after = await desktop();
    assert.deepEqual(canonical(after), canonical(before), 'Canonical resources/content/placements/geometry/Vela changed'); receipt.afterCanonicalDigest = hash(JSON.stringify(canonical(after))); receipt.camera = { before: before.viewport, after: after.viewport }; receipt.revisions = { before: { desktop: before.revision, layout: before.layoutVersion }, after: { desktop: after.revision, layout: after.layoutVersion } }; receipt.checks.push('same canonical resources/content/geometry/presence', 'actual scaled note body font', 'fresh focused GPU draws', 'zero observed shader/console errors'); assert.equal(errorCount, 0); assert.equal(startupErrors.length, 0, 'Observed startup shader/console errors'); receipt.passed = true;
  };
  win.webContents.on('console-message', consoleError);
  try {
    await Promise.race([run(), new Promise((_resolve, reject) => { timer = setTimeout(() => { expired = true; reject(new Error('visual_smoke_deadline_20s')); app.quit(); }, 20000); })]);
  } catch (error) { receipt.error = { message: error.message, stack: String(error.stack).slice(0, 6000) }; }
  finally {
    expired = true; clearTimeout(timer); win.webContents.removeListener('console-message', consoleError); receipt.elapsedMs = Date.now() - started;
    if (Array.isArray(startupErrors)) { receipt.startupErrors = observedStartup(); if (startupErrors.length) { receipt.passed = false; receipt.error ??= { message: 'Observed startup shader/console errors' }; } }
    try { await fs.mkdir(out, { recursive: true }); const json = JSON.stringify(receipt, null, 2); assert(Buffer.byteLength(json) <= 1024 * 1024, 'Receipt byte budget exceeded'); await fs.writeFile(path.join(out, 'smoke.json'), json); console.log(JSON.stringify({ passed: receipt.passed, error: receipt.error?.message, evidence: out, captures: receipt.captures.length })); }
    finally { process.exitCode = receipt.passed ? 0 : 1; app.quit(); }
  }
  return receipt;
};
