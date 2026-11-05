const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const {
  createDriver,
} = require("../../visual-experience/cinematic-v3/native/desktop-verify.cjs");
const {
  verificationOptions,
  createInlineDraftGuard,
} = require("../../visual-experience/cinematic-v3/native/inline-draft-guard.cjs");

const kinds = [
  "conversation",
  "note",
  "research",
  "task",
  "task_group",
  "reference",
  "stream",
  "project_overview",
  "resource_browser",
  "collection_browser",
];
exports.options = (argv, moduleStarted) => ({
  ...verificationOptions(argv, moduleStarted),
  restore: argv.includes("--verify-restore"),
});
exports.workspaceState = (state) => ({
  blocks: state.blocks,
  organization: state.organization,
  viewport: state.viewport,
  presence: state.presence,
});
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const q = JSON.stringify;
const { consoleErrorHandler } = require('./native-console.cjs');
exports.consoleHandler = consoleErrorHandler;

/** Run ONLY in a parent-owned native slot. Preparation/navigation commands are
 * recorded fixture actions. User-facing controls use native input, never JS
 * click(), dispatchEvent(), value assignment or forced focus acquisition. */
exports.verify = async ({
  win,
  app,
  privateRoot,
  source,
  moduleStarted,
  startupErrors = [],
  inspectProviderState,
}) => {
  if (process.argv.includes('--verify-library-templates'))
    return require('./library-native.cjs').verify({ win, app, privateRoot, source, moduleStarted, startupErrors });
  if (process.argv.includes('--verify-approach'))
    return require('./workspace-approach.cjs').verify({ win, app, privateRoot, source, moduleStarted, startupErrors });
  if (process.argv.includes('--verify-minimize'))
    return require('./workspace-minimize.cjs').verify({ win, app, privateRoot, source, moduleStarted, startupErrors });
  if (process.argv.includes('--verify-resource-links'))
    return require('./workspace-resource-links.cjs').verify({ win, app, privateRoot, source, moduleStarted, startupErrors });
  if (process.argv.includes('--verify-structured-grid'))
    return require('./workspace-structured-grid.cjs').verify({ win, app, privateRoot, source, moduleStarted, startupErrors });
  if (process.argv.includes('--verify-functional-workspace'))
    return require('./workspace-functional.cjs').verify({ win, app, privateRoot, source, moduleStarted, startupErrors, inspectProviderState });
  const output = path.resolve(
    __dirname,
    "../../visual-experience/cinematic-v3/.runtime/application-evidence/workspace-normal-" +
      Date.now(),
  );
  const receipt = {
    contract: "aerynth.workspace-normal-evidence@1",
    source,
    syntheticOnly: true,
    passed: false,
    checks: [],
    actions: [],
    cases: [],
    shapeCases: [],
    screenshots: [],
    errors: [],
    limits: [
      "Actual Core preparation is synthetic and is not native UI creation.",
      "Note and Conversation creation plus primary controls and resizing use native input.",
      "Recorded event metadata is not model reasoning or verified task execution.",
      "GPU draws are submitted draws, not monitor presentation or frame-rate evidence.",
      "This is functional evidence; artistic acceptance and performance remain separate.",
    ],
  };
  const consoleError = consoleErrorHandler(receipt);
  win.webContents.on("console-message", consoleError);
  const recordStartupErrors = () => {
    receipt.startupErrorCount = Array.isArray(startupErrors)
      ? startupErrors.length
      : -1;
    receipt.startupErrors = Array.isArray(startupErrors)
      ? startupErrors
          .slice(0, 20)
          .map((error) => String(error?.message ?? error).slice(0, 1000))
      : ["Invalid host startup error collection"];
  };
  let limits, guard, inspectState;
  try {
    limits = exports.options(process.argv, moduleStarted);
    guard = createInlineDraftGuard(win, limits);
    guard.check();
    receipt.bounds = limits;
    recordStartupErrors();
    assert.equal(
      receipt.startupErrorCount,
      0,
      "Observed startup graphics/console error",
    );
    assert(
      /^review-workspace-native-/.test(path.basename(privateRoot)),
      "dedicated_synthetic_profile_required",
    );
    const readJson = async (name, maxBytes) => {
      const file = path.join(privateRoot, name),
        stat = await guard.around(() => fs.stat(file));
      assert(stat.size <= maxBytes, "workspace_native_state_bytes_exceeded");
      return JSON.parse(await guard.around(() => fs.readFile(file, "utf8")));
    };
    const seed = await readJson("workspace-native-seed.json", 256 * 1024);
    assert(!seed.relatedCase && !seed.structuredGridCase, 'ordinary_fixture_required_not_recovery_specialization');
    assert.equal(seed.contract, "aerynth.workspace-native@1");
    assert.equal(seed.syntheticOnly, true);
    assert.equal(seed.cases.length, 10);
    assert.equal(
      seed.shapeCases.length,
      3,
      "Explicit saved curved shapes are required",
    );
    assert.deepEqual(
      new Set(seed.shapeCases.map((entry) => entry.shape)),
      new Set(["lens", "circle", "pill"]),
    );
    assert.deepEqual(
      new Set(seed.cases.map((item) => item.kind)),
      new Set(kinds),
    );
    assert(
      Object.keys(seed.hashes).length <= 8,
      "bounded_preparation_hashes_required",
    );
    for (const [name, expected] of Object.entries(seed.hashes)) {
      assert(
        /^prototypes\/[a-zA-Z0-9_./-]+$/.test(name) && !name.includes(".."),
        "invalid_source_hash_path",
      );
      const actual = digest(
        await guard.around(() =>
          fs.readFile(path.resolve(__dirname, "../../..", name)),
        ),
      );
      assert.equal(actual, expected, "Preparation source changed: " + name);
      if (source?.hashes?.[name])
        assert.equal(
          source.hashes[name],
          expected,
          "Host source binding differs: " + name,
        );
    }
    receipt.preparationHashes = seed.hashes;
    receipt.helperSha256 = digest(
      await guard.around(() => fs.readFile(__filename)),
    );
    receipt.consoleHandlerSha256 = digest(await guard.around(() => fs.readFile(require.resolve('./native-console.cjs'))));
    const driver = await guard.around(() =>
      createDriver(win, { assertActive: guard.check }),
    );
    const js = (code) => guard.around(() => driver.js(code));
    const wait = (expression) =>
      guard.around(() =>
        driver.wait(
          expression,
          Math.min(8000, Math.max(1, limits.deadlineAt - Date.now())),
        ),
      );
    const click = async (selector) => {
      receipt.lastIntent = { action: "native click", selector };
      await guard.around(() => driver.click(selector));
      receipt.actions.push({ action: "native click", selector });
    };
    const snapshot = () => guard.around(() => driver.snapshot());
    inspectState = () =>
      js(
        `(()=>{const a=window.__aerynth.application(),s=window.__aerynth.snapshot(),selector=${q(receipt.lastIntent?.selector ?? "")},target=selector?document.querySelector(selector):null,r=target?.getBoundingClientRect(),hit=r?document.elementFromPoint(Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)):null;return {activeWorkspaceId:a.activeWorkspaceId,blocks:a.blocks.map(b=>({id:b.id,workspaceId:b.workspace_id,resourceId:b.resource_id,shape:b.shape,x:b.x,y:b.y,width:b.width,height:b.height,z:b.z})),graphics:{active:s.active,failed:s.graphicsFailed,contextLost:s.gpu?.contextLost,errorCount:s.metrics.errors.length,errors:s.metrics.errors.slice(0,20).map(e=>String(e).slice(0,1000)),draws:s.metrics.draws,frames:s.gpu?.framesRendered},intent:{selector,targetBlockId:target?.closest('[data-block]')?.dataset.block,hitBlockId:hit?.closest('[data-block]')?.dataset.block,hitClass:typeof hit?.className==='string'?hit.className:''},domCards:[...document.querySelectorAll('.folio[data-block]')].slice(0,32).map(e=>({id:e.dataset.block,kind:e.dataset.blockKind,hidden:e.hidden,expanded:e.classList.contains('expanded'),receded:e.classList.contains('receded')}))}})()`,
      );
    const execute = async (command) => {
      receipt.actions.push({ action: "canonical fixture command", command });
      return js(`window.__aerynth.execute(${q(command)})`);
    };
    const cp = (name, input) =>
      js(`window.aerynthHost.command('conversation',${q({ name, input })})`);
    const noExecution = async () =>
      assert.deepEqual(
        await js("window.aerynthHost.command('executionStatus',{})"),
        [],
        "No provider execution permitted",
      );
    const key = (keyCode, modifiers = []) => {
      guard.input({ type: "keyDown", keyCode, modifiers });
      guard.input({ type: "keyUp", keyCode, modifiers });
    };
    const type = async (selector, text) => {
      await click(selector);
      key("A", ["control"]);
      await guard.insertText(text);
      receipt.actions.push({ action: "native typing", selector, text });
    };
    const normal = async (entry) => {
      const card = `[data-block=${q(entry.blockId)}]`;
      await wait(
        `(()=>{let c=document.querySelector(${q(card)}),b=c?.querySelector('.working-content');return c&&!c.classList.contains('expanded')&&!c.classList.contains('receded')&&b&&getComputedStyle(b).display!=='none'&&b.getBoundingClientRect().height>0})()`,
      );
      assert.equal(
        await js("document.querySelectorAll('.folio.expanded').length"),
        0,
        "No expansion prerequisite",
      );
      return card;
    };
    let drawBaseline = await js("window.__aerynth.snapshot().metrics.draws");
    const shot = async (name) => {
      assert(
        receipt.screenshots.length < limits.maxScreenshots,
        "workspace_native_capture_count_exceeded",
      );
      await wait(`window.__aerynth.snapshot().metrics.draws>${drawBaseline}`);
      const graphics = await js("window.__aerynth.snapshot()");
      assert(
        graphics.active &&
          !graphics.graphicsFailed &&
          !graphics.gpu?.contextLost &&
          graphics.metrics.errors.length === 0,
        "Healthy actual GPU required",
      );
      const png = (await guard.capture()).toPNG();
      receipt.pngBytes = (receipt.pngBytes ?? 0) + png.length;
      assert(
        receipt.pngBytes <= limits.maxPngBytes,
        "workspace_native_capture_bytes_exceeded",
      );
      await guard.around(() => fs.mkdir(output, { recursive: true }));
      await guard.around(() =>
        fs.writeFile(path.join(output, name + ".png"), png, { flag: "wx" }),
      );
      receipt.screenshots.push({
        file: name + ".png",
        bytes: png.length,
        sha256: digest(png),
        priorDraws: drawBaseline,
        acknowledgedDraws: graphics.metrics.draws,
      });
    };
    const navigate = async (entry) => {
      await execute({
        type: "navigate",
        target: { kind: "workspace", workspaceId: entry.workspaceId },
      });
      await wait(
        `window.__aerynth.application().activeWorkspaceId===${q(entry.workspaceId)}`,
      );
    };
    const resize = async (entry, card, input, targetSize) => {
      await normal(entry);
      if (input) {
        await click(input);
        key("Home");
        for (let i = 0; i < 3; i++) key("Right", ["shift"]);
        await js(
          `window.__workspaceNativeRetained={node:document.querySelector(${q(input)}),text:document.querySelector(${q(input)}).value,start:document.querySelector(${q(input)}).selectionStart,end:document.querySelector(${q(input)}).selectionEnd,scroll:document.querySelector(${q(input)}).scrollTop}`,
        );
      }
      const before = await snapshot(),
        old = before.blocks.find((block) => block.id === entry.blockId);
      const zoom = before.viewport?.zoom ?? 1,
        dx = targetSize ? (targetSize.width - old.width) * zoom : 24,
        dy = targetSize ? (targetSize.height - old.height) * zoom : 20;
      const point = await js(
        `(()=>{const e=document.querySelector(${q(card + ' [data-resize-edge="se"]')}),r=e?.getBoundingClientRect();if(!r||!r.width||!r.height)return null;const x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2),h=document.elementFromPoint(x,y);return e===h||e.contains(h)?{x,y}:null})()`,
      );
      assert(point, "Actual unobstructed corner required for " + entry.kind);
      guard.input({ type: "mouseMove", ...point });
      guard.input({
        type: "mouseDown",
        ...point,
        button: "left",
        clickCount: 1,
      });
      for (let step = 1; step <= 8; step++) {
        guard.input({
          type: "mouseMove",
          x: Math.round(point.x + (dx * step) / 8),
          y: Math.round(point.y + (dy * step) / 8),
          modifiers: ["leftbuttondown"],
        });
        await guard.pause(25);
      }
      guard.input({
        type: "mouseUp",
        x: Math.round(point.x + dx),
        y: Math.round(point.y + dy),
        button: "left",
        clickCount: 1,
      });
      await wait(
        `window.__aerynth.application().layoutVersion>${before.layoutVersion}`,
      );
      const after = await snapshot(),
        updated = after.blocks.find((block) => block.id === entry.blockId);
      if (targetSize)
        assert(
          Math.abs(updated.width - targetSize.width) < 2 &&
            Math.abs(updated.height - targetSize.height) < 2,
          "Native short-card dimensions required",
        );
      else
        assert(
          updated.width > old.width && updated.height > old.height,
          "Native corner must resize " + entry.kind,
        );
      assert.deepEqual(
        after.resources.map((resource) => resource.id),
        before.resources.map((resource) => resource.id),
        "Resize preserves canonical IDs",
      );
      if (input)
        assert.equal(
          await js(
            `(()=>{const e=document.querySelector(${q(input)}),s=window.__workspaceNativeRetained;return e===s.node&&e.value===s.text&&e.selectionStart===s.start&&e.selectionEnd===s.end&&Math.abs(e.scrollTop-s.scroll)<1})()`,
          ),
          true,
          "Resize retains exact input/caret/text/scroll for " + entry.kind,
        );
      await normal(entry);
      receipt.actions.push({
        action: "native corner resize",
        kind: entry.kind,
        blockId: entry.blockId,
        targetSize,
      });
    };
    const shortChatReady = async (entry, expectedMessage) => {
      const card = await normal(entry),
        input = card + " .cp-composer textarea",
        send = card + ' .cp-composer button[type="submit"]';
      await click(input);
      if (expectedMessage !== undefined) await wait(`(()=>{const c=document.querySelector(${q(card)});return [...c.querySelectorAll('.cp-message-user .cp-message-content')].some(e=>e.textContent===${q(expectedMessage)})})()`);
      const bounds = await js(
        `(()=>{
          const card=document.querySelector(${q(card)}),body=card.querySelector('.working-content'),input=card.querySelector('.cp-composer textarea'),send=card.querySelector('.cp-composer button[type="submit"]'),b=body.getBoundingClientRect(),c=card.getBoundingClientRect();
          const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
          const inspect=e=>{const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);return {visible:r.width>0&&r.height>0&&r.top>=Math.max(b.top,c.top)-1&&r.bottom<=Math.min(b.bottom,c.bottom)+1&&r.left>=c.left-1&&r.right<=c.right+1,hit:e===h||e.contains(h),font:parseFloat(getComputedStyle(e).fontSize)}};
          const messages=card.querySelector('.cp-messages'),m=messages.getBoundingClientRect(),style=getComputedStyle(messages),clip={left:Math.max(m.left,b.left,c.left),right:Math.min(m.right,b.right,c.right),top:Math.max(m.top,b.top,c.top),bottom:Math.min(m.bottom,b.bottom,c.bottom)},expected=${q(expectedMessage ?? null)},rows=[];
          let userLineVisible=false;
          if(expected!==null){for(const content of [...messages.querySelectorAll('.cp-message-user .cp-message-content')].slice(0,4)){
            if(content.textContent!==expected)continue;
            const range=document.createRange();range.selectNodeContents(content);
            const lines=[...range.getClientRects()].slice(0,16).map(r=>({top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height,inside:r.width>0&&r.height>0&&r.top>=clip.top-.01&&r.bottom<=clip.bottom+.01&&r.right>clip.left&&r.left<clip.right}));
            const visibility=getComputedStyle(content).visibility,article=content.closest('.cp-message'),actions=article.querySelector('.cp-message-actions');
            userLineVisible ||= visibility!=='hidden'&&lines.some(r=>r.inside);
            rows.push({messageId:article.dataset.messageId,content:rect(content),visibility,lineRects:lines,articleMarginBottom:getComputedStyle(article).marginBottom,actions:actions?{...rect(actions),opacity:getComputedStyle(actions).opacity}:null});
          }}
          return {input:inspect(input),send:inspect(send),messages:{height:Math.max(0,clip.bottom-clip.top),userLineVisible,canonicalLineRequired:expected!==null,clip,rect:rect(messages),scrollTop:messages.scrollTop,scrollHeight:messages.scrollHeight,clientHeight:messages.clientHeight,paddingTop:style.paddingTop,paddingBottom:style.paddingBottom,rows}};
        })()`,
      );
      receipt.shortChat = bounds;
      if (!bounds.input.visible || !bounds.input.hit || !bounds.send.visible || !bounds.send.hit || bounds.messages.height < 39.99 || (expectedMessage !== undefined && !bounds.messages.userLineVisible)) {
        if (receipt.screenshots.length < limits.maxScreenshots) {
          try { await shot("short-chat-readability-failure"); }
          catch (error) { receipt.readabilityFailureCaptureUnavailable = String(error?.message ?? error).slice(0,1000); }
        }
      }
      assert(
        bounds.input.visible &&
          bounds.input.hit &&
          bounds.send.visible &&
          bounds.send.hit,
        "Short normal Chat must expose real composer and Send without expansion",
      );
      assert(
        bounds.input.font >= 15.95,
        "Short normal Chat retains readable 16px input",
      );
      assert(bounds.messages.height >= 39.99, "Short normal Chat retains at least 40px of visible transcript");
      if (expectedMessage !== undefined) assert(bounds.messages.userLineVisible, "Short normal Chat exposes at least one complete line of the exact canonical user message");
      return { input, send };
    };
    await noExecution();
    if (limits.restore) {
      const expected = await readJson(
        "workspace-native-expected.json",
        limits.maxCheckpointBytes,
      );
      assert.equal(expected.contract, "aerynth.workspace-native-checkpoint@1");
      assert.equal(expected.cases.length, 10);
      assert.deepEqual(
        new Set(expected.cases.map((entry) => entry.kind)),
        new Set(kinds),
      );
      assert.equal(expected.shapeCases.length, 3);
      for (const entry of [...expected.cases, ...expected.shapeCases]) {
        await navigate(entry);
        await normal(entry);
        assert.deepEqual(
          exports.workspaceState(await snapshot()),
          expected.workspaces[entry.workspaceId],
          "Fresh-process geometry for " + entry.kind,
        );
        if (entry.shape)
          assert.equal(
            (await snapshot()).blocks.find(
              (block) => block.id === entry.blockId,
            ).shape,
            entry.shape,
            "Explicit saved shape is preserved",
          );
        if (entry.kind === "conversation") await shortChatReady(entry);
      }
      const state = await snapshot();
      for (const field of [
        "resources",
        "relationships",
        "projects",
        "workspaces",
      ])
        assert.deepEqual(
          state[field],
          expected.canonical[field],
          "Fresh-process " + field,
        );
      const chat = expected.cases.find(
        (entry) => entry.kind === "conversation",
      );
      assert.equal(
        (await cp("readDraft", { resourceId: chat.resourceId })).content,
        expected.chatDraft,
      );
      const detail = await cp("detail", {
        resourceId: chat.resourceId,
        limit: 50,
      });
      assert.equal(detail.messages.total, 1);
      assert.equal(detail.messages.items[0].role, "user");
      assert.equal(detail.messages.items[0].content, expected.localMessage);
      // This is now a genuinely saved short placement in a fresh native
      // process. Submit its exact recovered draft with actual native input.
      await navigate(chat);
      const restoredControls = await shortChatReady(chat);
      await wait(
        `document.querySelector(${q(restoredControls.input)})?.value===${q(expected.chatDraft)}`,
      );
      await click(restoredControls.send);
      await wait(
        `document.querySelector(${q(restoredControls.input)})?.value===''`,
      );
      const sent = await cp("detail", {
        resourceId: chat.resourceId,
        limit: 50,
      });
      assert.equal(sent.messages.total, 2);
      assert.equal(sent.messages.items[0].content, expected.localMessage);
      assert.equal(sent.messages.items[1].role, "user");
      assert.equal(sent.messages.items[1].content, expected.chatDraft);
      assert.equal(
        (await cp("readDraft", { resourceId: chat.resourceId })).content,
        "",
      );
      await shortChatReady(chat, expected.chatDraft);
      await shot("restored-short-normal-local-send");
      await navigate(expected.cases.find((entry) => entry.kind === "note"));
      await wait(
        `document.querySelector('[data-block-kind="note"] textarea')?.value===${q(expected.noteText)}`,
      );
      await shot("fresh-process-normal-note");
      receipt.checks.push(
        "Fresh native process restores all ten normal-card placements, exact canonical IDs/content and unsent Chat draft without replay, then native Send on the saved short card records that exact draft once",
      );
    } else {
      const workspaces = {},
        cases = seed.cases.map((entry) => ({ ...entry }));
      const noteText =
          "Synthetic direct normal note.\nThis text was entered with native input.",
        chatDraft = "Synthetic unsent normal conversation draft",
        localMessage = "Synthetic local message sent from a short normal card";
      // Note first makes the representative creation path visible before Chat.
      const order = [...cases].sort((a, b) =>
        a.kind === "note" ? -1 : b.kind === "note" ? 1 : 0,
      );
      for (const entry of order) {
        receipt.currentCase = {
          phase: "default",
          kind: entry.kind,
          workspaceId: entry.workspaceId,
        };
        drawBaseline = await js("window.__aerynth.snapshot().metrics.draws");
        await navigate(entry);
        if (!entry.blockId) {
          const before = await snapshot();
          await click(".aw-workspace-add");
          await click(`.aw-library__list [data-block-kind=${q(entry.kind)}]`);
          await type(".aw-library__detail > form > label > input", entry.title);
          await click('.aw-library__detail > form > button[type="submit"]');
          await wait('!document.querySelector(".aw-library")');
          const state = await snapshot(),
            resource = state.resources.find(
              (item) => item.title === entry.title,
            );
          assert(resource);
          entry.resourceId = resource.id;
          entry.blockId = state.blocks.find(
            (block) => block.resource_id === resource.id,
          ).id;
          assert.equal(state.resources.length, before.resources.length + 1);
          assert.equal(state.blocks.length, before.blocks.length + 1);
          if (entry.kind === "conversation")
            assert.equal(resource.provider, "local");
          receipt.checks.push("Actual native Library creation: " + entry.kind);
        }
        const card = await normal(entry),
          initial = await snapshot(),
          block = initial.blocks.find((item) => item.id === entry.blockId);
        assert.deepEqual(
          { width: block.width, height: block.height },
          entry.defaultSize,
          "Distinct NEW default for " + entry.kind,
        );
        assert.equal(
          block.shape,
          entry.defaultShape,
          "New default shape for " + entry.kind,
        );
        let input;
        if (["note", "research", "reference", "task"].includes(entry.kind)) {
          if (["research", "reference"].includes(entry.kind))
            await click(
              card + ' .aw-note-tools button[aria-label="Edit document"]',
            );
          input = card + " textarea";
          await wait(`!document.querySelector(${q(input)})?.disabled`);
          await type(
            input,
            entry.kind === "note"
              ? noteText
              : "Synthetic direct edit for " + entry.kind,
          );
          if (entry.kind === "task") {
            await click(card + " .task-completed");
            await wait(
              `window.__aerynth.application().resources.find(r=>r.id===${q(entry.resourceId)})?.taskStatus==='done'`,
            );
          }
        } else if (entry.kind === "conversation") {
          input = card + " .cp-composer textarea";
          await type(input, localMessage);
        } else if (entry.kind === "task_group") {
          await wait(
            `!!document.querySelector(${q(card + ' .aw-task-group-list input[type="checkbox"]')})`,
          );
          await click(card + ' .aw-task-group-list input[type="checkbox"]');
          await wait(
            `window.__aerynth.application().resources.find(r=>r.id===${q(seed.taskId)})?.taskStatus==='open'`,
          );
          input = card + " .aw-task-group-tools input";
          await type(input, "Synthetic direct task");
        } else if (entry.kind === "stream") {
          await wait(
            `!!document.querySelector(${q(card + " [data-event-id]")})`,
          );
          const eventType = await js(
            `document.querySelector(${q(card + " [data-event-id] summary")}).textContent.split(' · ')[1]`,
          );
          assert(eventType);
          input = card + " .aw-event-tools input";
          await type(input, eventType);
          await click(card + " [data-event-id] summary");
          assert.equal(
            await js(
              `document.querySelector(${q(card + " [data-event-id] details")}).open`,
            ),
            true,
          );
        } else if (
          ["resource_browser", "collection_browser"].includes(entry.kind)
        ) {
          input = card + " .aw-subject-tools input";
          await type(
            input,
            entry.kind === "resource_browser"
              ? "Synthetic direct task"
              : "Synthetic collection member",
          );
          const resourceId =
            entry.kind === "resource_browser" ? seed.taskId : seed.memberId;
          await wait(
            `!!document.querySelector(${q(card + " [data-resource-id=" + q(resourceId) + "]")})`,
          );
          const before = await snapshot();
          await click(
            card +
              " [data-resource-id=" +
              q(resourceId) +
              "] .aw-subject-action",
          );
          await wait(
            `window.__aerynth.application().blocks.some(b=>b.resource_id===${q(resourceId)})`,
          );
          const after = await snapshot();
          assert.equal(after.resources.length, before.resources.length);
          assert.equal(after.blocks.length, before.blocks.length + 1);
        }
        await resize(entry, card, input);
        if (entry.kind === "conversation") {
          await resize(entry, card, input, { width: 408, height: 257 });
          const controls = await shortChatReady(entry);
          await click(controls.send);
          await wait(
            `document.querySelector(${q(controls.input)})?.value===''`,
          );
          const detail = await cp("detail", {
            resourceId: entry.resourceId,
            limit: 50,
          });
          assert.equal(detail.messages.total, 1);
          assert.equal(detail.messages.items[0].role, "user");
          assert.equal(detail.messages.items[0].content, localMessage);
          assert.equal(
            (await cp("readDraft", { resourceId: entry.resourceId })).content,
            "",
          );
          await type(controls.input, chatDraft);
          await shortChatReady(entry, localMessage);
          await noExecution();
          receipt.checks.push(
            "Native normal-card Send at 408×257 records one exact local user message, clears its acknowledged draft and accepts later unsent text without execution",
          );
        }
        workspaces[entry.workspaceId] = exports.workspaceState(
          await snapshot(),
        );
        const bounds = await js(
          `(()=>{let c=document.querySelector(${q(card)}),b=c.querySelector('.working-content'),r=c.getBoundingClientRect();return {expanded:c.classList.contains('expanded'),presentation:c.dataset.workspacePresentation,width:r.width,height:r.height,bodyClientWidth:b.clientWidth,bodyScrollWidth:b.scrollWidth}})()`,
        );
        assert(
          bounds.bodyScrollWidth <= bounds.bodyClientWidth + 2,
          "Horizontal content overflow: " + entry.kind,
        );
        receipt.cases.push({
          kind: entry.kind,
          blockId: entry.blockId,
          resourceId: entry.resourceId,
          defaultSize: entry.defaultSize,
          defaultShape: entry.defaultShape,
          bounds,
          method: ["note", "conversation"].includes(entry.kind)
            ? "native Library creation and native primary action"
            : "canonical preparation and native primary action",
        });
        if (entry.kind === "note" || entry.kind === "conversation")
          await shot("normal-" + entry.kind);
        if (entry.kind === "project_overview") {
          const target = await js(
            `document.querySelector(${q(card + " [data-workspace-id]")}).dataset.workspaceId`,
          );
          await click(card + " [data-workspace-id] button");
          await wait(
            `window.__aerynth.application().activeWorkspaceId===${q(target)}`,
          );
        }
      }
      assert.equal(
        new Set(
          cases.map(
            (entry) => entry.defaultSize.width + "x" + entry.defaultSize.height,
          ),
        ).size,
        10,
      );
      for (const entry of seed.shapeCases) {
        receipt.currentCase = {
          phase: "saved shape",
          kind: entry.kind,
          shape: entry.shape,
          workspaceId: entry.workspaceId,
        };
        await navigate(entry);
        const card = await normal(entry),
          before = await snapshot(),
          saved = before.blocks.find((block) => block.id === entry.blockId);
        assert.equal(saved.shape, entry.shape);
        assert.equal(saved.resource_id, entry.resourceId);
        assert.deepEqual(
          { width: saved.width, height: saved.height },
          entry.size,
        );
        if (["research", "reference"].includes(entry.kind))
          await click(
            card + ' .aw-note-tools button[aria-label="Edit document"]',
          );
        const input = card + " textarea";
        await type(
          input,
          "Synthetic direct edit in explicit saved " + entry.shape,
        );
        await resize(entry, card, input);
        const after = await snapshot();
        assert.equal(
          after.blocks.find((block) => block.id === entry.blockId).shape,
          entry.shape,
        );
        workspaces[entry.workspaceId] = exports.workspaceState(after);
        receipt.shapeCases.push({
          shape: entry.shape,
          kind: entry.kind,
          blockId: entry.blockId,
          resourceId: entry.resourceId,
          method:
            "Explicit canonical saved shape; actual native editing and corner resize",
        });
      }
      await navigate(cases.find((entry) => entry.kind === "note"));
      const canonical = await snapshot(),
        checkpoint = JSON.stringify(
          {
            contract: "aerynth.workspace-native-checkpoint@1",
            cases,
            shapeCases: seed.shapeCases,
            workspaces,
            canonical: {
              resources: canonical.resources,
              relationships: canonical.relationships,
              projects: canonical.projects,
              workspaces: canonical.workspaces,
            },
            noteText,
            chatDraft,
            localMessage,
          },
          null,
          2,
        );
      assert(
        Buffer.byteLength(checkpoint) <= limits.maxCheckpointBytes,
        "workspace_native_checkpoint_too_large",
      );
      await guard.around(() =>
        fs.writeFile(
          path.join(privateRoot, "workspace-native-expected.json"),
          checkpoint,
          { flag: "wx" },
        ),
      );
      receipt.checks.push(
        "All ten distinct defaults, normal primary controls, native resizing and stable canonical/input identity",
        "Exact bounded checkpoint retained for separate fresh-process restoration",
      );
    }
    await noExecution();
    assert.deepEqual(receipt.errors, []);
    receipt.finalState = await inspectState();
    assert.equal(
      receipt.finalState.graphics.errorCount,
      0,
      "Observed final renderer errors",
    );
    assert.equal(receipt.finalState.graphics.failed, false, "Graphics failed at final inspection");
    assert.equal(receipt.finalState.graphics.contextLost, false, "Graphics context lost at final inspection");
    recordStartupErrors();
    assert.equal(
      receipt.startupErrorCount,
      0,
      "Observed startup graphics/console error",
    );
    guard.check();
    receipt.passed = true;
  } catch (error) {
    receipt.error = String(error?.stack ?? error).slice(0, 6000);
  } finally {
    // After custody loss, only a bounded failure receipt may be written. No
    // recovery input, capture, focus acquisition or observer is left behind.
    try {
      receipt.partialCounts = {
        completedDefaults: receipt.cases.length,
        completedShapes: receipt.shapeCases.length,
      };
      if (inspectState && !receipt.finalState) {
        try {
          receipt.finalState = await inspectState();
        } catch (error) {
          receipt.finalStateUnavailable = String(error?.message ?? error).slice(
            0,
            1000,
          );
        }
      }
      recordStartupErrors();
      if (receipt.startupErrorCount !== 0) receipt.passed = false;
      win.webContents.removeListener("console-message", consoleError);
      const json = JSON.stringify(receipt, null, 2);
      assert(
        Buffer.byteLength(json) <= 512 * 1024,
        "workspace_native_receipt_too_large",
      );
      await fs.mkdir(output, { recursive: true });
      await fs.writeFile(path.join(output, "workspace-native.json"), json, {
        flag: "wx",
      });
    } catch (error) {
      receipt.passed = false;
      receipt.error = String(error?.stack ?? error).slice(0, 6000);
    } finally {
      try {
        process.stdout.write(
          JSON.stringify({
            passed: receipt.passed,
            evidence: output,
            error: receipt.error,
          }) + "\n",
        );
      } finally {
        app.exit(receipt.passed ? 0 : 1);
      }
    }
  }
  return receipt;
};
