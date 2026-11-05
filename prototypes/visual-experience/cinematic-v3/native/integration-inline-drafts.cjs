const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createDriver } = require("./desktop-verify.cjs");
const {
  verificationOptions,
  createInlineDraftGuard,
} = require("./inline-draft-guard.cjs");

/** Parent-owned native slot only. No provider is connected or executed. */
exports.verify = async ({ win, app, privateRoot, source, moduleStarted }) => {
  const output = path.resolve(
    __dirname,
    "../.runtime/application-evidence",
    "inline-draft-" + Date.now(),
  );
  await fs.mkdir(output, { recursive: true });
  const receipt = {
    source,
    syntheticData: true,
    passed: false,
    checks: [],
    actions: [],
    screenshots: [],
    errors: [],
    limits: [
      "Fixture workspaces and the explicitly competing composer use admitted canonical commands.",
      "Creation, typing, conflict decisions and local Send use native input.",
      "GPU draw counters prove submitted draws, not monitor presentation or frame rate.",
      "No real provider, inference, private reasoning or task completion is exercised.",
    ],
  };
  win.webContents.on("console-message", (_event, details) => {
    if (details.level === "error" && receipt.errors.length < 20)
      receipt.errors.push(String(details.message).slice(0, 1000));
  });
  try {
    const limits = verificationOptions(process.argv, moduleStarted),
      guard = createInlineDraftGuard(win, limits),
      pause = guard.pause;
    receipt.bounds = limits;
    guard.check();
    const { js, wait, click, snapshot } = await guard.around(() =>
        createDriver(win, { assertActive: guard.check }),
      ),
      cp = (name, input) =>
        js(
          `window.aerynthHost.command('conversation',${JSON.stringify({ name, input })})`,
        ),
      execute = (command) =>
        js(`window.__aerynth.execute(${JSON.stringify(command)})`);
    const type = async (selector, text) => {
      await click(selector);
      guard.input({
        type: "keyDown",
        keyCode: "A",
        modifiers: ["control"],
      });
      guard.input({
        type: "keyUp",
        keyCode: "A",
        modifiers: ["control"],
      });
      await guard.insertText(text);
      await pause(30);
      receipt.actions.push({
        action: "type",
        selector,
        syntheticText: text,
        method: "native editor input",
      });
    };
    const shot = async (name) => {
      guard.check();
      assert(
        receipt.screenshots.length < limits.maxScreenshots,
        "inline_draft_capture_count_exceeded",
      );
      const before = await js("window.__aerynth.snapshot().metrics.draws");
      await js('window.dispatchEvent(new Event("resize"))');
      await wait(`window.__aerynth.snapshot().metrics.draws>${before}`, 8000);
      const png = (await guard.capture()).toPNG();
      receipt.pngBytes = (receipt.pngBytes ?? 0) + png.length;
      assert(
        receipt.pngBytes <= limits.maxPngBytes,
        "inline_draft_capture_bytes_exceeded",
      );
      await guard.around(() =>
        fs.writeFile(path.join(output, name + ".png"), png, { flag: "wx" }),
      );
      receipt.screenshots.push(name + ".png");
    };
    let state, resourceId, blockId, expected;
    if (process.argv.includes("--verify-restore")) {
      const checkpointPath = path.join(
        privateRoot,
        "inline-draft-expected.json",
      );
      const checkpoint = await guard.around(() => fs.stat(checkpointPath));
      assert(
        checkpoint.size <= limits.maxCheckpointBytes,
        "inline_draft_checkpoint_too_large",
      );
      expected = JSON.parse(
        await guard.around(() => fs.readFile(checkpointPath, "utf8")),
      );
      state = await snapshot();
      resourceId = expected.resourceId;
      blockId = expected.blockId;
      assert.equal(state.activeWorkspaceId, expected.workspaceId);
      assert.deepEqual(state.blocks, expected.blocks);
      await click(`[data-block="${blockId}"] .unfold`);
    } else {
      await execute({
        type: "createWorkspace",
        title: "Synthetic inline draft review",
        projectId: null,
      });
      await click(".aw-workspace-add");
      await wait(
        'document.querySelector(".aw-library__list [data-block-kind=conversation]")',
      );
      await click('.aw-library__list [data-block-kind="conversation"]');
      await type(
        ".aw-library__detail > form > label > input",
        "Synthetic durable inline conversation",
      );
      await click('.aw-library__detail > form > button[type="submit"]');
      await wait('!document.querySelector(".aw-library")');
      state = await snapshot();
      const resource = state.resources.find(
        (resource) =>
          resource.title === "Synthetic durable inline conversation",
      );
      assert.ok(resource);
      assert.equal(resource.provider, "local");
      resourceId = resource.id;
      blockId = state.blocks.find(
        (block) => block.resource_id === resourceId,
      ).id;
      receipt.checks.push(
        "actual Library Add creates one canonical local conversation placement",
      );
    }
    const card = `[data-block="${blockId}"]`,
      input = card + " .cp-composer textarea",
      surface = card + " .cp-draft-status";
    await wait(
      `document.querySelector(${JSON.stringify(input)})&&!document.querySelector(${JSON.stringify(input)}).disabled`,
    );
    await js(
      `window.__inlineEditor=document.querySelector(${JSON.stringify(input)})`,
    );
    if (process.argv.includes("--verify-restore")) {
      await wait(
        `document.querySelector(${JSON.stringify(input)}).value===${JSON.stringify(expected.content)}`,
      );
      const stored = await cp("readDraft", { resourceId });
      assert.equal(stored.content, expected.content);
      assert.equal(stored.version, expected.version);
      const detail = await cp("detail", { resourceId, limit: 50 });
      assert.equal(detail.messages.total, 0);
      receipt.checks.push(
        "fresh native process restores exact draft and version without inserting or sending a message",
      );
      await shot("restored-unsent-draft");
      await click(card + ' .cp-composer button[type="submit"]');
      await wait(`document.querySelector(${JSON.stringify(input)}).value===''`);
      const after = await cp("detail", { resourceId, limit: 50 }),
        cleared = await cp("readDraft", { resourceId });
      assert.equal(after.messages.total, 1);
      assert.equal(after.messages.items[0].role, "user");
      assert.equal(after.messages.items[0].content, expected.content);
      assert.equal(cleared.content, "");
      assert.ok(cleared.version > expected.version);
      assert.equal(
        await js(
          `document.querySelector(${JSON.stringify(input)})===window.__inlineEditor`,
        ),
        true,
      );
      receipt.checks.push(
        "native local Send records the exact user message once then clears only its acknowledged recovery revision",
      );
      await shot("accepted-local-message");
    } else {
      const original =
        "Synthetic local draft preserved through an interrupted save.";
      await type(input, original);
      await wait(
        `document.querySelector(${JSON.stringify(surface)}).dataset.draftState==='clean'`,
      );
      const first = await cp("readDraft", { resourceId });
      assert.equal(first.content, original);
      assert.ok(first.version > 0);
      await cp("saveDraft", {
        resourceId,
        expectedVersion: first.version,
        content: "Synthetic competing composer text",
      });
      const local = original + " New local text kept during conflict.";
      await type(input, local);
      await wait(
        `document.querySelector(${JSON.stringify(surface)}).dataset.draftState==='conflict'`,
      );
      assert.equal(
        (await cp("readDraft", { resourceId })).content,
        "Synthetic competing composer text",
      );
      assert.equal(
        await js(`document.querySelector(${JSON.stringify(input)}).value`),
        local,
      );
      await click(card + " .cp-draft-conflict button:first-of-type");
      await wait(
        `document.querySelector(${JSON.stringify(surface)}).dataset.draftState==='clean'`,
      );
      assert.equal((await cp("readDraft", { resourceId })).content, local);
      receipt.checks.push(
        "competing canonical writer preserves both drafts until native Keep my text resolution",
      );
      await execute({
        type: "createWorkspace",
        title: "Synthetic alternate inline workspace",
        projectId: null,
      });
      assert.notEqual(
        (await snapshot()).activeWorkspaceId,
        state.activeWorkspaceId,
      );
      await execute({
        type: "navigate",
        target: { kind: "workspace", workspaceId: state.activeWorkspaceId },
      });
      await click(card + " .unfold");
      await wait(
        `document.querySelector(${JSON.stringify(input)}).value===${JSON.stringify(local)}`,
      );
      receipt.checks.push(
        "workspace transitions await draft persistence and restore the same canonical composer text",
      );
      await js(
        `window.__inlineEditor=document.querySelector(${JSON.stringify(input)});window.__inlineEditor.setSelectionRange(3,12)`,
      );
      await js("window.__aerynth.simulateContextLoss()");
      await wait('document.body.classList.contains("graphics-fallback")');
      assert.equal(
        await js(
          `document.querySelector(${JSON.stringify(input)})===window.__inlineEditor&&window.__inlineEditor.value===${JSON.stringify(local)}`,
        ),
        true,
      );
      await js("window.__aerynth.restoreContext()");
      await wait('!document.body.classList.contains("graphics-fallback")');
      assert.equal(
        await js(
          `document.querySelector(${JSON.stringify(input)})===window.__inlineEditor&&window.__inlineEditor.selectionStart===3&&window.__inlineEditor.selectionEnd===12`,
        ),
        true,
      );
      receipt.checks.push(
        "graphics loss/restoration preserves the composer node, text and selection",
      );
      await click(card + " .unfold");
      await pause(350);
      const before = await snapshot(),
        edge = await js(
          `(()=>{const r=document.querySelector(${JSON.stringify(card + " .aw-card-edge--se")}).getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,
        );
      for (const event of [
        { type: "mouseMove", ...edge },
        { type: "mouseDown", ...edge, button: "left", clickCount: 1 },
      ])
        guard.input(event);
      for (let i = 1; i <= 10; i++) {
        guard.input({
          type: "mouseMove",
          x: edge.x + i * 2,
          y: edge.y + i * 2,
          modifiers: ["leftbuttondown"],
        });
        await pause(14);
      }
      guard.input({
        type: "mouseUp",
        x: edge.x + 20,
        y: edge.y + 20,
        button: "left",
        clickCount: 1,
      });
      await wait(
        `window.__aerynth.application().layoutVersion>${before.layoutVersion}`,
      );
      assert.equal(
        await js(
          `document.querySelector(${JSON.stringify(input)})===window.__inlineEditor&&window.__inlineEditor.value===${JSON.stringify(local)}&&window.__inlineEditor.selectionStart===3&&window.__inlineEditor.selectionEnd===12`,
        ),
        true,
      );
      receipt.checks.push(
        "native corner resize retains the exact composer node, text and selection",
      );
      await click(card + " .unfold");
      const final = await snapshot(),
        draft = await cp("readDraft", { resourceId }),
        detail = await cp("detail", { resourceId, limit: 50 });
      assert.equal(detail.messages.total, 0);
      assert.equal(draft.content, local);
      const expectedCheckpoint = JSON.stringify(
        {
          resourceId,
          blockId,
          workspaceId: state.activeWorkspaceId,
          content: draft.content,
          version: draft.version,
          blocks: final.blocks,
        },
        null,
        2,
      );
      assert(
        Buffer.byteLength(expectedCheckpoint) <= limits.maxCheckpointBytes,
        "inline_draft_checkpoint_too_large",
      );
      await guard.around(() =>
        fs.writeFile(
          path.join(privateRoot, "inline-draft-expected.json"),
          expectedCheckpoint,
          { flag: "wx" },
        ),
      );
      await shot("retained-draft-before-process-exit");
      receipt.checks.push(
        "durable unsent draft checkpoint retained for a separate fresh-process restoration run",
      );
    }
    assert.deepEqual(receipt.errors, []);
    guard.check();
    receipt.passed = true;
  } catch (error) {
    receipt.error = String(error.stack ?? error).slice(0, 4000);
  }
  // Failure receipts may be saved after ownership is lost; no input or capture
  // is attempted on this path. The host's mandatory deadline closes its process.
  const receiptJson = JSON.stringify(receipt, null, 2);
  assert(
    Buffer.byteLength(receiptJson) <= 512 * 1024,
    "inline_draft_receipt_too_large",
  );
  await fs.writeFile(path.join(output, "inline-draft.json"), receiptJson);
  process.stdout.write(
    JSON.stringify({
      passed: receipt.passed,
      checks: receipt.checks,
      error: receipt.error,
      evidence: output,
    }) + "\n",
  );
  app.exit(receipt.passed ? 0 : 1);
};
