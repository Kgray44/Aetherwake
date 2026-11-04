/* Owned Electron mission journey. Run through desktop-main.cjs with
 * --integration-vela-missions --profile=<absolute C: profile ending review-vela-missions-DIGITS>
 * 45 seconds including cleanup, up to three PNGs/24 MiB, no video. */
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { fillNative } = require("./integration-agents.cjs");
const { assertOwnedApplicationProfile } = require("./integration-checklists.cjs");
const { createSlot, sourceIdentity, targetScript, waitForCondition } = require("./integration-resource-opening.cjs");

const FLAG = "--integration-vela-missions";
const OBJECTIVE = "Investigate Aerynth backend performance";
const WORKSPACE = "Synthetic Vela mission acceptance";
const SURFACE = '#vela-assistant-surface[data-surface-id="vela"]';
const PREVIEW = SURFACE + " .vela-mission-preview";
const RECORD = SURFACE + " .vela-mission-record";
const missionControl = name => SURFACE + ' [data-mission-focus=' + JSON.stringify(name) + ']';
const LIMIT_MS = 45000;
const MiB = 1024 * 1024;
const quote = JSON.stringify;

async function bounded(promise, ms, code) {
  assert(ms > 0, code);
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(code)), ms); })]);
  } finally {
    clearTimeout(timer);
  }
}

function verifyJournal(mission, scope, shippedCoreHash) {
  assert.equal(mission.contract, "aerynth.vela-mission@1");
  assert.equal(mission.objective, OBJECTIVE);
  assert.equal(mission.outcome, "verified");
  assert.deepEqual(mission.scope, scope);
  const expected = {
    backend: ["sample.backend", "aerynth.backend.node"],
    cpu: ["sample.cpu", "node:os.cpus"],
    ram: ["sample.ram", "node:os.totalmem+freemem"],
    code: ["inspect.backend-source", "aerynth.shipped-backend-source"],
    report: ["join.samples", "aerynth.mission.journal"],
  };
  const revisions = mission.events.filter(event => event.kind === "revised");
  assert(revisions.length <= 1, "unexpected_native_mission_revision");
  if (revisions.length) expected["backend-repeat"] = expected.backend;
  assert.deepEqual(mission.tasks.map(task => task.id), Object.keys(expected));
  const attempt = new Map();
  for (const task of mission.tasks) {
    assert.equal(task.state, "verified");
    assert.equal(task.attempts.length, 1);
    const [entry] = task.attempts;
    assert.deepEqual([task.executor, entry.evidence?.source], expected[task.id]);
    assert.equal(entry.outcome, "verified");
    assert.equal(entry.verification?.passed, true);
    assert.equal(entry.verification.criterion, task.criterion);
    assert.deepEqual(entry.verification.evidenceIds, [entry.evidence?.id]);
    assert.equal(entry.evidence.attemptId, entry.id);
    assert(Number.isFinite(Date.parse(entry.evidence.observedAt)), "observed_evidence_timestamp_required");
    assert.equal(entry.telemetry?.providerCalls, 0);
    const started = mission.events.find(event => event.kind === "started" && event.taskId === task.id && event.attemptId === entry.id);
    const settled = mission.events.find(event => event.kind === "settled" && event.taskId === task.id && event.attemptId === entry.id);
    assert(started && settled && started.seq < settled.seq, "canonical_start_and_settle_required");
    assert(Date.parse(entry.admittedAt) <= Date.parse(entry.finishedAt), "ordered_attempt_timestamps_required");
    attempt.set(task.id, { ...entry, startedSequence: started.seq, settledSequence: settled.seq });
  }
  const backend = attempt.get("backend"), cpu = attempt.get("cpu"), report = attempt.get("report");
  const staticSource = attempt.get("code").evidence.value;
  assert.equal(staticSource.module, "core.mts");
  assert.match(shippedCoreHash, /^[a-f0-9]{64}$/);
  assert.equal(staticSource.sha256, shippedCoreHash);
  assert(Number.isSafeInteger(staticSource.sqlitePrepareSites) && staticSource.sqlitePrepareSites > 0);
  assert(Number.isSafeInteger(staticSource.transactionSites) && staticSource.transactionSites > 0);
  if (revisions.length) {
    const repeat = attempt.get("backend-repeat");
    assert(backend.evidence.value.timerOvershootMs >= 20 && backend.settledSequence < revisions[0].seq &&
      revisions[0].seq < repeat.startedSequence, "repeat_must_follow_measured_outlier_and_revision");
  }
  const overlapMs = Math.min(Date.parse(backend.finishedAt), Date.parse(cpu.finishedAt)) -
    Math.max(Date.parse(backend.admittedAt), Date.parse(cpu.admittedAt));
  assert(overlapMs > 0 && Math.max(backend.startedSequence, cpu.startedSequence) <
    Math.min(backend.settledSequence, cpu.settledSequence), "backend_and_cpu_attempts_did_not_overlap");
  const dependencyIds = mission.tasks.find(task => task.id === "report").dependencies;
  assert.deepEqual(new Set(dependencyIds), new Set(Object.keys(expected).filter(id => id !== "report")));
  const dependencies = dependencyIds.map(id => attempt.get(id));
  assert(dependencies.every(entry => entry.settledSequence < report.startedSequence), "join_started_before_verified_dependencies");
  assert.equal(report.evidence.source, "aerynth.mission.journal");
  assert.deepEqual(report.evidence.value, dependencies.map(entry => ({
    id: entry.evidence.id, source: entry.evidence.source, attemptId: entry.id,
  })));
  assert.equal(report.context?.dependencies.length, dependencies.length);
  return { tasks: [...attempt].map(([id, entry]) => ({ id, ...entry })), overlapMs, events: mission.events };
}

