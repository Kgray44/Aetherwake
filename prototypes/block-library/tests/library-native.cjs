const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { createDriver } = require('../../visual-experience/cinematic-v3/native/desktop-verify.cjs');
const { verificationOptions, createInlineDraftGuard } = require('../../visual-experience/cinematic-v3/native/inline-draft-guard.cjs');
const q = JSON.stringify, digest = value => createHash('sha256').update(value).digest('hex');

exports.options = (argv, started) => ({ ...verificationOptions(argv, started), restore: argv.includes('--verify-restore') });
exports.persistent = state => ({ resources: state.resources, relationships: state.relationships, projects: state.projects, workspaces: state.workspaces });
exports.workspace = state => ({ blocks: state.blocks, viewport: state.viewport, organization: state.organization, presence: state.presence });

/** Operator Escape cancels the entire run; automation never sends Escape. */
exports.createGuard = (win, limits) => {
  const base = createInlineDraftGuard(win, limits);
  let aborted = false;
  const check = () => { base.check(); assert(!aborted, 'library_native_operator_escape'); };
  check();
  const contents = win.webContents;
  const escape = (event, input) => { if (input.type === 'keyDown' && input.key === 'Escape') { aborted = true; event.preventDefault?.(); } };
  contents.on('before-input-event', escape);
  return {
    check,
    async around(work) { check(); const value = await base.around(work); check(); return value; },
    input(event) { check(); base.input(event); check(); },
    insertText(value) { return this.around(() => base.insertText(value)); },
    pause(ms) { return this.around(() => base.pause(ms)); },
    capture() { return this.around(() => base.capture()); },
    dispose() { contents.removeListener('before-input-event', escape); },
  };
};

/** Parent-owned native slot only. All creation/capture/attachment/instantiation
 * and navigation use actual UI input. Host RPCs below are read-only checks. */
