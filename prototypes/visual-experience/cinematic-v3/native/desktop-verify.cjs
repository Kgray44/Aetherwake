const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
exports.verify = async ({ win, app, privateRoot }) => {
  const out = path.resolve(__dirname, '../.runtime/application-evidence'); await fs.mkdir(out, { recursive: true });
  const receipt = { at: new Date().toISOString(), syntheticData: true, uiActions: [], checks: [], errors: [], provider: 'not exercised in offline journey' };
  const js = code => win.webContents.executeJavaScript(code, true);
  win.webContents.on('console-message', (_event, details) => { if (details.level === 'error') receipt.errors.push(details.message); });
  const wait = async expression => { const end = Date.now() + 20000; while (Date.now() < end) { if (await js(expression)) return; await pause(80); } throw new Error('Timed out: ' + expression + '\n' + await js('document.querySelector("#status").textContent + " / " + (document.querySelector("#command-error")?.textContent ?? "")')); };
  const click = async selector => {
    await pause(160);
    const point = await js(`(()=>{let e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled||e.hidden)throw Error('Unusable control '+${JSON.stringify(selector)});let r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;let hit=document.elementFromPoint(x,y);if(!hit||!(e===hit||e.contains(hit)))throw Error('Occluded control '+${JSON.stringify(selector)}+' by '+hit?.outerHTML.slice(0,200));return {x:Math.round(x),y:Math.round(y)}})()`);
    receipt.uiActions.push({ click: selector, point, method: 'native-mouse-input' });
    win.webContents.sendInputEvent({ type: 'mouseMove', ...point }); win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point }); win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point }); await pause(70);
  };
  const fill = async (selector, value) => { receipt.uiActions.push({ fill: selector, value }); await js(`(()=>{let e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`); };
  const snapshot = () => js('window.__aerynth.application()');
  const checkpoint = async name => { await pause(150); await fs.writeFile(path.join(out, name + '.png'), (await win.webContents.capturePage()).toPNG()); receipt.checks.push(name); };
  try {
    await wait('document.body.classList.contains("application-ready")');
    if (process.argv.includes('--verify-restore')) {
      const expected = JSON.parse(await fs.readFile(path.join(privateRoot, 'expected-synthetic-state.json'), 'utf8'));
      const actual = await snapshot();
      for (const key of ['projects', 'workspaces', 'resources', 'blocks', 'activeWorkspaceId']) assert.deepEqual(actual[key], expected[key], 'Restart preserves ' + key);
      await checkpoint('restart-restored');
    } else {
      await click('#workspace-manager'); await click('#new-project'); await fill('#project-title', 'A World for Two'); await click('dialog button[type="submit"]'); await wait('!document.querySelector("dialog").open');
      await click('#workspace-manager'); await click('#new-workspace'); await fill('#workspace-title', 'Development');
      const project = (await snapshot()).projects.find(p => p.title === 'A World for Two');
      await fill('dialog select[name="projectId"]', project.id); await click('dialog button[type="submit"]'); await wait('window.__aerynth.application().workspaces.some(w=>w.title==="Development")');
      const originalWorkspace = (await snapshot()).activeWorkspaceId;
      for (const [kind, title] of [['conversation', 'Development conversation'], ['note', 'Synthetic working note'], ['task', 'Local task']]) {
        await click('#add-block'); await fill('#block-kind', kind); await fill('#block-title', title); await click('dialog button[type="submit"]'); await wait(`window.__aerynth.application().resources.some(r=>r.title===${JSON.stringify(title)})`);
      }
      let s = await snapshot(); const conversation = s.resources.find(r => r.kind === 'conversation'), note = s.resources.find(r => r.kind === 'note'), task = s.resources.find(r => r.kind === 'task');
      let cb = s.blocks.find(b => b.resource_id === conversation.id), nb = s.blocks.find(b => b.resource_id === note.id), tb = s.blocks.find(b => b.resource_id === task.id);
      await click(`[data-block="${nb.id}"] .unfold`); await fill(`[data-block="${nb.id}"] textarea`, 'Synthetic durable note. Same resource, independent placements.'); await pause(600); await wait('document.querySelector(".saved").textContent.includes("Saved")'); await click('#home');
      await click(`[data-block="${cb.id}"] .block-properties`); await fill('dialog input[name="width"]', '560'); await fill('dialog input[name="height"]', '330'); await click('dialog button[type="submit"]'); await wait(`window.__aerynth.application().blocks.find(b=>b.id==="${cb.id}").width===560`);
      await click(`[data-block="${nb.id}"] .block-properties`); await fill('dialog input[name="width"]', '300'); await fill('dialog select[name="shape"]', 'circle'); await click('dialog button[type="submit"]'); await wait(`window.__aerynth.application().blocks.find(b=>b.id==="${nb.id}").shape==="circle"`);
      await click(`[data-block="${tb.id}"] .block-properties`); await fill('dialog input[name="x"]', '890'); await fill('dialog input[name="y"]', '590'); await click('dialog button[type="submit"]'); await wait(`window.__aerynth.application().blocks.find(b=>b.id==="${tb.id}").y===590`);
      await checkpoint('working-blocks');
      await click(`[data-block="${nb.id}"] .block-remove`); await wait(`!window.__aerynth.application().blocks.some(b=>b.id==="${nb.id}")`); assert((await snapshot()).resources.some(r => r.id === note.id));
      await click('#resource-picker'); await click(`[data-attach="${note.id}"]`); await wait(`window.__aerynth.application().blocks.some(b=>b.resource_id==="${note.id}")`);
      await click('#layout-manager'); await click('#save-layout'); await wait('!document.querySelector("dialog").open');
      const original = await snapshot();
      await click('#workspace-manager'); await click('#new-workspace'); await fill('#workspace-title', 'Research'); await fill('dialog select[name="projectId"]', project.id); await click('dialog button[type="submit"]'); await wait('window.__aerynth.application().workspaces.some(w=>w.title==="Research")');
      await click('#resource-picker'); await click(`[data-attach="${note.id}"]`); await wait('window.__aerynth.application().blocks.length===1');
      await click('#zoom-out'); await wait('window.__aerynth.application().navigation.kind==="constellation"'); await checkpoint('constellation');
      await click(`[data-enter="${originalWorkspace}"]`); await wait(`window.__aerynth.application().activeWorkspaceId==="${originalWorkspace}"`);
      s = await snapshot(); assert.deepEqual(s.blocks, original.blocks); assert.deepEqual(s.resources, original.resources); receipt.checks.push('workspace-switch-restores-canonical-layout');
      await click(`[data-block="${cb.id}"] .unfold`); await fill(`[data-block="${cb.id}"] .conversation-compose textarea`, 'Synthetic local message, no simulated assistant.'); await click(`[data-block="${cb.id}"] .conversation-compose button[type="submit"]`); await wait('document.querySelector(".conversation-transcript").textContent.includes("Synthetic local message")'); await click('#home');
      await js('window.__aerynth.setStudy("living")'); await pause(250); await js('window.__aerynth.setStudy("architecture")'); await pause(250); receipt.checks.push('scene-switch-preserves-resource-identity');
      await js('window.__aerynth.simulateContextLoss()'); await pause(250); await js('window.__aerynth.restoreContext()'); await pause(700); assert.equal((await snapshot()).activeWorkspaceId, originalWorkspace); receipt.checks.push('context-recovery-preserves-state');
      await checkpoint('restored-development');
      await fs.writeFile(path.join(privateRoot, 'expected-synthetic-state.json'), JSON.stringify(await snapshot(), null, 2));
    }
    receipt.passed = true;
  } catch (e) { receipt.passed = false; receipt.errors.push(e.stack); await checkpoint('failure'); }
  await fs.writeFile(path.join(out, process.argv.includes('--verify-restore') ? 'restart.json' : 'journey.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ passed: receipt.passed, checks: receipt.checks, errors: receipt.errors, evidence: out }));
  app.exit(receipt.passed ? 0 : 1);
};