exports.verify = async function verify({ win, app, privateRoot, call, source, startupErrors = [], moduleStartedMonotonicMs }) {
  const argv = process.argv;
  const receipt = {
    contract: "aerynth.vela-missions-integration@1", objective: OBJECTIVE, passed: false,
    profileContent: "Synthetic workspace and prompt. Observed measurements from the running host and backend.",
    inputMethod: "App-window software native mouse, key and text input. Renderer inspections use userGesture=false.",
    actions: [], errors: [], captures: [],
  };
  const root = path.win32.resolve(privateRoot), out = path.join(root, "mission-evidence");
  let slot, owned = false, admitted = false, listening = false, workTimer, hardTimer, rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  aborted.catch(() => {});
  const abort = code => rejectAbort(slot?.abort(code) ?? Error(code));
  const blur = () => abort("mission_native_focus_lost");
  const escape = (_event, input) => { if (input?.type === "keyDown" && input.key === "Escape") abort("mission_native_operator_escape"); };
  const consoleError = (_event, details) => {
    if ((details?.level === "error" || details?.level === 3) && receipt.errors.length < 16)
      receipt.errors.push(String(details.message).slice(0, 600));
  };
  const run = async () => {
    assert(argv.includes(FLAG), "explicit_mission_verification_flag_required");
    assert(!argv.includes("--verify-restore"), "fresh_mission_profile_required");
    assert(path.win32.isAbsolute(privateRoot) && path.win32.parse(root).root.toLowerCase() === "c:\\" &&
      /^review-vela-missions-\d+$/.test(path.win32.basename(root)), "owned_mission_profile_required");
    assert.equal(argv.filter(value => value.startsWith("--profile=")).length, 1, "one_explicit_mission_profile_required");
    assertOwnedApplicationProfile(root, app.getPath("userData"), argv);
    assert.match(win.getTitle(), /Automated check/i, "owned_automated_window_required");
    receipt.source = sourceIdentity(source);
    owned = true;
    slot = createSlot({ win, startedAt: moduleStartedMonotonicMs, limitMs: LIMIT_MS, cleanupMs: 4000 });
    slot.check();
    hardTimer = setTimeout(() => app.exit(1), slot.remaining());
    workTimer = setTimeout(() => abort("mission_native_work_deadline"), slot.workRemaining());
    win.on("blur", blur); win.on("hide", blur); win.on("minimize", blur);
    win.webContents.on("before-input-event", escape); win.webContents.on("console-message", consoleError);
    listening = true;
    const guardFile = path.join(app.getPath("home"), "AppData", "Local", "AeroStorageWatch", "ReserveGuard.ps1");
    receipt.reserve = JSON.parse(execFileSync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-File", guardFile, "-EstimatedCBytes", String(32 * MiB), "-EstimatedDBytes", "0",
    ], { windowsHide: true, timeout: 4000, maxBuffer: 8192, encoding: "utf8" }));
    assert.equal(receipt.reserve.allowed, true, "storage_reserve_denied");
    await fs.mkdir(out);
    admitted = true;
    assert.deepEqual(startupErrors, [], "mission_native_startup_errors");

    const operation = async (run, code) => {
      slot.check();
      const value = await bounded(run(), slot.workRemaining(), code);
      slot.check();
      return value;
    };
    const js = code => operation(() => win.webContents.executeJavaScript(code, false), "mission_renderer_deadline");
    const rpc = (name, input) => operation(() => call(name, input), "mission_backend_deadline");
    const desktop = () => rpc("desktop", { type: "snapshot" });
    const list = () => rpc("missions", { name: "list", input: {} });
    const read = id => rpc("missions", { name: "read", input: { id } });
    const wait = (label, check) => {
      receipt.phase = label;
      return waitForCondition({ slot, label, check, diagnose: () => js(
        "({app:document.querySelector('#status')?.textContent?.slice(0,240),vela:document.querySelector('.vela-core-status')?.textContent?.slice(0,240),mission:document.querySelector('.vela-missions [role=alert]:not([hidden])')?.textContent?.slice(0,240)})",
      ) });
    };
    const click = async selector => {
      const scroll = `document.querySelector(${quote(selector)})?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})`;
      await js(scroll);
      let previous;
      const point = await wait("Visible stable control " + selector, async () => {
        const hit = await js(targetScript(selector, "inspect"));
        if (!hit.ready) { previous = undefined; await js(scroll); return false; }
        const current = { x: Math.round(hit.rect.x + hit.rect.width / 2), y: Math.round(hit.rect.y + hit.rect.height / 2) };
        const stable = previous?.x === current.x && previous?.y === current.y;
        previous = current;
        return stable && current;
      });
      receipt.actions.push({ method: "software-native-window-mouse", selector, point });
      for (const type of ["mouseMove", "mouseDown", "mouseUp"]) {
        slot.check();
        win.webContents.sendInputEvent({ type, ...point, button: "left", clickCount: 1 });
      }
    };
    const key = (keyCode, modifiers = []) => {
      for (const type of ["keyDown", "keyUp"]) {
        slot.check();
        win.webContents.sendInputEvent({ type, keyCode, modifiers });
      }
    };
    const fill = (selector, text) => fillNative({
      click, key, js, wait, insertText: value => operation(() => win.webContents.insertText(value), "mission_text_input_deadline"),
    }, selector, text);
    const capture = async name => {
      const image = await operation(() => win.webContents.capturePage(), "mission_capture_deadline");
      const png = image.toPNG();
      assert(png.length > 0 && png.length <= 8 * MiB, "mission_capture_budget");
      await fs.writeFile(path.join(out, name + ".png"), png, { flag: "wx" });
      receipt.captures.push({ file: name + ".png", bytes: png.length });
    };

    await wait("Hydrated application", () => js('document.body.dataset.applicationHydrated === "true"'));
    const fresh = await desktop();
    assert.equal(fresh.workspaces.length, 0, "empty_mission_profile_required");
    const providerBefore = await rpc("providerActivity", {});
    assert.equal(providerBefore.scope, "process-session-native-attempts");
    assert.equal(providerBefore.codexConnections, 0);
    assert.equal(providerBefore.providerRequests, 0);
    await js(`window.__aerynth.execute(${quote({ type: "createWorkspace", title: WORKSPACE, projectId: null })})`);
    receipt.actions.push({ method: "application-capability-fixture", type: "createWorkspace" });
    const scope = await wait("Canonical workspace is active", async () => {
      const state = await desktop(), workspace = state.workspaces.find(item => item.title === WORKSPACE);
      return workspace && state.activeWorkspaceId === workspace.id && { workspaceId: workspace.id, projectId: null };
    });
    assert.deepEqual(await list(), []);
    await click("#vela");
    const composer = SURFACE + ' textarea[aria-label="Message Vela"]';
    const unmatchedObjective = "Plan a mission to read physical memory after recording processor load";
    await fill(composer, unmatchedObjective);
    await click(SURFACE + ' button[aria-label="Send to Vela"]');
    const planningButton = PREVIEW + ' [data-mission-focus="plan-mission"]';
    await wait("Disconnected planner is shown as unavailable", () => js(`document.querySelector(${quote(planningButton)})?.disabled === true`));
    assert.deepEqual(await list(), [], "disconnected_planner_created_mission");
    assert.equal((await rpc("providerActivity", {})).providerRequests, 0, "disconnected_planner_called_provider");
    await click(PREVIEW + ' [data-mission-focus="dismiss-preview"]');
    receipt.disconnectedPlanner = { shown: true, requestAvailable: false, providerRequests: 0 };

    await rpc("agents", { name: "ensureStarters", input: {} });
    receipt.actions.push({ method: "canonical-fixture", type: "ensureStarterAgentProfiles" });
    const library = () => rpc("missions", { name: "team-library", input: {} });
    const starters = await library();
    assert.equal(starters.kind, "team-library");
    assert.deepEqual(starters.teams, []);
    assert(starters.profiles.length >= 2, "starter_team_profiles_unavailable");
    const teamName = "Synthetic evidence review team";
    const responsibilities = ["Propose reproducible comparison checks.", "Identify alternative interpretations and evidence gaps."];
    const objective = "Compare two synthetic measurement reports";
    await click(missionControl("team-library"));
    await click(missionControl("new-team"));
    await fill(missionControl("team-title"), teamName);
    for (const [index, responsibility] of responsibilities.entries()) {
      const profile = missionControl(`team-profile-${index + 1}`);
      key("Tab");
      await wait("Actual team profile focus", () => js(`document.activeElement === document.querySelector(${quote(profile)})`));
      for (let choice = 0; choice <= index; choice++) {
        key("Down");
        await wait("Canonical team profile chosen", () => js(`document.querySelector(${quote(profile)})?.value === ${quote(starters.profiles[choice].id)}`));
      }
      await fill(missionControl(`team-responsibility-${index + 1}`), responsibility);
    }
    await click(missionControl("save-team"));
    const savedTeam = await wait("Team saved without a mission", async () => (await library()).teams[0]);
    assert.equal(savedTeam.title, teamName);
    assert.equal(savedTeam.version, 1);
    assert.deepEqual(savedTeam.members, responsibilities.map((responsibility, index) => ({ profileId: starters.profiles[index].id, responsibility })));
    assert.deepEqual(await list(), [], "saving_team_created_mission");
    assert.equal(await js(`!!document.querySelector(${quote(RECORD)})`), false, "saved_team_displayed_mission_activity");
    await fill(missionControl("team-objective"), objective);
    await click(missionControl("preview-team-mission"));
    const teamPreview = await wait("Team preview shows the reviewed version and disconnected specialists", () => js(`(()=>{
      const preview = document.querySelector(${quote(PREVIEW)});
      const team = preview?.querySelector('[data-mission-team]');
      return preview?.getClientRects().length && team && {
        id: team.dataset.missionTeam, version: Number(team.dataset.teamVersion), text: preview.textContent,
        canStart: !preview.querySelector('[data-mission-focus="start-mission"]')?.disabled,
      };
    })()`));
    assert.equal(teamPreview.id, savedTeam.id);
    assert.equal(teamPreview.version, savedTeam.version);
    assert.equal(teamPreview.canStart, false);
    for (const item of [teamName, objective, ...responsibilities, ...starters.profiles.slice(0, 2).map(profile => profile.title)])
      assert(teamPreview.text.includes(item), "team_preview_missing_reviewed_detail");
    assert.deepEqual(await list(), [], "team_preview_created_mission");
    const providerAtTeamReview = await rpc("providerActivity", {});
    assert.equal(providerAtTeamReview.providerRequests, providerBefore.providerRequests, "team_preview_called_provider");
    receipt.teamPreview = { savedTeam, ...teamPreview, persistedMissions: 0, providerRequests: 0 };
    await click(PREVIEW + ' [data-mission-focus="dismiss-preview"]');
    await click(missionControl("team-library"));

    await fill(composer, OBJECTIVE);
    receipt.actions.push({ method: "software-native-window-insertText", selector: composer, characters: OBJECTIVE.length });
    await click(SURFACE + ' button[aria-label="Send to Vela"]');
    const preview = await wait("Mission review in Vela", () => js(`(()=>{const p=document.querySelector(${quote(PREVIEW)});return p?.getClientRects().length&&p.querySelector('ol li')&&{text:p.textContent,taskTitles:[...p.querySelectorAll('ol > li > strong')].map(n=>n.textContent)}})()`));
    const canonicalPreview = await rpc("missions", { name: "preview", input: { objective: OBJECTIVE } });
    assert.deepEqual(canonicalPreview.plan.scope, scope);
    assert.equal(canonicalPreview.externalReview, undefined);
    assert.deepEqual(canonicalPreview.plan.tasks.map(task => task.id), ["backend", "cpu", "ram", "code", "report"]);
    assert.deepEqual(preview.taskTitles, canonicalPreview.plan.tasks.map(task => task.objective));
    assert(preview.text.includes("Review mission") && preview.text.includes(OBJECTIVE) && preview.text.includes("Local read-only tasks"));
    assert.equal(await js(`document.querySelector(${quote(SURFACE + ' button[aria-label="Missions"]')})?.getAttribute('aria-expanded')`), "true");
    assert.deepEqual(await list(), [], "mission_started_without_review_click");
    receipt.review = { ...preview, fingerprint: canonicalPreview.fingerprint, persistedMissions: 0 };
    await capture("01-mission-review");

    await click(PREVIEW + ' [data-mission-focus="start-mission"]');
    const rendered = await wait("Verified mission and tasks in Vela", () => js(`(()=>{const p=document.querySelector(${quote(RECORD + '[data-mission-outcome="verified"]')});return p?.getClientRects().length&&{id:p.dataset.missionId,title:p.querySelector('h3').textContent,tasks:[...p.querySelectorAll('[data-mission-task][data-task-state]')].map(n=>[n.dataset.missionTask,n.dataset.taskState])}})()`));
    assert.equal(rendered.title, OBJECTIVE);
    const missions = await list();
    assert.equal(missions.length, 1);
    assert.equal(missions[0].id, rendered.id);
    const mission = await read(rendered.id);
    assert.deepEqual(rendered.tasks, mission.tasks.map(task => [task.id, task.state]));
    receipt.journal = verifyJournal(mission, scope, source.hashes["prototypes/integrated-backend/src/core.mts"]);
    const timeline = RECORD + " details[data-mission-disclosure=" + quote(rendered.id + "-timeline") + "]";
    const summary = timeline + " > summary";
    assert.equal(await js(`document.querySelector(${quote(summary)})?.textContent`), "Observed mission timeline");
    await click(summary);
    const rows = await wait("Observed mission timeline is open", () => js(`(()=>{const d=document.querySelector(${quote(timeline)});return d?.open&&[...d.querySelectorAll('ol > li')].map(n=>({label:n.querySelector('span').textContent,time:n.querySelector('time').dateTime}))})()`));
    assert.equal(rows.length, mission.events.length);
    for (const [index, event] of mission.events.entries()) {
      const label = { created: "Mission created", started: "Attempt started", settled: "Attempt settled", revised: "Plan revised" }[event.kind];
      assert(label && rows[index].label.startsWith("#" + event.seq + " " + label), "rendered_timeline_event_mismatch");
      assert.equal(rows[index].time, event.time);
    }
    receipt.rendered = { ...rendered, timeline: rows };
    await capture("02-verified-mission-timeline");
    await click(RECORD + ' [data-mission-focus="preview-workroom"]');
    await wait("Workroom preview in Vela", () => js(
      `document.querySelector(${quote(RECORD + ' [data-mission-focus="apply-workroom"]')})?.textContent === 'Create linked workroom'`,
    ));
    assert.equal((await desktop()).workspaces.length, 1, "workroom_preview_changed_canonical_state");
    await click(RECORD + ' [data-mission-focus="apply-workroom"]');
    const workroom = await wait("Canonical mission workroom is active", async () => {
      const state = await desktop(), room = state.workspaces.find(item => item.title === "Backend performance workroom");
      if (!room || state.activeWorkspaceId !== room.id) return null;
      const projection = await read(rendered.id);
      return projection.workroom?.workspaceId === room.id && {
        id: room.id, sourceMissionId: projection.id, outcome: projection.outcome,
        blocks: state.blocks.map(block => block.resource_id).filter(Boolean),
      };
    });
    assert.equal(workroom.outcome, "verified");
    assert(workroom.blocks.length >= 2, "expected_functional_workroom_blocks");
    assert.equal((await list())[0].id, rendered.id);
    receipt.workroom = workroom;
    await capture("03-linked-mission-workroom");
    const providerAfter = await rpc("providerActivity", {});
    assert.equal(providerAfter.codexConnections, providerBefore.codexConnections);
    assert.equal(providerAfter.providerRequests, providerBefore.providerRequests);
    const core = await rpc("snapshot", {});
    assert.equal(Object.keys(core.executions).length, 0, "provider_execution_detected");
    receipt.providerActivity = { before: providerBefore, after: providerAfter };
    assert.deepEqual(receipt.errors, [], "renderer_console_errors");
    slot.check();
    receipt.passed = true;
  };

  try {
    await Promise.race([run(), aborted]);
  } catch (error) {
    receipt.error = { message: String(error.message).slice(0, 1000), ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}) };
  } finally {
    clearTimeout(workTimer);
    if (listening) {
      win.removeListener("blur", blur); win.removeListener("hide", blur); win.removeListener("minimize", blur);
      win.webContents.removeListener("before-input-event", escape); win.webContents.removeListener("console-message", consoleError);
    }
    if (owned) {
      try {
        assert.equal(await bounded(call("close", {}), Math.min(1500, slot?.remaining() ?? 1500), "mission_close_deadline"), null);
        receipt.nativeCloseConfirmed = true;
      } catch (error) {
        receipt.passed = false;
        receipt.closeError = String(error.message).slice(0, 600);
      }
    }
    receipt.elapsedMs = performance.now() - moduleStartedMonotonicMs;
    receipt.slotFailure = slot?.failure() ?? null;
    receipt.startupErrors = startupErrors.slice(0, 16);
    receipt.passed = receipt.passed && !receipt.slotFailure && !receipt.startupErrors.length && !receipt.errors.length;
    if (admitted) {
      try {
        const encoded = JSON.stringify(receipt, null, 2);
        assert(Buffer.byteLength(encoded) <= MiB, "mission_receipt_capacity");
        await fs.writeFile(path.join(out, "journey.json"), encoded, { flag: "wx" });
      } catch (error) {
        receipt.passed = false;
        receipt.error = { message: String(error.message).slice(0, 1000) };
      }
    }
    clearTimeout(hardTimer);
    console.log(JSON.stringify({ passed: receipt.passed, evidence: admitted ? out : null, phase: receipt.phase, error: receipt.error?.message, elapsedMs: receipt.elapsedMs }));
    if (owned) app.exit(receipt.passed ? 0 : 1);
  }
  return receipt;
};
