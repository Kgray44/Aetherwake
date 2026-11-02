/* Bounded actual Vela/chat appearance check. No model, edits, refocus or recording. */
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createDriver } = require('./desktop-verify.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = value => createHash('sha256').update(value).digest('hex');

// The actual controller publishes an errors array, not an error count. Reject
// missing counters as well as observed errors before accepting a fresh draw.
const healthyGraphics = value => value?.active === true && value.failed === false && value.contextLost === false
  && Array.isArray(value.errors) && value.errors.length === 0
  && Number.isFinite(value.frames) && Number.isFinite(value.draws);
const freshGraphics = (prior, current) => healthyGraphics(prior) && healthyGraphics(current)
  && current.frames > prior.frames && current.draws > prior.draws;
exports.freshGraphics = freshGraphics;

exports.verify = async ({ win, app, privateRoot, source, startupErrors = [] }) => {
  const started = Date.now(), deadline = started + 15000;
  const out = path.resolve(__dirname, '../.runtime/application-evidence/product-ui-' + started);
  const receipt = { contract: 'aerynth.actual-product-ui@1', source, passed: false, actions: [], captures: [], checks: [],
    limits: { milliseconds: 15000, pngs: 2, pngBytes: 8388608 },
    scope: 'Actual integrated Vela and full conversation UI geometry/type/graphics stills; no inline-block, live-provider, artistic, motion or presentation-performance qualification.' };
  let expired = false, timer, totalBytes = 0, driver;
  const foreground = () => assert(!expired && Date.now() < deadline && !win.isDestroyed() && win.isVisible() && !win.isMinimized() && win.isFocused(), 'native_product_ui_focus_or_deadline');
  const graphics = `(()=>{const s=window.__aerynth.snapshot();return {active:s.active,failed:s.graphicsFailed,errors:s.metrics.errors,draws:s.metrics.draws,frames:s.gpu?.framesRendered,contextLost:s.gpu?.contextLost}})()`;
  const inspect = selector => `(()=>{const root=document.querySelector(${JSON.stringify(selector)}),surface=root?.closest('.aw-contextual-surface');if(!root||!surface)return null;const r=surface.getBoundingClientRect(),body=surface.querySelector('.aw-contextual-content'),composer=root.querySelector('.cp-composer,.vela-core-compose'),input=composer?.querySelector('textarea'),c=composer?.getBoundingClientRect();let opacity=1;for(let e=root;e&&e!==document.body;e=e.parentElement){const s=getComputedStyle(e);if(s.display==='none'||s.visibility==='hidden')return null;opacity*=Number(s.opacity)}return {x:r.x,y:r.y,width:r.width,height:r.height,opacity,inBounds:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,outerScrollHeight:body.scrollHeight,outerClientHeight:body.clientHeight,rootScrollWidth:root.scrollWidth,rootClientWidth:root.clientWidth,composerBottom:c?.bottom,bodyBottom:body.getBoundingClientRect().bottom,inputFont:input?parseFloat(getComputedStyle(input).fontSize):null}})()`;
  const run = async () => {
    assert(/^review-ui-polish-/.test(path.basename(privateRoot)), 'Only a dedicated synthetic polish profile is authorized');
    const setup = JSON.parse(await fs.readFile(path.join(privateRoot, 'ui-polish-setup.json'), 'utf8'));
    assert.equal(setup.contract, 'aerynth.product-ui-setup@1'); assert.equal(setup.syntheticOnly, true);
    await fs.mkdir(out, { recursive: true });
    driver = await createDriver(win); foreground();
    const js = code => { foreground(); return driver.js(code); };
    const click = async selector => { receipt.phase = 'Click ' + selector; foreground(); await driver.click(selector); receipt.actions.push({ type: 'native-mouse', selector }); foreground(); };
    const wait = async (phase, expression) => { receipt.phase = phase; await driver.wait(expression, Math.max(1, deadline - Date.now() - 1200)); foreground(); };
    const desktop = () => js("window.aerynthHost.command('desktop',{type:'snapshot'})");
    const noExecution = async () => assert.deepEqual(await js("window.aerynthHost.command('executionStatus',{})"), [], 'No provider execution authorized');
    await noExecution(); const before = await desktop();
    const capture = async (selector, name) => {
      receipt.phase = 'Inspect ' + selector;
      const prior = await js(graphics); let bounds, acknowledgement;
      for (let sample = 0; sample < 70; sample++) {
        foreground(); bounds = await js(inspect(selector)); const current = await js(graphics);
        receipt.lastBounds = bounds; receipt.lastGraphics = { prior, current };
        if (bounds?.opacity >= .995 && freshGraphics(prior, current)) { acknowledgement = current; break; }
        await pause(60);
      }
      assert(acknowledgement, 'Fresh actual focused GPU draw and visible panel required');
      receipt.lastBounds = bounds;
      assert(bounds.inBounds, 'Product surface outside viewport');
      assert(bounds.rootScrollWidth <= bounds.rootClientWidth + 1, 'Product surface horizontally overflows');
      assert(bounds.outerScrollHeight <= bounds.outerClientHeight + 2, 'Outer surface scrolls instead of transcript');
      assert(bounds.composerBottom <= bounds.bodyBottom + 2, 'Composer extends outside measured host');
      assert(bounds.inputFont >= 15.95, 'Composer below 16px body baseline');
      foreground(); const png = (await win.webContents.capturePage()).toPNG(); foreground();
      assert(receipt.captures.length < 2 && totalBytes + png.length <= 8388608, 'PNG capacity exceeded');
      const file = path.join(out, name + '.png'); await fs.writeFile(file, png); totalBytes += png.length;
      receipt.captures.push({ file, bytes: png.length, sha256: hash(png), bounds, before: prior, acknowledgement });
    };
    // Existing saved placements are preserved. Exercise the real, discoverable
    // viewport-only recovery instead of moving Vela or bypassing hit testing.
    await click('.aw-workspace-layout button[aria-label="Workspace actions"]');
    await click('#locate-vela');
    await wait('Located Vela retains deliberate focus', "document.body.classList.contains('vela-access')");
    await click('#vela');
    await wait('Vela composer mounted', "!!document.querySelector('.vela-core-compose textarea')");
    await click('[data-surface-id="vela"] .aw-contextual-heading');
    await capture('.vela-core', '01-vela');
    await click('[data-surface-id="vela"] .aw-contextual-dismiss');
    await wait('Vela surface closed', "!document.querySelector('[data-surface-id=vela]')");
    await click('#workspace-manager'); await click('#conversation-manager');
    await wait('Actual conversation search ready', "!!document.querySelector('.cp-results button')&&!document.querySelector('.cp-manager').hasAttribute('aria-busy')");
    const index = await js("[...document.querySelectorAll('.cp-results button')].findIndex(e=>e.textContent.includes('Synthetic package local chat'))");
    assert(index >= 0, 'Expected actual synthetic local chat');
    await click('.cp-results button:nth-of-type(' + (index + 1) + ')');
    await wait('Canonical conversation rendered', "!!document.querySelector('.cp-composer textarea')&&!!document.querySelector('.cp-message')");
    await click('[data-surface-id="conversations"] .aw-contextual-heading');
    await capture('.cp-manager', '02-conversation');
    await noExecution(); const after = await desktop();
    for (const resource of before.resources) assert.deepEqual(after.resources.find(value => value.id === resource.id), resource, 'Opening UI changed existing canonical resource');
    assert.deepEqual(after.blocks, before.blocks, 'Opening UI changed canonical placement geometry');
    assert.deepEqual(after.presence, before.presence, 'Opening UI changed saved Vela position');
    assert.equal(startupErrors.length, 0, 'Observed startup graphics/console error');
    receipt.checks.push('same existing canonical resources and placements', 'zero provider execution', 'measured bounded surfaces and stable composers', 'fresh actual GPU draws');
    receipt.passed = true;
  };
  try {
    await Promise.race([run(), new Promise((_, reject) => { timer = setTimeout(() => { expired = true; reject(new Error('native_product_ui_15s_deadline')); app.quit(); }, 15000); })]);
  } catch (error) {
    receipt.error = { message: error.message, stack: String(error.stack).slice(0, 5000) };
    // A labelled failure still is diagnostic evidence, never a passed draw check.
    try {
      foreground();
      if (receipt.captures.length < 2) {
        const png = (await win.webContents.capturePage()).toPNG(); foreground();
        if (totalBytes + png.length <= 8388608) {
          const file = path.join(out, 'failure.png'); await fs.writeFile(file, png);
          receipt.captures.push({ file, bytes: png.length, sha256: hash(png), failure: true, freshDrawQualified: false });
        }
      }
    } catch { /* A lost focus/deadline does not authorize another capture. */ }
  }
  finally {
    expired = true; clearTimeout(timer); receipt.elapsedMs = Date.now() - started;
    receipt.startupErrors = startupErrors.slice(0, 16); if (startupErrors.length) receipt.passed = false;
    try { await fs.mkdir(out, { recursive: true }); const json = JSON.stringify(receipt, null, 2); assert(Buffer.byteLength(json) < 1048576); await fs.writeFile(path.join(out, 'ui.json'), json); console.log(JSON.stringify({ passed: receipt.passed, error: receipt.error?.message, evidence: out, captures: receipt.captures.length })); }
    finally { process.exitCode = receipt.passed ? 0 : 1; app.quit(); }
  }
};