exports.verify = async ({ win, app, privateRoot, source, moduleStarted, startupErrors = [] }) => {
  const output = path.resolve(__dirname, '../../visual-experience/cinematic-v3/.runtime/application-evidence/library-templates-' + Date.now() + '-' + randomUUID().slice(0, 8));
  const receipt = { contract: 'aerynth.library-template-evidence@1', syntheticOnly: true, passed: false, source, actions: [], checks: [], screenshots: [], errors: [], limitations: ['Schema preparation creates no ordinary identities.', 'Read-only RPC checks are not substitutes for native creation or form interaction.', 'No provider connection, authentication probe, model turn or synthetic assistant response is requested.', 'This covers journeys A/C; it does not qualify full B/D/E/F, performance or owner artistic acceptance.'] };
  let guard, limits, driver, captureFailure, inspectFailure, consoleSource;
  const consoleError = (_event, details) => { if (details.level === 'error' && receipt.errors.length < 20) receipt.errors.push(String(details.message).slice(0, 1000)); };
  let observingConsole = false;
  const startup = () => {
    receipt.startupErrorCount = Array.isArray(startupErrors) ? startupErrors.length : 1;
    receipt.startupErrors = Array.isArray(startupErrors) ? startupErrors.slice(0, 20).map(value => String(value?.message ?? value).slice(0, 1000)) : ['Invalid startup error collection'];
  };
  try {
    limits = exports.options(process.argv, moduleStarted);
    receipt.limits = limits;
    guard = exports.createGuard(win, limits);
    assert(/^review-workspace-native-ac-/.test(path.basename(privateRoot)), 'dedicated_library_profile_required');
    startup(); assert.equal(receipt.startupErrorCount, 0, 'Observed startup graphics/console error');
    consoleSource = win.webContents; consoleSource.on('console-message', consoleError); observingConsole = true;
    const readJson = async (name, maximum) => {
      const file = path.join(privateRoot, name), stat = await guard.around(() => fs.stat(file));
      assert(stat.size <= maximum, 'library_native_json_bytes_exceeded');
      return JSON.parse(await guard.around(() => fs.readFile(file, 'utf8')));
    };
    const seed = await readJson('library-native-seed.json', 65536);
    assert.equal(seed.contract, 'aerynth.library-template-native@1'); assert.equal(seed.syntheticOnly, true);
    assert.deepEqual(seed.ordinaryCounts, { projects: 0, workspaces: 0, resources: 0 });
    assert(source?.hashes && typeof source.hashes === 'object' && !Array.isArray(source.hashes), 'host_source_identity_required');
    assert(Object.keys(seed.hashes).length > 0 && Object.keys(seed.hashes).length <= 8);
    for (const [name, hash] of Object.entries(seed.hashes)) {
      assert(/^prototypes\/[a-zA-Z0-9_./-]+$/.test(name) && !name.includes('..'));
      assert.equal(digest(await guard.around(() => fs.readFile(path.resolve(__dirname, '../../..', name)))), hash, 'Preparation source changed: ' + name);
      if (!name.includes('/tests/') && !name.endsWith('/prepare-library-native.mts')) assert.equal(source.hashes[name], hash, 'Host/preparation runtime source binding differs');
      else if (source.hashes[name]) assert.equal(source.hashes[name], hash, 'Host/preparation helper source binding differs');
    }
    receipt.preparationHashes = seed.hashes;
    receipt.helperSha256 = digest(await guard.around(() => fs.readFile(__filename)));
    driver = await guard.around(() => createDriver(win, { assertActive: guard.check }));
    const js = code => guard.around(() => driver.js(code));
    const wait = expression => guard.around(() => driver.wait(expression, Math.min(8000, Math.max(1, limits.deadlineAt - Date.now()))));
    const snapshot = () => guard.around(() => driver.snapshot());
    await wait('!!window.__aerynth.application()?.navigation');
    const readLibrary = async (name, input = {}) => (await js(`window.aerynthHost.command('library',${q({ name, input })})`)).result;
    const cp = (name, input) => js(`window.aerynthHost.command('conversation',${q({ name, input })})`);
    const key = (keyCode, modifiers = []) => { guard.input({ type: 'keyDown', keyCode, modifiers }); guard.input({ type: 'keyUp', keyCode, modifiers }); };
    const click = async selector => { receipt.lastIntent = { action: 'native click', selector }; await guard.around(() => driver.click(selector)); receipt.actions.push(receipt.lastIntent); };
    const type = async (selector, value) => { await click(selector); key('A', ['control']); await guard.insertText(value); receipt.actions.push({ action: 'native text input', selector, value }); };
    const domPath = (scope, expression) => js(`(()=>{const root=document.querySelector(${q(scope)});if(!root)return null;const e=(${expression});if(!e||!root.contains(e))return null;const parts=[];for(let n=e;n!==root;n=n.parentElement){if(!n?.parentElement)return null;parts.unshift(n.tagName.toLowerCase()+':nth-child('+([...n.parentElement.children].indexOf(n)+1)+')')}return ${q(scope)}+(parts.length?' > '+parts.join(' > '):'')})()`);
    const button = async (scope, label, prefix = false) => {
      const expr = `[...root.querySelectorAll('button')].find(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e),t=e.textContent.trim();return r.width>0&&r.height>0&&s.visibility!=='hidden'&&!e.disabled&&${prefix ? `t.startsWith(${q(label)})` : `t===${q(label)}`}})`;
      await wait(`(()=>{const root=document.querySelector(${q(scope)});return !!root&&!!(${expr})})()`);
      const selector = await domPath(scope, expr); assert(selector, 'Actual labeled button missing: ' + label); return click(selector);
    };
    const field = async (scope, label) => {
      const selector = await domPath(scope, `[...root.querySelectorAll('label')].find(e=>e.firstChild?.textContent?.trim()===${q(label)})?.querySelector('input,select,textarea')`);
      assert(selector, 'Actual labeled field missing: ' + label); return selector;
    };
    const summary = async (scope, label) => {
      const selector = await domPath(scope, `[...root.querySelectorAll('summary')].find(e=>e.textContent.trim()===${q(label)})`);
      assert(selector, 'Actual disclosure missing: ' + label); await click(selector);
    };
    const select = async (selector, value) => {
      const index = await js(`(()=>{const e=document.querySelector(${q(selector)});return e?[...e.options].findIndex(o=>o.value===${q(value)}&&!o.disabled):-1})()`);
      assert(index >= 0 && index <= 60, 'Supported native select option missing: ' + value);
      await click(selector); key('Home'); for (let n = 0; n < index; n++) key('Down'); key('Enter');
      await wait(`document.querySelector(${q(selector)})?.value===${q(value)}`);
      receipt.actions.push({ action: 'native select', selector, value });
    };
    const card = id => '[data-block=' + q(id) + ']';
    const point = async selector => {
      const p = await js(`(()=>{const e=document.querySelector(${q(selector)}),r=e?.getBoundingClientRect();if(!r?.width||!r.height)return null;const x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2),h=document.elementFromPoint(x,y);return h&&(e===h||e.contains(h))?{x,y}:null})()`);
      assert(p, 'Actual unobstructed native target missing: ' + selector); return p;
    };
    const context = async id => {
      const p = await point(card(id) + ' .card-kind-label');
      guard.input({ type: 'mouseMove', ...p }); guard.input({ type: 'mouseDown', ...p, button: 'right', clickCount: 1 }); guard.input({ type: 'mouseUp', ...p, button: 'right', clickCount: 1 });
      receipt.actions.push({ action: 'native card context menu', blockId: id });
      await wait('!!document.querySelector("dialog[open] #detach-card")');
    };
    const drag = async (selector, dx, dy) => {
      const p = await point(selector);
      guard.input({ type: 'mouseMove', ...p }); guard.input({ type: 'mouseDown', ...p, button: 'left', clickCount: 1 });
      for (let n = 1; n <= 8; n++) { guard.input({ type: 'mouseMove', x: Math.round(p.x + dx * n / 8), y: Math.round(p.y + dy * n / 8), modifiers: ['leftbuttondown'] }); await guard.pause(20); }
      guard.input({ type: 'mouseUp', x: Math.round(p.x + dx), y: Math.round(p.y + dy), button: 'left', clickCount: 1 });
      receipt.actions.push({ action: 'native drag', selector, dx, dy });
    };
    const graphics = () => js(`(()=>{const s=window.__aerynth.snapshot();return {failed:s.graphicsFailed,contextLost:s.gpu?.contextLost,errorCount:s.metrics.errors.length,errors:s.metrics.errors.slice(0,20).map(e=>String(e).slice(0,1000)),draws:s.metrics.draws}})()`);
    inspectFailure = async () => ({ graphics: await graphics(), context: await js(`({activeWorkspaceId:window.__aerynth.application()?.activeWorkspaceId,libraryStatus:document.querySelector('.aw-library__status')?.textContent?.slice(0,1000),commandStatus:document.querySelector('#command-error')?.textContent?.slice(0,1000)})`) });
    const shot = async name => {
      assert(receipt.screenshots.length < limits.maxScreenshots, 'native_capture_count_exceeded');
      const before = await graphics(); await wait(`window.__aerynth.snapshot().metrics.draws>${before.draws}`);
      const health = await graphics(); assert(!health.failed && !health.contextLost && health.errorCount === 0, 'Healthy actual renderer required');
      const png = (await guard.capture()).toPNG(); receipt.pngBytes = (receipt.pngBytes ?? 0) + png.length;
      assert(receipt.pngBytes <= limits.maxPngBytes, 'native_capture_bytes_exceeded');
      await guard.around(() => fs.mkdir(output, { recursive: true })); await guard.around(() => fs.writeFile(path.join(output, name + '.png'), png, { flag: 'wx' }));
      receipt.screenshots.push({ file: name + '.png', bytes: png.length, sha256: digest(png), draws: health.draws });
    };
    captureFailure = () => shot('native-library-template-failure');
    const ensureNoExecution = async () => assert.deepEqual(await js("window.aerynthHost.command('executionStatus',{})"), []);
    const navigate = async id => { await click('#workspace-manager'); await click('dialog[open] [data-workspace=' + q(id) + ']'); await wait(`window.__aerynth.application().navigation.kind==='workspace'&&window.__aerynth.application().activeWorkspaceId===${q(id)}`); };
    const openTemplates = async projectId => {
      await click('#workspace-manager'); await click('dialog[open] #new-workspace');
      await select('dialog[open] select[name="projectId"]', projectId); await click('dialog[open] #workspace-templates');
      await wait('!!document.querySelector(".aw-library input[aria-label=\"Search workspace templates\"]")');
    };
    const openKind = async kind => {
      await click('.aw-workspace-add'); await wait('!!document.querySelector(".aw-library input[aria-label=\"Search blocks\"]")');
      await type('.aw-library input[aria-label="Search blocks"]', kind === 'conversation' ? 'chat' : kind);
      await click('.aw-library__list [data-block-kind=' + q(kind) + ']'); await wait('!!document.querySelector(".aw-library__detail > form")');
    };
    const create = async (kind, title) => {
      await openKind(kind); const scope = '.aw-library__detail > form'; await type(await field(scope, 'Title'), title);
      if (kind === 'conversation') await select(await field(scope, 'Conversation backend'), 'local');
      if (kind === 'conversation' && receipt.screenshots.length === 0) await shot('native-block-library-chat');
      await click(scope + ' > button[type="submit"]'); await wait('!document.querySelector(".aw-library")');
      const state = await snapshot(), resource = state.resources.find(r => r.title === title), block = state.blocks.find(b => b.resource_id === resource?.id);
      assert(resource && block && resource.kind === kind, 'Native Library creation did not produce the canonical resource/placement');
      receipt.checks.push('Actual native Library creation: ' + kind); return { resourceId: resource.id, blockId: block.id };
    };
    const attachNote = async (noteId, title) => {
      await openKind('note'); await summary('.aw-library__detail', 'Attach Existing');
      await type('.aw-library input[placeholder="Search compatible resources"]', title);
      await button('.aw-library__resources', 'Attach ' + title); await wait('!document.querySelector(".aw-library")');
      const state = await snapshot(), blocks = state.blocks.filter(b => b.resource_id === noteId); assert.equal(blocks.length, 1); return blocks[0].id;
    };
    const configure = async (blockId, value) => {
      const before = await js(`(()=>{const e=document.querySelector(${q(card(blockId))});return {scale:parseFloat(getComputedStyle(e).getPropertyValue('--aw-block-text-scale'))||1,font:parseFloat(getComputedStyle(e.querySelector('textarea')).fontSize)}})()`);
      await context(blockId); await wait('!!document.querySelector(".aw-library__configuration button[type=submit]")&&!document.querySelector(".aw-library__configuration button[type=submit]").disabled');
      await select(await field('.aw-library__configuration', 'Text scale'), String(value));
      await button('.aw-library__configuration', 'Save block presentation');
      await wait(`window.aerynthHost.command('library',{name:'getBlockSettings',input:${q(blockId)}}).then(r=>r.result.configuration.textScale===${value})`);
      await click('dialog[open] [data-close]');
      const font = await js(`parseFloat(getComputedStyle(document.querySelector(${q(card(blockId) + ' textarea')})).fontSize)`);
      assert(Math.abs(font - before.font * value / before.scale) < 0.1, 'Actual editor typography must honor the saved scale');
      (receipt.fonts ??= []).push({ blockId, textScale: value, fontPx: font });
    };
    await ensureNoExecution();
    if (limits.restore) {
      receipt.phase = 'A/C fresh-process restoration';
      const expected = await readJson('library-native-expected.json', limits.maxCheckpointBytes);
      assert.equal(expected.contract, 'aerynth.library-template-checkpoint@1');
      assert.equal((await snapshot()).activeWorkspaceId, expected.activeWorkspaceId, 'Actual saved active workspace');
      assert.deepEqual(exports.persistent(await snapshot()), expected.canonical);
      assert.deepEqual(await readLibrary('getTemplate', expected.template.id), expected.template);
      for (const [id, state] of Object.entries(expected.workspaces)) { await navigate(id); assert.deepEqual(exports.workspace(await snapshot()), state, 'Exact restored workspace: ' + id); }
      for (const [id, settings] of Object.entries(expected.configurations)) assert.deepEqual(await readLibrary('getBlockSettings', id), settings);
      for (const [id, text] of Object.entries(expected.chatDrafts)) assert.equal((await cp('readDraft', { resourceId: id })).content, text);
      await navigate(expected.activeWorkspaceId);
      await wait(`document.querySelector(${q(card(expected.instanceNoteBlockId) + ' textarea')})?.value===${q(expected.noteText)}`);
      await wait(`Math.abs(parseFloat(getComputedStyle(document.querySelector(${q(card(expected.instanceNoteBlockId) + ' textarea')})).fontSize)-${expected.instanceNoteFontPx})<.1`);
      await shot('restored-template-instance');
      receipt.checks.push('Separate fresh process restores both workspaces, canonical IDs/content, per-placement configuration, template and independent Chat drafts without replay');
    } else {
      receipt.phase = 'A native Library';
      const initial = await snapshot(), labels = seed.labels;
      assert.deepEqual([initial.projects.length, initial.workspaces.length, initial.resources.length, initial.blocks.length], [0, 0, 0, 0], 'No preseeded ordinary identities');
      receipt.initialOrdinaryCounts = { projects: 0, workspaces: 0, resources: 0, placements: 0 };
      await click('#workspace-manager'); await click('dialog[open] #new-project'); await type('dialog[open] #project-title', labels.project); await click('dialog[open] form button[type="submit"]');
      await wait(`window.__aerynth.application().projects.some(p=>p.title===${q(labels.project)})`);
      const project = (await snapshot()).projects.find(p => p.title === labels.project); assert(project);
      await openTemplates(project.id); await type('.aw-library input[aria-label="Search workspace templates"]', 'Blank'); await button('.aw-library__list', 'Blank ·', true);
      await type(await field('.aw-library__detail > form', 'Workspace name'), labels.workspace); await button('.aw-library__detail > form', 'Check template'); await button('.aw-library__detail > form', 'Create workspace');
      await wait(`!document.querySelector('.aw-library')&&window.__aerynth.application().workspaces.some(w=>w.title===${q(labels.workspace)})`);
      const blank = await snapshot(), originalId = blank.activeWorkspaceId; assert.equal(blank.blocks.length, 0); assert.equal(blank.resources.length, 0); assert.equal(blank.organization.mode, 'fluid'); assert.equal(blank.workspaces.find(w => w.id === originalId).project_id, project.id);
      const chat = await create('conversation', labels.chat), note = await create('note', labels.note), task = await create('task', labels.task);
      receipt.created = { projectId: project.id, workspaceId: originalId, chat, note, task };
      await click('[data-organization-mode="freeform"]'); await wait("window.__aerynth.application().organization.mode==='freeform'");
      await click(card(task.blockId) + ' .local-task-state input[type="checkbox"]'); await wait(`window.__aerynth.application().resources.find(r=>r.id===${q(task.resourceId)})?.taskStatus==='done'`);
      const message = 'Synthetic native Library message recorded once', oldDraft = 'Synthetic original Chat draft stays with its resource', instanceDraft = 'Synthetic instance Chat draft is independent';
      await type(card(chat.blockId) + ' .cp-composer textarea', message); await click(card(chat.blockId) + ' .cp-composer button[type="submit"]');
      await wait(`window.aerynthHost.command('conversation',{name:'detail',input:{resourceId:${q(chat.resourceId)},limit:50}}).then(r=>r.messages.total===1&&r.messages.items[0].role==='user'&&r.messages.items[0].content===${q(message)})`);
      await wait(`document.querySelector(${q(card(chat.blockId) + ' .cp-composer textarea')})?.value===''`);
      assert.equal((await cp('readDraft', { resourceId: chat.resourceId })).content, '', 'Actual acknowledged Send clears its original draft');
      await type(card(chat.blockId) + ' .cp-composer textarea', oldDraft);
      let noteText = 'Synthetic native reusable Note.\nCreated using actual keyboard input.';
      await type(card(note.blockId) + ' textarea', noteText); await wait(`window.__aerynth.application().resources.find(r=>r.id===${q(note.resourceId)})?.content===${q(noteText)}`);
      await context(note.blockId); await click('dialog[open] #detach-card'); await wait(`!window.__aerynth.application().blocks.some(b=>b.resource_id===${q(note.resourceId)})`);
      note.blockId = await attachNote(note.resourceId, labels.note);
      await wait(`document.querySelector(${q(card(note.blockId) + ' textarea')})?.value===${q(noteText)}&&window.__aerynth.application().resources.find(r=>r.id===${q(note.resourceId)})?.content===${q(noteText)}`);
      noteText += '\nEdited after attaching the same canonical Note.';
      await type(card(note.blockId) + ' textarea', noteText); await wait(`window.__aerynth.application().resources.find(r=>r.id===${q(note.resourceId)})?.content===${q(noteText)}`);
      const removedId = note.blockId; await context(note.blockId); await click('dialog[open] #detach-card'); await wait(`!window.__aerynth.application().blocks.some(b=>b.id===${q(removedId)})`);
      note.blockId = await attachNote(note.resourceId, labels.note); assert.notEqual(note.blockId, removedId); assert.equal((await snapshot()).resources.filter(r => r.id === note.resourceId).length, 1);
      await wait(`document.querySelector(${q(card(note.blockId) + ' textarea')})?.value===${q(noteText)}`);
      const priorResize = await snapshot(); await drag(card(chat.blockId) + ' [data-resize-edge="se"]', 24, -40); await wait(`window.__aerynth.application().layoutVersion>${priorResize.layoutVersion}`);
      const moved = await snapshot(), beforeNote = moved.blocks.find(b => b.id === note.blockId); await drag(card(note.blockId) + ' .card-kind-label', 24, 20); await wait(`window.__aerynth.application().layoutVersion>${moved.layoutVersion}`);
      const afterMove = (await snapshot()).blocks.find(b => b.id === note.blockId); assert(afterMove.x !== beforeNote.x || afterMove.y !== beforeNote.y, 'Native freeform arrangement must commit');
      await configure(note.blockId, 1.25);
      receipt.checks.push('A: Native project/Blank/Chat/Note/Task creation, local recording, native resize, Note attach/edit/detach/reattach preserve canonical identity and content');

      receipt.phase = 'C native named Template';
      assert.equal((await cp('readDraft', { resourceId: chat.resourceId })).content, oldDraft, 'Original independent draft is durable before capture');
      const sourceState = await snapshot(), configurations = {};
      for (const b of sourceState.blocks) configurations[b.id] = await readLibrary('getBlockSettings', b.id);
      await openTemplates(project.id); await button('.aw-library__toolbar', 'Save current workspace as template');
      await type(await field('.aw-library__detail > form', 'Template name'), labels.template);
      for (const [id, kind] of [[chat.resourceId, 'conversation'], [note.resourceId, 'note'], [task.resourceId, 'task']]) {
        const title = sourceState.resources.find(r => r.id === id).title;
        await select(await field('.aw-library__detail > form', title + ' · ' + kind), kind === 'conversation' ? 'new' : 'reference');
      }
      await button('.aw-library__detail > form', 'Save template');
      await wait(`window.aerynthHost.command('library',{name:'listTemplates',input:{query:${q(labels.template)}}}).then(r=>r.result.some(t=>t.name===${q(labels.template)}))`);
      const summaries = await readLibrary('listTemplates', { query: labels.template }), template = await readLibrary('getTemplate', summaries.find(t => t.name === labels.template).id);
      assert.equal(template.body.placements.length, 3); assert.equal(template.body.organization.mode, 'freeform');
      assert.equal(template.body.resources.filter(r => r.source.mode === 'new').length, 1);
      assert.deepEqual(new Set(template.body.resources.filter(r => r.source.mode === 'reference').map(r => r.source.resourceId)), new Set([note.resourceId, task.resourceId]));
      const serialized = JSON.stringify(template); for (const privateText of [noteText, message, oldDraft]) assert(!serialized.includes(JSON.stringify(privateText).slice(1, -1)), 'Template must not copy source content/drafts');
      assert.equal(await js('document.querySelector(".aw-library__layout")?.children.length'), 3, 'Actual template layout preview');
      await shot('native-saved-template-preview'); await click('.aw-library__header button');
      const leave = await js(`(()=>{for(let y=150;y<innerHeight-80;y+=45)for(let x=45;x<innerWidth-40;x+=55){const e=document.elementFromPoint(x,y);if(e&&['world','stage','app'].includes(e.id))return{x,y}}return null})()`); assert(leave, 'Actual empty background for workspace departure');
      const dpi = await js('devicePixelRatio'); assert(Number.isFinite(dpi) && dpi > 0 && dpi <= 16);
      guard.input({ type: 'mouseMove', ...leave }); guard.input({ type: 'mouseWheel', ...leave, deltaX: 0, deltaY: -120 * dpi, canScroll: true });
      receipt.actions.push({ action: 'native wheel leaves source workspace', domDeltaY: 120 }); await wait("window.__aerynth.application().navigation.kind==='constellation'");
      await openTemplates(project.id); await type('.aw-library input[aria-label="Search workspace templates"]', labels.template); await button('.aw-library__list', labels.template + ' ·', true);
      await type(await field('.aw-library__detail > form', 'Workspace name'), labels.instance); await button('.aw-library__detail > form', 'Check template');
      await wait(`document.querySelector('.aw-library__detail').textContent.includes('1 new resources, 2 references, 3 placements')`);
      await button('.aw-library__detail > form', 'Create workspace'); await wait(`!document.querySelector('.aw-library')&&window.__aerynth.application().workspaces.some(w=>w.title===${q(labels.instance)})`);
      const instance = await snapshot(), instanceId = instance.activeWorkspaceId; assert.notEqual(instanceId, originalId); assert.equal(instance.blocks.length, 3);
      assert.equal(instance.workspaces.find(w => w.id === instanceId).project_id, project.id);
      const instanceNote = instance.blocks.find(b => b.resource_id === note.resourceId), instanceTask = instance.blocks.find(b => b.resource_id === task.resourceId), instanceChat = instance.blocks.find(b => ![note.resourceId, task.resourceId].includes(b.resource_id));
      assert(instanceNote && instanceTask && instanceChat); assert.notEqual(instanceChat.resource_id, chat.resourceId);
      const emptyChat = await cp('detail', { resourceId: instanceChat.resource_id, limit: 50 }); assert.equal(emptyChat.messages.total, 0); assert.equal((await cp('readDraft', { resourceId: instanceChat.resource_id })).content, '');
      await wait(`document.querySelector(${q(card(instanceChat.id) + ' .cp-composer textarea')})?.value===''`);
      for (const original of sourceState.blocks) {
        const originalResource = sourceState.resources.find(r => r.id === original.resource_id), placed = originalResource.kind === 'conversation' ? instanceChat : instance.blocks.find(b => b.resource_id === original.resource_id);
        assert.notEqual(placed.id, original.id);
        for (const key of ['x', 'y', 'width', 'height', 'z', 'shape', 'rotation', 'locked', 'minimized', 'materialVariant']) assert.deepEqual(placed[key], original[key], 'Captured explicit geometry: ' + key);
        assert.deepEqual((await readLibrary('getBlockSettings', placed.id)).configuration, configurations[original.id].configuration);
      }
      await configure(instanceNote.id, 1.5); await type(card(instanceChat.id) + ' .cp-composer textarea', instanceDraft);
      await wait(`window.aerynthHost.command('conversation',{name:'readDraft',input:{resourceId:${q(instanceChat.resource_id)}}}).then(r=>r.content===${q(instanceDraft)})`);
      const beforeInstanceResize = await snapshot(); await drag(card(instanceNote.id) + ' [data-resize-edge="se"]', 24, 20); await wait(`window.__aerynth.application().layoutVersion>${beforeInstanceResize.layoutVersion}`);
      const instanceNoteFontPx = receipt.fonts.find(value => value.blockId === instanceNote.id).fontPx;
      await wait(`Math.abs(parseFloat(getComputedStyle(document.querySelector(${q(card(instanceNote.id) + ' textarea')})).fontSize)-${instanceNoteFontPx})<.1`);
      assert.deepEqual(await readLibrary('getTemplate', template.id), template, 'Changing instance must not change saved template');
      const instanceState = exports.workspace(await snapshot()); await navigate(originalId);
      assert.deepEqual(exports.workspace(await snapshot()), exports.workspace(sourceState), 'Original workspace geometry/presence/viewport remains exact');
      assert.deepEqual((await readLibrary('getBlockSettings', note.blockId)).configuration, configurations[note.blockId].configuration);
      assert.equal((await cp('readDraft', { resourceId: chat.resourceId })).content, oldDraft);
      await navigate(instanceId); assert.deepEqual(exports.workspace(await snapshot()), instanceState);
      const final = await snapshot(), checkpoint = { contract: 'aerynth.library-template-checkpoint@1', activeWorkspaceId: instanceId, instanceNoteBlockId: instanceNote.id, instanceNoteFontPx, noteText, template, canonical: exports.persistent(final), workspaces: { [originalId]: exports.workspace(sourceState), [instanceId]: instanceState }, configurations: {}, chatDrafts: { [chat.resourceId]: oldDraft, [instanceChat.resource_id]: instanceDraft } };
      for (const workspace of Object.values(checkpoint.workspaces)) for (const b of workspace.blocks) checkpoint.configurations[b.id] = await readLibrary('getBlockSettings', b.id);
      const encoded = Buffer.from(JSON.stringify(checkpoint)); assert(encoded.length <= limits.maxCheckpointBytes, 'library_checkpoint_bytes_exceeded');
      await guard.around(() => fs.writeFile(path.join(privateRoot, 'library-native-expected.json'), encoded, { flag: 'wx' }));
      receipt.checks.push('C: Actual native named capture/preview/instantiate preserves references, empty-new Chat semantics, explicit geometry and per-placement configuration; independent drafts and immutable template/original workspace survive instance changes');
    }
    await ensureNoExecution(); receipt.finalGraphics = await graphics();
    assert(!receipt.finalGraphics.failed && !receipt.finalGraphics.contextLost && receipt.finalGraphics.errorCount === 0); assert.deepEqual(receipt.errors, []); startup(); assert.equal(receipt.startupErrorCount, 0);
    receipt.passed = true;
  } catch (error) {
    receipt.error = String(error?.stack ?? error).slice(0, 12000);
    if (inspectFailure) try { receipt.failureState = await inspectFailure(); } catch (probeError) { receipt.failureStateUnavailable = String(probeError?.message ?? probeError).slice(0,1000); }
    if (captureFailure && receipt.screenshots.length < (limits?.maxScreenshots ?? 0)) try { await captureFailure(); } catch (captureError) { receipt.failureCaptureUnavailable = String(captureError?.message ?? captureError).slice(0,1000); }
  } finally {
    if (Number.isFinite(moduleStarted)) receipt.elapsedFromHostStartMs = Date.now() - moduleStarted;
    startup(); if (receipt.startupErrorCount || receipt.errors.length) receipt.passed = false;
    try { if (observingConsole) consoleSource.removeListener('console-message', consoleError); }
    catch (error) { receipt.passed = false; receipt.cleanupError = String(error?.message ?? error).slice(0,1000); }
    try { guard?.dispose(); }
    catch (error) { receipt.passed = false; receipt.cleanupError = String(error?.message ?? error).slice(0,1000); }
    const bytes = Buffer.from(JSON.stringify(receipt, null, 2));
    try { assert(bytes.length <= (limits?.maxJsonBytes ?? 524288), 'library_receipt_bytes_exceeded'); await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'library-native.json'), bytes, { flag: 'wx' }); }
    catch (error) { receipt.passed = false; receipt.error = String(error?.message ?? error).slice(0,1000); }
    finally { try { process.stdout.write(JSON.stringify({ passed: receipt.passed, evidence: output, error: receipt.error }) + '\n'); } finally { app.exit(receipt.passed ? 0 : 1); } }
  }
  return receipt;
};
