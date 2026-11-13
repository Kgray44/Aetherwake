/* Owned Electron mission journey. Run through desktop-main.cjs with
 * --integration-vela-missions --profile=<absolute C: profile ending review-vela-missions-DIGITS>
 * 45 seconds including cleanup, bounded PNG evidence, no video. */
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { startWindowRecording } = require("./application-recording.cjs");
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
const FRAME_WINDOW_MS = 2500;
const FRAME_SAMPLE_LIMIT = 720;
const quote = JSON.stringify;

function summarizeFrames({ intervals, windowMs, hidden, discarded }) {
  assert.equal(hidden, false, "mission_profiler_renderer_was_hidden");
  assert.equal(discarded, 0, "mission_profiler_frame_sample_limit");
  assert.ok(windowMs >= FRAME_WINDOW_MS && intervals.length > 1 &&
    intervals.every(interval => Number.isFinite(interval) && interval > 0), "mission_profiler_incomplete_frame_window");
  const sorted = intervals.toSorted((a, b) => a - b);
  return { windowMs, samples: intervals.length, discarded, p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1], maxMs: sorted.at(-1) };
}

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
    assert(Number.isInteger(entry.admission?.workerLimit) && entry.admission.workerLimit >= 1 && entry.admission.workerLimit <= 3);
    const availableMemory = entry.admission.readings.availableMemoryBytes;
    assert(availableMemory?.value >= 512 * 1024 * 1024 && Number.isFinite(Date.parse(availableMemory.observedAt)), "observed_memory_admission_required");
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

exports.verify = async function verify({ win, app, privateRoot, call, source, startupErrors = [], moduleStartedMonotonicMs, systemFactsAudit, benchmarkMode }) {
  const argv = process.argv;
  const receipt = {
    contract: "aerynth.vela-missions-integration@1", objective: OBJECTIVE, passed: false,
    profileContent: "Synthetic workspace and prompt. Observed measurements from the running host and backend.",
    inputMethod: "App-window software native mouse, key and text input. Renderer inspections use userGesture=false.",
    actions: [], errors: [], captures: [],
  };
  const root = path.win32.resolve(privateRoot), out = path.join(root, argv.includes('--missions-persistence-reopen-only')?'mission-reopen-evidence':'mission-evidence');
  let slot, owned = false, admitted = false, listening = false, workTimer, hardTimer, rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  aborted.catch(() => {});
  const abort = code => rejectAbort(slot?.abort(code) ?? Error(code));
  let expectedWeatherModal=null,expectedSourceModal=null;
  const blur = () => {
    if(expectedWeatherModal&&performance.now()<expectedWeatherModal.until){expectedWeatherModal.blurred=true;return;}
    if(expectedSourceModal&&performance.now()<expectedSourceModal.until){expectedSourceModal.blurred=true;return;}
    receipt.focusLoss = require('electron').BrowserWindow.getAllWindows().map(window => ({ id: window.id,
      title: window.getTitle(), visible: window.isVisible(), focused: window.isFocused(), parentId: window.getParentWindow()?.id ?? null }));
    abort("mission_native_focus_lost");
  };
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
    slot = createSlot({ win, startedAt: moduleStartedMonotonicMs, limitMs: argv.includes('--missions-voice-live-only')?30000:LIMIT_MS, cleanupMs: 4000 });
    slot.check();
    hardTimer = setTimeout(() => app.exit(1), slot.remaining());
    workTimer = setTimeout(() => abort("mission_native_work_deadline"), slot.workRemaining());
    win.on("blur", blur); win.on("hide", blur); win.on("minimize", blur);
    win.webContents.on("before-input-event", escape); win.webContents.on("console-message", consoleError);
    listening = true;
    const recordAiw = argv.includes("--missions-aiw-inspection") && argv.includes("--missions-aep-presentation-only");
    const guardFile = path.join(app.getPath("home"), "AppData", "Local", "AeroStorageWatch", "ReserveGuard.ps1");
    receipt.reserve = JSON.parse(execFileSync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-File", guardFile, "-EstimatedCBytes", String((recordAiw ? 128 : argv.includes('--missions-folders-only') ? 64 : 32) * MiB), "-EstimatedDBytes", "0",
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
        "({viewport:[innerWidth,innerHeight],app:document.querySelector('#status')?.textContent?.slice(0,240),vela:document.querySelector('.vela-core-status')?.textContent?.slice(0,240),mission:document.querySelector('.vela-missions [role=alert]:not([hidden])')?.textContent?.slice(0,240),architect:document.querySelector('[data-surface-id=workspace-templates]')?.textContent?.slice(-600),stream:document.querySelector('[data-surface-id=intelligence-stream]')?.textContent?.slice(0,360),navigator:document.querySelector('.en-navigator')?.textContent?.slice(-700),active:document.activeElement?.outerHTML?.slice(0,500),dialog:document.querySelector('dialog[open]')?.textContent?.slice(0,360)})",
      ) });
    };
    const click = async (selector, revealByHover = false) => {
      const scroll = `document.querySelector(${quote(selector)})?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})`;
      await js(scroll);
      let previous;
      const point = await wait("Visible stable control " + selector, async () => {
        if (revealByHover) {
          const hover = await js(`(() => {const node=document.querySelector(${quote(selector)}),r=node?.getBoundingClientRect();
            return r?.width>0&&r.height>0&&{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
          if (hover) win.webContents.sendInputEvent({type:"mouseMove",...hover});
        }
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
    if(argv.includes('--missions-folders-only')){
      const nativeHandle=win.getNativeWindowHandle(),ownerHwnd=(nativeHandle.length===8?nativeHandle.readBigUInt64LE():BigInt(nativeHandle.readUInt32LE())).toString();
      const withNativeSourceDialog=async action=>{assert(!expectedSourceModal,'one_exact_owned_source_dialog');expectedSourceModal={until:performance.now()+5500,blurred:false};try{const result=await bounded(action(),5000,'exact_owned_source_dialog_deadline');for(let frame=0;!win.isFocused()&&frame<6&&performance.now()<expectedSourceModal.until;frame++)await new Promise(resolve=>setTimeout(resolve,16));assert(win.isFocused(),'owned_source_dialog_focus_not_restored');slot.check();return result;}finally{expectedSourceModal=null;}};
      await require('./mission-folders.cjs').run({argv,profile:root,documents:app.getPath('documents'),receipt,rpc,js,click,fill,wait,capture,withNativeSourceDialog,ownerHwnd});
      receipt.passed=true;return;
    }
    if(argv.includes('--missions-weather-product-only')){
      const nativeHandle=win.getNativeWindowHandle(),ownerHwnd=(nativeHandle.length===8?nativeHandle.readBigUInt64LE():BigInt(nativeHandle.readUInt32LE())).toString();
      const withNativeWeatherModal=async action=>{assert(!expectedWeatherModal,'one_owned_weather_modal');expectedWeatherModal={until:performance.now()+5000,blurred:false};let failure=false;try{const result=await bounded(action(),5000,'weather_exact_owned_modal_deadline');for(let frame=0;!win.isFocused()&&frame<6&&performance.now()<expectedWeatherModal.until;frame++)await new Promise(resolve=>setTimeout(resolve,16));assert(win.isFocused(),'weather_owned_owner_focus_not_restored');slot.check();return result;}catch(error){failure=true;receipt.nativeModalFailure={code:typeof error?.code==='string'?error.code:'weather_owned_dialog_proof_failed',stderr:typeof error?.stderr==='string'?error.stderr.slice(0,1600):'',message:typeof error?.stderr==='string'?'native_modal_proof_process_failed':String(error?.message??'').slice(0,300)};throw Error('weather_owned_dialog_proof_failed');}finally{expectedWeatherModal=null;if(!failure&&!win.isFocused())abort('mission_native_focus_lost');}};
      await require('./mission-weather.cjs').run({argv,profile:root,receipt,rpc,js,click,fill,wait,capture,operation,slot,systemFactsAudit,withNativeWeatherModal,ownerHwnd});
      receipt.passed=true;return;
    }
    if(argv.includes('--missions-persistence-live-only')){
      await require('./mission-persistence.cjs').run({argv,root,source,receipt,rpc,js,click,fill,wait,capture,operation,slot});
      receipt.passed=true;return;
    }
    if(argv.includes('--missions-semantic-live-only')){
      assert(argv.includes('--bootstrap-vela-api'),'explicit_protected_semantic_api_required');
      assert(!['--missions-voice-live-only','--missions-api-live-only','--missions-product-only'].some(flag=>argv.includes(flag)),'one_bounded_semantic_journey_required');
      receipt.profileContent='Fresh synthetic vintage telescope project, optics note and a single real dedicated Vela API semantic workspace proposal. No personal project or note content.';
      const appCommand=input=>js(`window.__aerynth.execute(${quote(input)})`),vela=()=>rpc('vela',{name:'state',input:{}}),
        projectTitle='Vintage telescope restoration',noteTitle='Vintage telescope optics observations',
        noteContent='Synthetic fixture: 1960s refractor. Record lens alignment observations and calibration measurements here.',
        seedTitle='Synthetic telescope source workspace',composer=SURFACE+' textarea[aria-label="Message Vela"]';
      const usageBefore=await rpc('velaApiUsageStatus',{});assert.equal(usageBefore.enabled,true);assert.equal(usageBefore.usedToday,0);
      await appCommand({type:'createProject',title:projectTitle});
      const project=(await desktop()).projects.find(item=>item.title===projectTitle);assert(project,'synthetic_project_fixture_missing');
      await appCommand({type:'createWorkspace',title:seedTitle,projectId:project.id});
      const seed=(await desktop()).workspaces.find(item=>item.title===seedTitle);assert(seed,'synthetic_source_workspace_missing');
      await appCommand({type:'createResource',kind:'note',title:noteTitle,workspaceId:seed.id});
      const note=(await desktop()).resources.find(item=>item.title===noteTitle&&item.kind==='note');assert(note?.project_id===project.id,'synthetic_optics_note_scope_mismatch');
      await appCommand({type:'content',resourceId:note.id,expectedVersion:note.version,content:noteContent});
      const before=await desktop(),sourceNote=before.resources.find(item=>item.id===note.id);assert.equal(sourceNote.content,noteContent);
      assert.equal((await rpc('providerActivity',{})).providerRequests,0,'synthetic_fixtures_started_inference');
      receipt.actions.push({method:'application-capability-fixture',type:'semantic-project-and-existing-note',projectId:project.id,workspaceId:seed.id,resourceId:note.id});
      const intent='Create a workspace for Vintage telescope restoration for calibrating a 1960s refractor: calibration checklist, optics notes reusing "Vintage telescope optics observations", and a local project conversation.';
      const priorRequests=new Set((await vela()).requests.map(request=>request.id));
      if(!await js(`document.querySelector(${quote(composer)})?.getClientRects().length>0`))await click('#vela');
      await fill(composer,intent);await capture('00-semantic-purpose-ready');await click(SURFACE+' button[aria-label="Send to Vela"]');
      receipt.phase='Single real semantic proposal completes populated native construction';
      const settled=await operation(async()=>{
        const until=performance.now()+Math.min(28000,slot.workRemaining());
        while(performance.now()<until){slot.check();const state=await vela(),request=state.requests.find(item=>!priorRequests.has(item.id)&&item.intent===intent);
          if(request&&['completed','responded','failed','unknown','invalid-plan','provider-unavailable'].includes(request.state))return {state,request};
          await new Promise(resolve=>setTimeout(resolve,35));}
        throw Error('semantic_proposal_deadline');
      },'semantic_proposal_deadline');
      assert.equal(settled.request.state,'completed',settled.request.errorCode??settled.request.state);
      const plan=settled.state.plans.find(item=>item.id===settled.request.planId),
        construction=settled.state.receipts.find(item=>item.requestId===settled.request.id&&item.workspaceConstruction),proof=construction?.workspaceConstruction;
      assert(plan?.state==='applied'&&plan.steps.length===1&&plan.steps[0].action.type==='constructWorkspace','native_semantic_construction_plan_required');
      assert(proof?.resources.length>=3&&proof.placements.length===proof.resources.length,'semantic_workspace_not_populated');
      assert.deepEqual(proof.verification,{workspaceExists:true,projectMatches:true,bindingsMatch:true,geometryValid:true});
      assert.equal(proof.projectId,project.id);assert.equal(proof.resources.find(item=>item.resourceId===note.id)?.reused,true,'semantic_architect_did_not_reuse_exact_existing_note');
      const template=(await rpc('library',{name:'getTemplate',input:proof.templateId})).result,
        actual=(await rpc('library',{name:'inspectWorkspace',input:{workspaceId:proof.workspaceId}})).result,after=await desktop();
      assert.equal(template.provenance?.providerId,'openai-api-vela','real_semantic_template_provenance_required');
      assert(template.tags.includes('semantic'));assert.equal(template.version,proof.templateVersion);
      assert.equal(actual.projectId,project.id);assert.equal(after.activeWorkspaceId,proof.workspaceId);assert.equal(after.workspaces.length,before.workspaces.length+1);assert.equal(after.projects.length,before.projects.length);
      assert.equal(after.resources.find(item=>item.id===note.id)?.content,noteContent,'semantic_reference_changed_source_content');
      assert.equal(after.resources.filter(item=>item.title===noteTitle).length,1,'semantic_reference_duplicated_source_note');
      const bound=proof.resources.map(ref=>after.resources.find(item=>item.id===ref.resourceId));assert(bound.every(item=>item?.project_id===project.id&&item.state!=='archived'));
      assert(bound.some(item=>item.kind==='checklist'),'semantic_calibration_checklist_missing');assert(bound.some(item=>item.kind==='conversation'&&item.providerId==='local'),'semantic_local_conversation_missing');
      assert.equal(actual.blocks.length,proof.placements.length);
      for(const binding of proof.placements){
        const block=actual.blocks.find(item=>item.blockId===binding.blockId),role=template.body.placements.find(item=>item.key===binding.role);
        assert(block?.resourceId===binding.resourceId&&block.resourceState==='active'&&role,'semantic_canonical_role_binding_mismatch');
        for(const field of ['x','y','width','height'])assert(Number.isFinite(block[field])&&block[field]===role.presentation[field],'semantic_canonical_geometry_mismatch');
        assert(block.width>0&&block.height>0,'semantic_zero_sized_block');
      }
      for(let i=0;i<actual.blocks.length;i++)for(let j=i+1;j<actual.blocks.length;j++){
        const a=actual.blocks[i],b=actual.blocks[j];assert(!(Math.min(a.x+a.width,b.x+b.width)>Math.max(a.x,b.x)&&Math.min(a.y+a.height,b.y+b.height)>Math.max(a.y,b.y)),'semantic_workspace_blocks_overlap');
      }
      const providerAfter=await rpc('providerActivity',{}),usageAfter=await rpc('velaApiUsageStatus',{}),snapshot=await rpc('snapshot',{}),
        executions=Object.values(snapshot.executions).filter(item=>item.providerId==='openai-api-vela'&&item.commandId==='vela-api-scoped:'+template.provenance.requestId);
      assert.equal(providerAfter.codexConnections,0);assert.equal(providerAfter.providerRequests-providerBefore.providerRequests,1,'one_bounded_semantic_provider_request_required');
      assert.equal(usageAfter.configurationVersion,usageBefore.configurationVersion);assert.equal(usageAfter.usedToday-usageBefore.usedToday,1,'semantic_scoped_usage_not_recorded');
      assert.equal(executions.length,1,'semantic_execution_provenance_missing');const execution=executions[0];assert.equal(execution.state,'provider_completed');assert.equal(execution.responseOutcome,'completed');
      if(execution.usage)assert.equal(execution.usage.source,'provider-reported');
      receipt.semantic={requestId:settled.request.id,planId:plan.id,workspaceId:proof.workspaceId,projectId:project.id,reusedResourceId:note.id,
        canonicalBindings:proof.resources,canonicalPlacements:proof.placements,templateProvenance:template.provenance,
        geometry:actual.blocks.map(({blockId,resourceId,x,y,width,height})=>({blockId,resourceId,x,y,width,height})),
        execution:{id:execution.id,state:execution.state,responseOutcome:execution.responseOutcome,usage:execution.usage??null,usageSource:execution.usage?'provider-reported':'unavailable'},
        usage:{before:usageBefore,after:usageAfter},nativeConstructionVerified:true,conciseRequestBoundReply:false,completedPlanIcon:false};
      receipt.providerActivity={before:providerBefore,after:providerAfter};
      await wait('Semantic construction has a concise request-bound primary reply and plan control',()=>js(`(()=>{
        const response=document.querySelector(${quote(SURFACE+' .vela-manifestation')}),body=response?.querySelector('.vela-manifestation-content'),
          plan=response?.querySelector('button[aria-label="Open completed plan"]');
        return response?.dataset.requestId===${quote(settled.request.id)}&&body&&!body.hidden&&body.getClientRects().length&&
          body.textContent.length<500&&body.querySelector('.vela-mission-jobs-done')?.textContent==='1 job done'&&
          plan?.dataset.completedPlanId===${quote(plan.id)}&&plan.getClientRects().length&&response.querySelector('.vela-manifestation-kicker')?.hidden&&
          !response.querySelector('.vela-core-plans')?.children.length&&document.querySelector(${quote(SURFACE+' .vela-core-compose')})?.getAttribute('aria-busy')!=='true';
      })()`));
      receipt.semantic.conciseRequestBoundReply=true;
      await capture('01-semantic-workspace-created');
      assert.equal(require('electron').BrowserWindow.getAllWindows().length,1,'semantic_workspace_opened_redundant_review_window');
      const openDialogs=await js(`[...document.querySelectorAll('dialog[open]')].map(node=>({id:node.id,surfaceId:node.dataset.surfaceId??null}))`);
      receipt.semantic.openDialogs=openDialogs;
      assert(openDialogs.every(dialog=>dialog.id==='vela-assistant-surface'&&dialog.surfaceId==='vela'),'semantic_workspace_left_redundant_dialog');
      await click(SURFACE+' button[aria-label="Open completed plan"]');
      await wait('Semantic completed plan opens behind its concise response icon',()=>js(`(()=>{const panel=document.querySelector(${quote(SURFACE+' .vela-core-result-panel')});return panel&&!panel.hidden&&panel.open&&panel.querySelector('[data-plan-id="'+${quote(plan.id)}+'"]');})()`));
      await capture('02-semantic-completed-plan');
      receipt.semantic={requestId:settled.request.id,planId:plan.id,workspaceId:proof.workspaceId,projectId:project.id,
        reusedResourceId:note.id,canonicalBindings:proof.resources,canonicalPlacements:proof.placements,templateProvenance:template.provenance,
        geometry:actual.blocks.map(({blockId,resourceId,x,y,width,height})=>({blockId,resourceId,x,y,width,height})),
        execution:{id:execution.id,state:execution.state,responseOutcome:execution.responseOutcome,usage:execution.usage??null,usageSource:execution.usage?'provider-reported':'unavailable'},
        usage:{before:usageBefore,after:usageAfter},openDialogs,noRedundantApproval:true,conciseRequestBoundReply:true,completedPlanIcon:true,
        verificationBoundary:'Actual owned Electron composer and canonical native construction; one real dedicated Vela API semantic proposal using synthetic project metadata. No personal note content or human acceptance claim.'};
      receipt.providerActivity={before:providerBefore,after:providerAfter};assert.deepEqual(receipt.errors,[],'semantic_renderer_console_errors');receipt.passed=true;return;
    }
    if(argv.includes('--missions-voice-live-only')){
      assert(argv.includes('--bootstrap-vela-api')&&argv.includes('--voice-synthetic-input'),'explicit_protected_voice_and_synthetic_input_required');
      assert(!argv.includes('--missions-api-live-only')&&!argv.includes('--missions-product-only'),'one_bounded_native_voice_journey_required');
      receipt.profileContent='Fresh synthetic native voice profile, zero-source microphone stream and muted playback. Dedicated Vela API may incur the explicitly bounded voice session charge.';
      receipt.voice={syntheticInput:true,ambientMicrophoneCapture:false,outputMuted:true,humanAudibility:'unverified',nativeAuthorizedMaximumSeconds:30,
        verificationBoundary:'Actual owned Electron UI, private sandboxed WebRTC media and real provider lifecycle. Synthetic input is silence; no claim that a human heard or spoke audio.'};
      const voice=()=>rpc('velaVoice',{name:'state',input:{}}),voiceSurface=SURFACE+' .vela-voice',
        start=voiceSurface+' .vela-voice-actions button:first-child',end=voiceSurface+' .vela-voice-actions button:nth-child(2)';
      const waitVoice=async(label,check,milliseconds)=>{
        receipt.phase=label;const until=performance.now()+Math.min(milliseconds,slot.workRemaining());
        while(performance.now()<until){slot.check();const value=await check();slot.check();if(value)return value;await new Promise(resolve=>setTimeout(resolve,35));}
        throw Error('voice_lifecycle_deadline');
      };
      await click('#vela');await click(SURFACE+' button[aria-label="Voice"]');
      const ready=await wait('Real Voice panel is available',async()=>{
        const state=await voice();assert.equal(state.available,true,state.reason??'native_voice_unavailable');
        return await js(`document.querySelector(${quote(start)})?.getClientRects().length>0&&!document.querySelector(${quote(start)}).disabled`)&&state;
      });
      assert.equal(ready.session.dispatched,false);assert.equal(ready.media?.microphoneAccess,'not-requested');
      assert.equal(ready.usage.maximumVoiceSeconds,300);assert.equal(ready.usage.initializationExposureSeconds,15);
      await capture('00-voice-ready');await click(start);
      const running=await waitVoice('Real provider voice session reaches an authoritative lifecycle state',async()=>{
        const state=await voice();return ['running','failed','unknown'].includes(state.session.state)&&state;
      },18000);
      receipt.voice.started={session:running.session,media:running.media,captionCount:running.captions.length};
      assert.equal(running.session.state,'running',running.session.errorCode??'native_voice_did_not_start');
      assert.equal(running.session.dispatched,true);assert.equal(running.session.initializationExposureSeconds,15);
      assert.equal(running.media?.connection,'connected');assert.equal(running.media?.microphoneAccess,'active');assert.equal(running.media?.humanAudibility,'unverified');
      const mediaWindows=require('electron').BrowserWindow.getAllWindows().filter(window=>window!==win&&/\/voice-media\.html$/u.test(window.webContents.getURL()));
      assert.equal(mediaWindows.length,1,'one_owned_private_media_window_required');
      const mediaWindow=mediaWindows[0],mediaPreferences=mediaWindow.webContents.getLastWebPreferences();
      assert.equal(mediaWindow.isVisible(),false);assert.equal(mediaWindow.isFocusable(),false);assert.equal(mediaPreferences.sandbox,true);assert.equal(mediaPreferences.contextIsolation,true);assert.equal(mediaPreferences.nodeIntegration,false);
      assert(require('./live-media-broker.cjs').isSyntheticLiveMediaWindow(mediaWindow),'synthetic_native_media_not_selected');
      assert.equal(mediaWindow.webContents.isAudioMuted(),true,'synthetic_native_output_not_muted');
      receipt.voice.privateMedia={sandbox:true,contextIsolation:true,nodeIntegration:false,hidden:true,focusable:false,nativeOutputMuted:true,
        secureContext:await operation(()=>mediaWindow.webContents.executeJavaScript('isSecureContext',false),'private_media_secure_context_deadline')};
      assert.equal(receipt.voice.privateMedia.secureContext,true);
      await wait('The actual Voice panel observes the running provider state',()=>js(`document.querySelector(${quote(voiceSurface)})?.dataset.state==='running'`));
      await capture('01-voice-running');await click(end);
      const stopped=await waitVoice('Native End releases the private media and records finalization truth',async()=>{
        const state=await voice();return ['closed','unknown'].includes(state.session.state)&&state.media?.microphoneAccess!=='active'&&state;
      },7000);
      receipt.voice.stopped={session:stopped.session,media:stopped.media,captionCount:stopped.captions.length};
      assert.equal(stopped.session.state,'closed',stopped.session.errorCode??'native_voice_finalization_unconfirmed');assert.equal(stopped.session.finalization,'confirmed');
      assert.equal(stopped.media?.localTrackEnabled,false);assert.notEqual(stopped.media?.microphoneAccess,'active');
      assert.equal(mediaWindow.isDestroyed(),true,'private_voice_window_not_released');receipt.voice.privateMedia.destroyedAfterEnd=true;
      await wait('Actual Voice panel observes confirmed closure',()=>js(`(()=>{const root=document.querySelector(${quote(voiceSurface)});return root?.dataset.state==='closed'&&root.textContent.includes('Voice is off.')&&[...root.querySelectorAll('button')].some(button=>button.textContent==='Start voice'&&!button.hidden&&!button.disabled);})()`));
      await capture('02-voice-ended');const after=await rpc('providerActivity',{});
      assert.equal(after.codexConnections,0);receipt.providerActivity={before:providerBefore,after};
      assert.deepEqual(receipt.errors,[],'voice_renderer_console_errors');receipt.passed=true;return;
    }
    if(argv.includes('--missions-product-only')){
      assert(!argv.includes('--bootstrap-vela-api')&&!argv.includes('--missions-api-live-only'),'offline_product_profile_required');
      const subsets=['layout','timers','recovery'].filter(name=>argv.includes('--missions-product-'+name+'-only'));
      assert(subsets.length<=1,'one_bounded_product_subset_required');
      const subset=subsets[0]??'layout',composer=SURFACE+' textarea[aria-label="Message Vela"]';
      receipt.product={subset,nativePrompts:[],verificationBoundary:'Owned Electron software native input and actual visible product/canonical state; no provider calls or physical-device claim.'};
      const vela=()=>rpc('vela',{name:'state',input:{}}),layout=id=>rpc('library',{name:'inspectWorkspace',input:{workspaceId:id}}).then(value=>value.result);
      const hideVela=async()=>{if(await js(`document.querySelector(${quote(composer)})?.getClientRects().length>0`))await click('#vela');
        await wait('Vela composer closes for unobscured product inspection',()=>js(`!document.querySelector(${quote(composer)})?.getClientRects().length`));};
      const ask=async intent=>{
        const before=new Set((await vela()).requests.map(request=>request.id));
        if(!await js(`document.querySelector(${quote(composer)})?.getClientRects().length>0`))await click('#vela');
        await fill(composer,intent);await click(SURFACE+' button[aria-label="Send to Vela"]');
        const settled=await wait('Native product turn: '+intent,async()=>{
          const state=await vela(),request=state.requests.find(item=>!before.has(item.id)&&item.intent===intent);
          return request&&['completed','responded','failed','unknown','invalid-plan','provider-unavailable'].includes(request.state)&&{state,request};
        });
        assert.equal(settled.request.state,'completed',settled.request.errorCode??settled.request.state);
        assert.equal(settled.request.providerId,null,'native_product_started_inference');
        await wait('Canonical native answer is visible',()=>js(`(()=>{const response=document.querySelector(${quote(SURFACE+' .vela-manifestation')}),body=response?.querySelector('.vela-manifestation-content');
          return response?.dataset.requestId===${quote(settled.request.id)}&&body&&!body.hidden&&body.getClientRects().length&&document.querySelector(${quote(SURFACE+' .vela-core-compose')})?.getAttribute('aria-busy')!=='true';})()`));
        assert.equal(require('electron').BrowserWindow.getAllWindows().length,1,'native_product_opened_extra_review_window');
        receipt.product.nativePrompts.push({intent,requestId:settled.request.id,planId:settled.request.planId});return settled;
      };
      const cardGeometry=ids=>js(`(()=>{const top=Math.max(document.querySelector('.topbar')?.getBoundingClientRect().bottom??0,document.querySelector('.brand')?.getBoundingClientRect().bottom??0),bottom=innerHeight-32;
        return ${quote(ids)}.map(id=>{const card=document.querySelector('[data-block="'+id+'"]'),r=card?.getBoundingClientRect();if(!r)return {id,missing:true};
          const visibleWidth=Math.max(0,Math.min(r.right,innerWidth-16)-Math.max(r.left,16)),visibleHeight=Math.max(0,Math.min(r.bottom,bottom)-Math.max(r.top,top));
          return {id,x:r.x,y:r.y,width:r.width,height:r.height,visibleWidth,visibleHeight,visibleFraction:visibleWidth*visibleHeight/(r.width*r.height),topClear:r.top>=top};});})()`);
      const canonicalGeometry=state=>state.blocks.map(({blockId,resourceId,subject,x,y,width,height,zIndex,shape,rotation,minimized,locked,materialVariant})=>
        ({blockId,resourceId,subject,x,y,width,height,zIndex,shape,rotation,minimized,locked,materialVariant})).sort((a,b)=>a.blockId.localeCompare(b.blockId));
      if(subset==='layout'){
        const created=await ask('Create a workspace for A World for Two for Minecraft.'),construction=created.state.receipts.find(receipt=>receipt.requestId===created.request.id&&receipt.workspaceConstruction);
        assert(construction?.workspaceConstruction?.placements.length===3,'three_functional_native_cards_required');
        const proof=construction.workspaceConstruction,before=await layout(proof.workspaceId),desktopBefore=await desktop(),
          noteIds=desktopBefore.resources.filter(resource=>resource.kind==='note'&&proof.resources.some(ref=>ref.resourceId===resource.id)).map(resource=>resource.id),
          taskIds=desktopBefore.resources.filter(resource=>['task','task_group','task_objective','checklist'].includes(resource.kind)&&proof.resources.some(ref=>ref.resourceId===resource.id)).map(resource=>resource.id);
        assert(noteIds.length&&taskIds.length,'actual_native_task_and_note_family_required');
        await hideVela();const ids=before.blocks.map(block=>block.blockId),beforeVisible=await wait('Constructed cards visibly settle',async()=>{const cards=await cardGeometry(ids);return cards.every(card=>card.visibleFraction>.65)&&cards;});
        await capture('00-product-workspace-before');
        const adjusted=await ask('Put the project tasks on the right, and make the notes bigger.'),after=await layout(proof.workspaceId),
          actionReceipt=adjusted.state.receipts.find(receipt=>receipt.requestId===adjusted.request.id&&receipt.workspaceAdjustment);
        assert.equal(actionReceipt?.workspaceAdjustment?.verification.oneUndoEntry,true);assert.equal(after.revision,before.revision+1);
        assert.deepEqual(after.viewport,before.viewport);assert.deepEqual(after.presence,before.presence);
        assert.deepEqual(after.blocks.map(block=>[block.blockId,block.resourceId]).sort(),before.blocks.map(block=>[block.blockId,block.resourceId]).sort());
        for(const old of before.blocks){const current=after.blocks.find(block=>block.blockId===old.blockId);assert.equal(current.locked,old.locked);
          if(noteIds.includes(old.resourceId))assert(current.width>old.width&&current.height>old.height,'native_notes_not_enlarged');
          else if(!taskIds.includes(old.resourceId))assert.deepEqual(canonicalGeometry({blocks:[current]}),canonicalGeometry({blocks:[old]}),'unrelated_scene_card_changed');}
        const notes=after.blocks.filter(block=>noteIds.includes(block.resourceId)),tasks=after.blocks.filter(block=>taskIds.includes(block.resourceId));
        assert(tasks.every(task=>notes.every(note=>task.x>note.x)),'tasks_not_to_right_of_enlarged_notes');
        await hideVela();const afterVisible=await wait('Adjusted cards stay useful in the actual viewport',async()=>{const cards=await cardGeometry(ids);return cards.every(card=>card.topClear&&card.visibleWidth>=180&&card.visibleHeight>=120&&card.visibleFraction>.60)&&cards;});
        await capture('01-product-workspace-adjusted');receipt.product.layout={workspaceId:proof.workspaceId,beforeVisible,afterVisible,receipt:actionReceipt.workspaceAdjustment,
          canonicalBindingsPreserved:true,unrelatedGeometryPreserved:true,locksPreserved:true,viewportPreserved:true};
      } else if(subset==='timers'){
        // Real empty-workspace product UI is setup; all timer/stopwatch/clock work below is natural language.
        await click('#workspace-manager');const action=name=>'.en-navigator [data-action='+quote(name)+']';
        await click(action('toggle-create'));await click(action('create-workspace'));
        await fill('.en-navigator input[aria-label="Environment name"]','Native timer product review');await click(action('submit-workspace-create'));
        const workspaceId=await wait('Blank timer workspace opens',async()=>{const state=await desktop();return state.activeWorkspaceId;});
        if(await js(`document.querySelector('.en-navigator')?.getClientRects().length>0`))await click('#workspace-manager');
        const created=await ask('Set a bread timer for fifteen minutes.'),proof=created.state.receipts.find(receipt=>receipt.requestId===created.request.id&&receipt.clockTimer)?.clockTimer;
        assert(proof?.resourceId&&proof.timerId&&proof.blockId,'native_clock_block_receipt_required');assert.equal(proof.workspaceId,workspaceId);
        const resourceId=proof.resourceId,timerId=proof.timerId,blockId=proof.blockId,view='[data-block="'+blockId+'"] .aw-clock-timer',
          read=()=>rpc('clockTimers',{name:'read',input:{resourceId}}).then(value=>value.result);
        const visibleTimer=async expected=>wait('Actual ClockTimer card: '+expected,async()=>{
          const observed=await js(`(()=>{const node=document.querySelector(${quote(view)}),r=node?.getBoundingClientRect();return {present:!!node,timerId:node?.dataset.timerId,state:node?.dataset.timerState,name:node?.querySelector('[data-clock-timer-name]')?.textContent,status:node?.querySelector('[role=status]')?.textContent,rect:r?{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}:null,viewport:[innerWidth,innerHeight]};})()`);
          receipt.product.timerVisibility=observed;const r=observed.rect;
          return observed.timerId===timerId&&observed.state===expected&&r&&r.width>180&&r.height>160&&r.y>=0&&r.x>=0&&r.right<=observed.viewport[0]&&Math.min(r.bottom,observed.viewport[1])-r.y>160&&observed.name==='bread';
        });
        await hideVela();await capture('00-product-timer-initial');await visibleTimer('running');await capture('01-product-timer-running');
        for(const [intent,expected] of [['Pause my bread timer.','paused'],['Add five minutes.','paused'],['Reset that timer.','ready'],['Start my bread timer.','running']]){
          await ask(intent);const document=await read(),timer=document.timers.find(timer=>timer.id===timerId);assert.equal(timer.state,expected);assert.equal(timer.durationMs,intent.startsWith('Pause')?900000:1200000);await visibleTimer(expected);
        }
        const remaining=await ask('How much time is left?');assert(remaining.state.conversation.messages.some(message=>message.requestId===remaining.request.id&&message.role==='assistant'&&/remaining/u.test(message.content)));
        await ask('Show all my timers.');await hideVela();
        for(const [action,expected] of [['pauseTimer','paused'],['resumeTimer','running']]){
          await click(view+' [data-clock-action='+quote(action)+']');
          await wait('Native timer block control: '+action,async()=>(await read()).timers.find(timer=>timer.id===timerId)?.state===expected);
        }
        await ask('Start a stopwatch.');assert.equal((await read()).stopwatch.state,'running');
        await hideVela();await click(view+' [data-clock-mode="stopwatch"]');await wait('Actual stopwatch output is visible',()=>js(`(()=>{const root=document.querySelector(${quote(view)}),output=root?.querySelector('[data-clock-stopwatch]');return root?.dataset.clockMode==='stopwatch'&&output?.getClientRects().length&&output.textContent!=='00:00.0';})()`));
        await capture('01-product-stopwatch-running');
        await ask("What's the time in Tokyo?");await ask('Add a clock for Tokyo.');await hideVela();await click(view+' [data-clock-mode="clock"]');
        await wait('Actual saved Tokyo clock is visible',()=>js(`document.querySelector(${quote(view+' .aw-clock-timer-world-list')})?.textContent.includes('Tokyo')`));
        await capture('02-product-tokyo-clock');
        await click(view+' [data-clock-mode="timer"]');await click(view+' details:has([data-clock-action="createTimer"]) summary');
        await fill(view+' input[aria-label="New timer name"]','Native completion check');
        const durationInput=view+' input[aria-label="Duration in minutes"]';await click(durationInput);key('A',['control']);
        await operation(()=>win.webContents.insertText('0.017'),'mission_numeric_input_deadline');
        await wait('Native numeric duration is entered',()=>js(`document.querySelector(${quote(durationInput)})?.value==='0.017'`));
        await click(view+' [data-clock-action="createTimer"]');
        const quick=await wait('UI creates a second canonical timer',async()=>{const timer=(await read()).timers.find(timer=>timer.name==='Native completion check');
          return timer?.state==='ready'&&await js(`document.querySelector(${quote(view)})?.dataset.timerId===${quote(timer.id)}`)&&timer;});
        await click(view+' [data-clock-action="startTimer"]');
        const expiry=await wait('Native timer completion reaches the actual block',async()=>{const document=await read(),timer=document.timers.find(timer=>timer.id===quick.id),saved=document.pendingExpiries.filter(item=>item.timerId===quick.id);
          return timer?.state==='completed'&&saved.length===1&&await js(`document.querySelector(${quote(view)})?.dataset.timerState==='completed'&&document.querySelector(${quote(view+' [data-clock-expiry]')})?.textContent.includes('Native completion check completed')`)&&saved[0];});
        await capture('03-product-native-timer-completed');await click(view+' [data-clock-action="acknowledgeExpiry"]');
        await wait('Native completion acknowledgement is durable',async()=>{const document=await read();return document.pendingExpiries.length===0&&document.timers.filter(timer=>timer.id===quick.id&&timer.state==='completed').length===1;});
        const final=await desktop();assert.equal(final.resources.filter(resource=>resource.kind==='clock_timer').length,1);
        assert.equal(final.resources.filter(resource=>resource.kind==='note').length,0);assert.equal(final.blocks.filter(block=>block.workspace_id===workspaceId).length,1);
        receipt.product.timers={workspaceId,resourceId,timerId,blockId,actualBlockUiVerified:true,directPauseResumeVerified:true,completedTimerId:quick.id,
          completionExpiryId:expiry.id,completionAcknowledged:true,canonicalDocument:await read(),noGenericNote:true};
      } else {
        const created=await ask('Create a workspace for native recovery review.'),proof=created.state.receipts.find(receipt=>receipt.requestId===created.request.id&&receipt.workspaceConstruction)?.workspaceConstruction;
        assert(proof,'verified_native_creation_required');const before=await layout(proof.workspaceId),beforeDesktop=await desktop(),
          note=beforeDesktop.resources.find(resource=>resource.kind==='note'&&proof.resources.some(ref=>ref.resourceId===resource.id)),
          noteBefore=note?await rpc('notes',{name:'readNote',input:note.id}):null;
        const undone=await ask('Undo that.');const archived=await desktop();assert(archived.archivedWorkspaces.some(workspace=>workspace.id===proof.workspaceId));
        const recoveryState=await rpc('workspaceRecovery',{name:'state',input:{workspaceId:proof.workspaceId}});
        assert(recoveryState.available&&recoveryState.placementCount===before.blocks.length&&recoveryState.resourceCount===proof.resources.length,'archived_bindings_not_preserved');
        const restored=await ask('Restore that workspace.'),after=await layout(proof.workspaceId);assert.equal((await desktop()).activeWorkspaceId,proof.workspaceId);
        assert.deepEqual(canonicalGeometry(after),canonicalGeometry(before));assert.deepEqual(after.viewport,before.viewport);assert.deepEqual(after.presence,before.presence);
        if(note)assert.deepEqual(await rpc('notes',{name:'readNote',input:note.id}),noteBefore);
        await hideVela();await wait('Restored cards are actually visible',async()=>{const cards=await cardGeometry(after.blocks.map(block=>block.blockId));return cards.every(card=>card.visibleFraction>.65);});
        await capture('00-product-restored-workspace');receipt.product.recovery={workspaceId:proof.workspaceId,originalCreationReceipt:proof,undoRequestId:undone.request.id,restoreRequestId:restored.request.id,
          sameCanonicalBindings:true,contentPreserved:true,layoutPreserved:true,actualRestoredUiVisible:true};
      }
      const after=await rpc('providerActivity',{});assert.equal(after.providerRequests,0);assert.equal(after.codexConnections,0);
      receipt.providerActivity={before:providerBefore,after};receipt.passed=true;return;
    }
    await js(`window.__aerynth.execute(${quote({ type: "createWorkspace", title: WORKSPACE, projectId: null })})`);
    receipt.actions.push({ method: "application-capability-fixture", type: "createWorkspace" });
    const scope = await wait("Canonical workspace is active", async () => {
      const state = await desktop(), workspace = state.workspaces.find(item => item.title === WORKSPACE);
      return workspace && state.activeWorkspaceId === workspace.id && { workspaceId: workspace.id, projectId: null };
    });
    assert.deepEqual(await list(), []);
    if(argv.includes('--missions-api-live-only')){
      assert(argv.includes('--bootstrap-vela-api'),'explicit_protected_credential_import_required');
      const diagnostic=await rpc('velaRequestPreview',{intent:'Remember the project codeword amber-pine. Reply only: Noted.',resourceIds:[],adaptive:true});
      receipt.liveApiPreview={providerId:diagnostic.providerId,kind:diagnostic.route?.kind,sendDisposition:diagnostic.sendDisposition};
      assert.equal(diagnostic.providerId,'openai-api-vela');assert.equal(diagnostic.sendDisposition,'routine');
      const composer=SURFACE+' textarea[aria-label="Message Vela"]';
      const ask=async intent=>{
        const before=new Set((await rpc('vela',{name:'state',input:{}})).requests.map(request=>request.id));
        if(!await js(`document.querySelector(${quote(composer)})?.getClientRects().length>0`))await click('#vela');
        await fill(composer,intent);await click(SURFACE+' button[aria-label="Send to Vela"]');
        const settled=await wait('Dedicated API answer settles',async()=>{
          const state=await rpc('vela',{name:'state',input:{}}),request=state.requests.find(item=>!before.has(item.id)&&item.intent===intent);
          if(!request||['planning','checking','awaiting-review','native-ready'].includes(request.state))return false;
          return {state,request};
        });
        assert.equal(settled.request.state,'responded',settled.request.errorCode??settled.request.state);
        assert.equal(settled.request.providerId,'openai-api-vela');
        const answer=settled.state.conversation.messages.find(message=>message.id===settled.request.response?.messageId);
        assert(answer?.role==='assistant'&&answer.providerId==='openai-api-vela'&&answer.providerContribution?.executionId);
        await wait('Only the canonical concise answer is displayed',()=>js(`(()=>{
          const response=document.querySelector(${quote(SURFACE+' .vela-manifestation')}),body=response?.querySelector('.vela-manifestation-content');
          return response?.dataset.currentMessageId===${quote(answer.id)}&&body&&!body.hidden&&body.getClientRects().length&&
            response.querySelector('.vela-manifestation-kicker')?.hidden&&
            !response.querySelector('.vela-core-plans')?.children.length&&
            document.querySelector(${quote(SURFACE+' .vela-core-compose')})?.getAttribute('aria-busy')!=='true';
        })()`));
        assert.equal(require('electron').BrowserWindow.getAllWindows().length,1,'ordinary_api_send_opened_extra_review');
        return {request:settled.request,answer};
      };
      const first=await ask('Remember the project codeword amber-pine. Reply only: Noted.');
      const second=await ask('What project codeword did I just give you? Reply with only the codeword.');
      assert.match(second.answer.content,/amber-pine/iu);
      assert(second.request.history?.messages.length>=2,'canonical_prior_exchange_was_not_included');
      await capture('00-api-conversation-continuity');
      const after=await rpc('providerActivity',{});
      assert.equal(after.codexConnections,0);assert(after.providerRequests>=2&&after.providerRequests<=4);
      receipt.liveApi={firstRequestId:first.request.id,secondRequestId:second.request.id,canonicalConversationPreserved:true,
        priorExchangeIncluded:true,expectedCodewordReturned:true,extraReviewWindows:0};
      receipt.providerActivity={before:providerBefore,after};receipt.passed=true;return;
    }
    if(argv.includes('--missions-rebirth-only')){
      const composer=SURFACE+' textarea[aria-label="Message Vela"]';
      const ask=async intent=>{
        const before=new Set((await rpc('vela',{name:'state',input:{}})).requests.map(request=>request.id));
        if(!await js(`document.querySelector(${quote(composer)})?.getClientRects().length>0`))await click('#vela');
        await fill(composer,intent);await click(SURFACE+' button[aria-label="Send to Vela"]');
        const request=await wait('Native Vela turn settles: '+intent,async()=>{
          const state=await rpc('vela',{name:'state',input:{}});
          return state.requests.find(request=>!before.has(request.id)&&request.intent===intent&&
            ['completed','responded','failed','unknown','invalid-plan','provider-unavailable'].includes(request.state));
        });
        assert.equal(request.state,'completed',request.errorCode??request.state);
        await wait('The canonical Vela reply is visible',()=>js(`(()=>{
          const response=document.querySelector(${quote(SURFACE+' .vela-manifestation')}),body=response?.querySelector('.vela-manifestation-content');
          return response?.dataset.requestId===${quote(request.id)}&&response.dataset.currentMessageId&&body&&!body.hidden&&
            body.getClientRects().length>0&&body.querySelector('.vela-mission-jobs-done')?.textContent==='1 job done'&&
            !response.querySelector('.vela-core-plans')?.children.length&&
            document.querySelector(${quote(SURFACE+' .vela-core-compose')})?.getAttribute('aria-busy')!=='true'&&
            document.querySelector(${quote(SURFACE+' .vela-core-status')})?.hidden;
        })()`));
        return request;
      };
      const exact='Create a workspace for A World for Two for Minecraft.';
      const created=await ask(exact);
      const initial=await rpc('vela',{name:'state',input:{}});
      const construction=initial.receipts.find(receipt=>receipt.requestId===created.id&&receipt.workspaceConstruction);
      assert(construction&&construction.workspaceConstruction.placements.length===3,'populated_construction_receipt_required');
      const proof=construction.workspaceConstruction,workspaceId=proof.workspaceId;
      const populated=await desktop(),expectedIds=proof.resources.map(resource=>resource.resourceId).sort();
      assert.equal(populated.activeWorkspaceId,workspaceId);
      assert.deepEqual(populated.blocks.filter(block=>block.workspace_id===workspaceId).map(block=>block.resource_id).sort(),expectedIds);
      assert.equal(require('electron').BrowserWindow.getAllWindows().length,1,'routine_workspace_opened_a_second_approval_window');
      await wait('The populated workspace has three visible resource cards',()=>js(`(()=>{
        const ids=${quote(proof.placements.map(placement=>placement.blockId))};
        return ids.every(id=>{const card=document.querySelector('[data-block="'+id+'"]'),r=card?.getBoundingClientRect();
          const header=document.querySelector('.topbar')?.getBoundingClientRect();
          return r&&r.width>80&&r.height>60&&r.top>=(header?.bottom??110)&&Math.min(r.right,innerWidth)-Math.max(r.left,0)>60&&Math.min(r.bottom,innerHeight)-Math.max(r.top,0)>40;});
      })()`));
      await capture('00-populated-minecraft-workspace');
      const complaint="I literally just told you to make a workspace and you didn't!";
      const inspected=await ask(complaint);
      const inspectedState=await rpc('vela',{name:'state',input:{}});
      assert(inspectedState.plans.find(plan=>plan.id===inspected.planId)?.steps.some(step=>step.action.type==='inspectVelaOperation'));
      const checklist=populated.resources.find(resource=>expectedIds.includes(resource.id)&&resource.kind==='checklist');
      const removed=populated.blocks.find(block=>block.workspace_id===workspaceId&&block.resource_id===checklist.id);
      const command={type:'detach',blockId:removed.id,expectedVersion:removed.version,expectedLayoutVersion:populated.layoutVersion};
      await js(`window.__aerynth.execute(${quote(command)})`);
      receipt.actions.push({method:'controlled-canonical-placement-loss',workspaceId,resourceId:checklist.id,blockId:removed.id});
      const missing=await desktop();
      assert.equal(missing.blocks.filter(block=>block.workspace_id===workspaceId).length,2);
      await capture('01-controlled-missing-block');
      const repaired=await ask(complaint);
      const final=await desktop(),finalVela=await rpc('vela',{name:'state',input:{}});
      assert.equal(final.activeWorkspaceId,workspaceId);assert.equal(final.workspaces.length,populated.workspaces.length);
      assert.deepEqual(final.blocks.filter(block=>block.workspace_id===workspaceId).map(block=>block.resource_id).sort(),expectedIds);
      assert(finalVela.plans.find(plan=>plan.id===repaired.planId)?.steps.some(step=>step.action.type==='repairWorkspace'));
      assert(finalVela.receipts.some(receipt=>receipt.requestId===repaired.id&&receipt.workspaceConstruction?.workspaceId===workspaceId));
      assert.deepEqual(finalVela.receipts.find(receipt=>receipt.id===construction.id).workspaceConstruction,proof);
      await capture('02-repaired-minecraft-workspace');
      await click(SURFACE+' button[aria-label="Open completed plan"]');
      await wait('The completed plan opens behind its response control',()=>js(`(()=>{
        const panel=document.querySelector(${quote(SURFACE+' .vela-core-result-panel')}),r=panel?.getBoundingClientRect(),
          open=[...panel?.querySelectorAll('button')??[]].find(button=>button.textContent==='Open workspace'),b=open?.getBoundingClientRect();
        return panel&&!panel.hidden&&panel.open&&panel.querySelector('[data-plan-id="'+${quote(repaired.planId)}+'"]')&&
          r&&r.height>100&&r.top>=0&&r.top<innerHeight-100&&b&&b.width>60&&b.top>=0&&b.bottom<innerHeight;
      })()`));
      await capture('03-completed-plan-disclosure');
      await click(SURFACE+' .vela-core-result-panel button[data-open-workspace]');
      await wait('The completed plan opens the same canonical workspace',async()=>
        (await desktop()).activeWorkspaceId===workspaceId);
      const after=await rpc('providerActivity',{});
      assert.equal(after.providerRequests,providerBefore.providerRequests);assert.equal(after.codexConnections,providerBefore.codexConnections);
      receipt.rebirth={workspaceId,constructionRequestId:created.id,inspectionRequestId:inspected.id,repairRequestId:repaired.id,
        resourceIds:expectedIds,canonicalWorkspacePreserved:true,originalConstructionReceiptPreserved:true};
      receipt.providerActivity={before:providerBefore,after};receipt.passed=true;return;
    }
    if (argv.includes("--missions-header-only")) {
      const chrome = () => js(`(() => {
        const overlay=navigator.windowControlsOverlay,area=overlay?.getTitlebarAreaRect();
        const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
        const header=document.querySelector('.topbar'),pill=document.querySelector('.window-caption-pill'),drag=document.querySelector('.window-drag');
        return {overlayVisible:overlay?.visible===true,area:area&&{x:area.x,y:area.y,width:area.width,height:area.height,right:area.right},
          viewport:{width:innerWidth,height:innerHeight},header:rect(header),pill:{hidden:pill.hidden,...rect(pill)},
          drag:{background:getComputedStyle(drag).backgroundColor,border:getComputedStyle(drag).borderBottomWidth,text:drag.textContent},
          mark:rect(header.querySelector('.brand img')),nameFont:parseFloat(getComputedStyle(header.querySelector('.brand > span')).fontSize),
          controls:[...header.querySelectorAll('button')].filter(node=>node.getClientRects().length).map(node=>({
            label:node.getAttribute('aria-label')||node.textContent.trim(),...rect(node)}))};
      })()`);
      const inspectChrome = async label => {
        const state=await wait(label, async()=>{
          const current=await chrome();
          return current.overlayVisible && !current.pill.hidden && current.controls.every(control=>control.width>0&&control.height>0) && current;
        });
        assert.equal(state.drag.background,"rgba(0, 0, 0, 0)");
        assert.equal(state.drag.border,"0px");
        assert.equal(state.drag.text,"");
        assert(state.header.y<30 && state.mark.width>=76 && state.nameFont>=18,"header_not_raised_and_enlarged");
        assert(state.pill.width>100 && state.pill.width<180 && state.pill.height>=36,"caption_pill_not_localized");
        const visible=state.controls;
        for(const control of visible){
          assert(control.x>=0&&control.right<=state.viewport.width+1&&control.y>=0&&control.bottom<=state.viewport.height,"header_control_offscreen: "+control.label);
          assert(control.y>=state.area.height||control.right<=state.area.right+1,"header_control_under_native_caption: "+control.label);
        }
        for(let i=0;i<visible.length;i++)for(let j=i+1;j<visible.length;j++){
          const a=visible[i],b=visible[j];
          assert(!(Math.min(a.right,b.right)-Math.max(a.x,b.x)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)>1),
            "header_controls_overlap: "+a.label+" / "+b.label);
        }
        return state;
      };
      const captureWindow = async name => {
        const {desktopCapturer,screen}=require("electron"),bounds=win.getBounds();
        const scale=screen.getDisplayMatching(bounds).scaleFactor;
        const sources=await operation(()=>desktopCapturer.getSources({types:["window"],fetchWindowIcons:false,
          thumbnailSize:{width:Math.ceil(bounds.width*scale),height:Math.ceil(bounds.height*scale)}}),"header_window_capture_deadline");
        const source=sources.find(item=>item.id===win.getMediaSourceId());
        assert(source&&!source.thumbnail.isEmpty(),"owned_header_window_capture_unavailable");
        const png=source.thumbnail.toPNG();
        assert(png.length>0&&png.length<=8*MiB,"header_capture_budget");
        await fs.writeFile(path.join(out,name+".png"),png,{flag:"wx"});
        receipt.captures.push({file:name+".png",bytes:png.length});
      };
      const full=await inspectChrome("Floating header clears native window controls");
      await captureWindow("00-floating-header");
      win.setSize(800,650);
      await wait("Compact header viewport",()=>js("innerWidth<850"));
      const compact=await inspectChrome("Compact header retains every visible action without overlap");
      await click("#settings-button");
      await wait("Scene controls open from the compact header",()=>js("document.querySelector('#settings').hidden===false"));
      await click("#settings-close");
      await captureWindow("01-compact-floating-header");
      receipt.header={full,compact,nativeCaptionControlsRetained:true};
      receipt.providerActivity={before:providerBefore,after:await rpc("providerActivity",{})};
      assert.equal(receipt.providerActivity.after.providerRequests,0);
      receipt.passed=true;
      return;
    }
    await click("#vela");
    const composer = SURFACE + ' textarea[aria-label="Message Vela"]';
    if (argv.includes('--missions-aep-presentation-only')) {
      const retryNotes = argv.includes("--missions-aep-retry");
      const observeStart = argv.includes("--missions-aep-start-ui");
      const composerStart = argv.includes("--missions-aep-composer");
      assert(!retryNotes || !argv.includes("--bootstrap-vela-api"), "native_retry_requires_offline_profile");
      assert(!observeStart || !argv.includes("--bootstrap-vela-api"), "native_start_ack_requires_offline_profile");
      assert(!composerStart || !argv.includes("--bootstrap-vela-api"), "native_composer_start_requires_offline_profile");
      // The panel preserves active edits instead of refreshing their controls from events.
      key("Tab");
      assert.equal(await js('document.activeElement?.matches("input,textarea,select")'), false);
      const baseObjective = retryNotes ? OBJECTIVE + " using workspace notes" :
        composerStart ? "measure CPU and RAM" : OBJECTIVE;
      const objective = composerStart ? "Run a mission to " + baseObjective : baseObjective;
      const preview = await rpc("missions", { name: "preview", input: { objective } });
      assert.equal(preview.externalReview, undefined);
      const missionsControl = SURFACE + ' button[aria-label="Missions"]';
      if (observeStart && !composerStart) await click(missionsControl);
      let submitted, mission;
      if (composerStart) {
        const before = await list();
        await fillNative({ click, key, js, wait, insertText: text => operation(() => win.webContents.insertText(text), "mission_text_input_deadline") }, composer, objective);
        await click(SURFACE + ' button[aria-label="Send to Vela"]');
        const start = PREVIEW + ' [data-mission-focus="start-mission"]';
        await wait("Explicit composer command opens local mission review", () => js(`(() => {
          const preview = document.querySelector(${quote(PREVIEW)});
          return preview?.textContent.includes(${quote(objective)}) && preview.textContent.includes('Local read-only tasks') &&
            document.querySelector(${quote(start)})?.getClientRects().length > 0;
        })()`));
        assert.deepEqual(await list(), before, "composer_mission_started_before_review");
        assert.equal((await rpc("providerActivity", {})).providerRequests, 0);
        if (benchmarkMode) await js(`new Promise(resolve => {
          requestAnimationFrame(startedAt => {
            const sample = { startedAt, intervals: [], windowMs: null, discarded: 0, hidden: false };
            window.__missionProfilerBenchmark = sample;
            let previous = startedAt;
            sample.finished = new Promise(finish => {
              const tick = at => {
                sample.hidden ||= document.visibilityState !== 'visible' || !document.hasFocus();
                if (sample.intervals.length < ${FRAME_SAMPLE_LIMIT}) sample.intervals.push(at - previous);
                else sample.discarded++;
                previous = at;
                if (at - startedAt < ${FRAME_WINDOW_MS}) requestAnimationFrame(tick);
                else { sample.windowMs = at - startedAt; finish(); }
              };
              requestAnimationFrame(tick);
            });
            resolve(true);
          });
        })`);
        submitted = performance.now();
        await click(start);
        const existing = new Set(before.map(item => item.id));
        mission = await wait("Reviewed Start creates the explicit composer mission", async () =>
          (await list()).find(item => item.objective === objective && !existing.has(item.id)));
        await wait("Accepted Start clears the unchanged mission draft", () =>
          js(`document.querySelector(${quote(composer)})?.value === ''`));
        receipt.composerStart = { missionId: mission.id, reviewBeforeStart: true };
      } else {
        submitted = performance.now();
        mission = await rpc("missions", { name: "start", input: {
          objective, fingerprint: preview.fingerprint, requestId: randomUUID(),
        } });
        receipt.actions.push({ method: "application-capability-fixture", type: "startLocalMission" });
      }
      const missionId = mission.id;
      if (observeStart) {
        const selector = SURFACE + " .vela-missions-list [data-mission-focus=" + quote(missionId) + "]";
        const label = await wait("Visible canonical mission status acknowledges Start", () => js(`(() => {
          const node = document.querySelector(${quote(selector)}), rect = node?.getBoundingClientRect();
          return document.visibilityState === "visible" && document.hasFocus() && rect?.height > 0 &&
            rect.bottom > 0 && rect.top < innerHeight && !node.closest("[hidden],[inert]") && node.textContent;
        })()`));
        assert.match(label, / · (Queued|Running)$/u, "mission_start_status_was_not_observed_before_completion");
        receipt.visibleStartAcknowledgement = { missionId, label, commandToVisibleObservationMs: performance.now() - submitted };
        await click(missionsControl);
      }
      let failedAttemptId = null;
      if (retryNotes) {
        const failed = await wait("Native note verification fails without an authorized note", async () => {
          const profile = await rpc("missions", { name: "execution-profile", input: { id: missionId } });
          return profile.attempts.find(attempt => attempt.taskId === "notes" && attempt.state === "failed" && attempt.end);
        });
        failedAttemptId = failed.id;
        const title = "Backend performance notes";
        const created = await rpc("desktop", { type: "createResource", kind: "note", title, workspaceId: scope.workspaceId });
        const note = created.resources.find(resource => resource.kind === "note" && resource.title === title);
        assert.ok(note, "native_retry_source_missing");
        await rpc("desktop", { type: "content", resourceId: note.id, expectedVersion: note.version,
          content: "Synthetic backend performance timing baseline and code sampling notes." });
        await wait("Canonical retry is accepted after the note is supplied", async () => {
          const current = await rpc("missions", { name: "read", input: { id: missionId } });
          try {
            return await rpc("missions", { name: "control", input: {
              id: missionId, revision: current.revision, control: { type: "retry", taskId: "notes" },
            } });
          } catch (error) {
            if (!String(error.message).includes("mission_revision_changed")) throw error;
            return false;
          }
        });
        receipt.actions.push({ method: "application-capability-fixture", type: "retryAfterCanonicalNote" });
      }
      const report = await wait("Canonical mission report is available", async () => {
        const state = await rpc("vela", { name: "state", input: {} });
        return state.conversation?.messages.find(message => message.missionReport?.missionId === missionId);
      });
      const reportLink = SURFACE + ' .vela-manifestation [data-mission-report-link=' + quote(missionId) + ']';
      await wait("The report link is rendered in the current Vela reply", () =>
        js(`document.querySelector(${quote(reportLink)})?.getClientRects().length > 0`));
      if (benchmarkMode) {
        const reportObservedInWindowMs = await js("performance.now() - window.__missionProfilerBenchmark.startedAt");
        const profile = await wait("Benchmark observes canonical renderer delivery", async () => {
          const current = await rpc("missions", { name: "execution-profile", input: { id: missionId } });
          return current.userDelivery?.messageId === report.id && current;
        });
        const startToReceiptReadbackMs = performance.now() - submitted;
        const frames = summarizeFrames(await js(`(async () => {
          const sample = window.__missionProfilerBenchmark;
          await sample.finished;
          delete window.__missionProfilerBenchmark;
          const { intervals, windowMs, hidden, discarded } = sample;
          return { intervals, windowMs, hidden, discarded };
        })()`));
        assert.ok(reportObservedInWindowMs > 0 && reportObservedInWindowMs <= frames.windowMs, "mission_report_outside_frame_window");
        const verified = await read(missionId);
        assert.equal(verified.outcome, "verified");
        assert.deepEqual(verified.tasks.map(task => [task.executor, task.state, task.attempts.length, task.attempts[0]?.evidence?.source]), [
          ["sample.cpu", "verified", 1, "node:os.cpus"], ["sample.ram", "verified", 1, "node:os.totalmem+freemem"],
          ["join.samples", "verified", 1, "aerynth.mission.journal"],
        ]);
        assert.equal(profile.userDelivery.source, "renderer-visible-frame");
        const stagingToReceiptMs = profile.userDelivery.stagingToReceiptMs;
        if (benchmarkMode === "full") assert.ok(Number.isFinite(stagingToReceiptMs) && stagingToReceiptMs >= 0);
        else assert.equal(stagingToReceiptMs, null);
        assert.equal(profile.outcome, "verified");
        assert.equal(profile.attempts.length, verified.tasks.length);
        const measured = profile.attempts.filter(attempt => attempt.interval).length;
        const phased = profile.attempts.filter(attempt => attempt.phases?.verification).length;
        assert.equal(measured, benchmarkMode === "off" ? 0 : verified.tasks.length);
        assert.equal(phased, benchmarkMode === "full" ? verified.tasks.length : 0);
        const { providerRequests, codexConnections } = await rpc("providerActivity", {});
        assert.equal(providerRequests, 0);
        assert.equal(codexConnections, 0);
        receipt.profilerBenchmark = { mode: benchmarkMode, frames, reportObservedInWindowMs, startToReceiptReadbackMs,
          stagingToReceiptMs, measuredAttempts: measured, phasedAttempts: phased,
          verifiedAttempts: verified.tasks.length, providerRequests, codexConnections };
        receipt.passed = true;
        return;
      }
      const presentation = await wait("Visible mission report has a scoped execution-profile receipt", async () => {
        const profile = await rpc("missions", { name: "execution-profile", input: { id: missionId } });
        return profile.userDelivery?.messageId === report.id && profile;
      });
      assert.equal(presentation.userDelivery.source, "renderer-visible-frame");
      assert.equal(presentation.outcome, "verified");
      assert.ok(Number.isFinite(presentation.userDelivery.stagingToReceiptMs) && presentation.userDelivery.stagingToReceiptMs >= 0);
      assert.ok(Number.isFinite(presentation.intakeToReportStagedMs) && presentation.intakeToReportStagedMs >= 0);
      assert.equal(presentation.intakeToUserDeliveryMs,
        presentation.intakeToReportStagedMs + presentation.userDelivery.stagingToReceiptMs);
      if (composerStart) {
        assert.equal(presentation.wallTime?.from, "mission-start-command");
        assert.equal(presentation.wallTime?.through, "renderer-receipt");
        assert.equal(presentation.wallTime?.elapsedMs, presentation.intakeToUserDeliveryMs);
      }
      assert.deepEqual(presentation.firstMeaningfulOutput, {
        kind: "mission-report", source: "renderer-visible-frame", messageId: report.id,
        publicationEventId: presentation.reportPublication.eventId,
        receivedAt: presentation.userDelivery.receivedAt, intakeToReceiptMs: presentation.intakeToUserDeliveryMs,
      });
      const { reportLatency, reportPublication, lastSettlement } = presentation;
      const { compositionStartedMs, composedMs, stagedMs, clock } = reportPublication.timing;
      assert.equal(lastSettlement.clock, clock);
      assert.ok(lastSettlement.monotonicMs <= compositionStartedMs && compositionStartedMs <= composedMs && composedMs <= stagedMs);
      assert.deepEqual(reportLatency, {
        publicationEventId: reportPublication.eventId,
        settlementEventSeq: lastSettlement.eventSeq,
        settlementToCompositionMs: compositionStartedMs - lastSettlement.monotonicMs,
        compositionMs: composedMs - compositionStartedMs,
        compositionToStagingMs: stagedMs - composedMs,
        stagingToRendererReceiptMs: presentation.userDelivery.stagingToReceiptMs,
      });
      if (failedAttemptId) {
        const retry = presentation.work.retries.find(item => item.taskId === "notes");
        const join = presentation.attempts.find(attempt => attempt.taskId === "report");
        assert.equal(retry?.previousAttemptId, failedAttemptId);
        assert.equal(retry.previousOutcome, "failed");
        assert.ok(retry.previousSettlement.eventSeq < retry.retryRequest.eventSeq &&
          retry.retryRequest.eventSeq < retry.retryDispatch.eventSeq);
        assert.ok(retry.settlementToRetryRequestMs >= 0 && retry.retryRequestToDispatchMs >= 0);
        assert.ok(join?.predecessors.includes(retry.attemptId));
        assert.ok(!join.predecessors.includes(failedAttemptId));
        assert.ok(presentation.work.overlapMs > 0);
        const failed = presentation.work.occupancyByOutcome.find(item => item.outcome === "failed");
        assert.ok(failed?.clockSegments.some(segment => segment.attemptIds.includes(failedAttemptId)));
        receipt.nativeRetry = { retry, failed, joinAttemptId: join.id, overlapMs: presentation.work.overlapMs };
      }
      const verifiedMission = await rpc("missions", { name: "read", input: { id: missionId } });
      const canonicalLeases = new Map(verifiedMission.tasks.flatMap(task =>
        task.attempts.map(attempt => [attempt.id, attempt.resourceLease])));
      const leases = presentation.attempts.map(({ id, taskId, resourceLease }) => {
        assert.ok(resourceLease?.leaseId && resourceLease.epoch, "native_mission_attempt_lease_missing");
        assert.equal(resourceLease.leaseId, canonicalLeases.get(id)?.leaseId);
        assert.equal(resourceLease.epoch, canonicalLeases.get(id)?.epoch);
        assert.equal(Object.hasOwn(resourceLease, "gpuContextId"), false);
        return { attemptId: id, taskId, leaseId: resourceLease.leaseId, epoch: resourceLease.epoch, kind: resourceLease.kind };
      });
      assert.equal(leases.length, canonicalLeases.size);
      assert.equal(new Set(leases.map(lease => lease.leaseId)).size, leases.length);
      assert.equal(presentation.resourcePolicy.leaseCoverage.withReceipt, leases.length);
      assert.equal(presentation.resourcePolicy.leaseCoverage.withoutReceipt, 0);
      receipt.executionPresentation = { missionId, messageId: report.id,
        stagingToReceiptMs: presentation.userDelivery.stagingToReceiptMs,
        intakeToReceiptMs: presentation.intakeToUserDeliveryMs,
        reportEventId: reportPublication.eventId, reportLatency, firstMeaningfulOutput: presentation.firstMeaningfulOutput, leases };
      if (recordAiw) {
        await click(reportLink);
        await click(RECORD + ' [data-mission-focus="preview-workroom"]');
        await click(RECORD + ' [data-mission-focus="apply-workroom"]');
        const selector = '[data-mission-workroom-card="stream"] .aw-intelligence-inspection';
        const workroom = await wait("Canonical workroom and stream placement", async () => {
          const projection = await read(missionId);
          const state = await desktop();
          if (projection.workroom?.workspaceId !== state.activeWorkspaceId) return false;
          const placement = state.blocks.find(item => item.workspace_id === state.activeWorkspaceId &&
            item.resource_id === projection.workroom.missionCards.stream);
          return placement && { workspaceId: state.activeWorkspaceId, x: placement.x, y: placement.y };
        });
        await js(`window.__aerynth.execute(${quote({ type: "setViewport", workspaceId: workroom.workspaceId,
          viewport: { x: workroom.x - 60, y: workroom.y - 180, zoom: 1 } })})`);
        await click(selector + ' > summary');
        await click(selector + ' [data-intelligence-zone="profiler"]');
        const profile = await rpc("missions", { name: "execution-profile", input: { id: missionId } });
        const measuredAttempts = await wait("AIW renders the same scoped execution profile", () => js(`(() => {
          const panel = document.querySelector(${quote(selector + ' [role="tabpanel"]')});
          const metric = [...panel?.querySelectorAll('dt') ?? []].find(row => row.textContent === 'Measured attempts');
          return metric?.nextElementSibling.firstChild.textContent;
        })()`));
        assert.equal(measuredAttempts, [profile.work.intervalCoverage.measured, profile.work.intervalCoverage.attempts].join(" / "));
        receipt.workroomInspection = { missionId: profile.missionId, revision: profile.revision, measuredAttempts };
        await capture("01-adaptive-intelligence-profiler");
        receipt.workroomInspection.renderer = await js(`new Promise(resolve => {
          requestAnimationFrame(start => {
            let previous = start;
            const intervals = [];
            const tick = at => {
              intervals.push(at - previous);
              previous = at;
              if (at - start < ${FRAME_WINDOW_MS} && intervals.length < ${FRAME_SAMPLE_LIMIT}) requestAnimationFrame(tick);
              else resolve({ intervals, windowMs: at - start, hidden: document.hidden || !document.hasFocus(), discarded: 0 });
            };
            requestAnimationFrame(tick);
          });
        })`).then(summarizeFrames);
        receipt.workroomInspection.graphicsBackend = await js("window.__aerynth.snapshot().gpu.backend");
        const recorder = await operation(
          () => startWindowRecording(win, win.webContents.session, win.webContents.getURL()),
          "aiw_video_start_deadline",
        );
        try {
          await click(selector + ' [data-intelligence-zone="resource"]');
          const resource = await js(`[...document.querySelectorAll(${quote(selector + ' [data-intelligence-field^="Lease · "]')})]
            .map(row => row.dataset.intelligenceSource).sort()`);
          assert.deepEqual(resource, profile.attempts.flatMap(attempt => attempt.resourceLease ? [attempt.resourceLease.leaseId] : []).sort());
          if (argv.includes("--missions-aiw-inspection")) {
            const policy = await rpc("resourcePolicyNative", { name: "inspect" });
            await wait("AIW reads the authoritative resource policy", () => js(`(() => {
              const panel = document.querySelector(${quote(selector + ' [aria-label="Current resource policy"]')});
              return panel && !panel.hidden && panel.textContent.includes(${quote(policy.epoch)}) &&
                panel.textContent.includes("Configuration version") && panel.textContent.includes("Local CPU");
            })()`));
            const privateRouteDenied = await js(`window.aerynthHost.command("resourcePolicyNative", {name:"inspect"}).then(() => false, () => true)`);
            assert.equal(privateRouteDenied, true);
            receipt.workroomInspection.resourcePolicy = { epoch: policy.epoch, configVersion: policy.configVersion, privateRouteDenied };
          }
          await capture("02-adaptive-intelligence-resource");
          await click(selector + ' > summary');
        } finally {
          receipt.workroomInspection.video = await operation(
            () => recorder.stop(path.join(out, "adaptive-intelligence-inspection.webm")),
            "aiw_video_stop_deadline",
          );
        }
      } else {
        await capture("01-native-mission-report");
      }
      receipt.providerActivity = { before: providerBefore, after: await rpc("providerActivity", {}) };
      assert.equal(receipt.providerActivity.after.providerRequests, 0);
      assert.equal(receipt.providerActivity.after.codexConnections, 0);
      assert.deepEqual(receipt.errors, [], "mission_presentation_renderer_errors");
      receipt.passed = true;
      return;
    }
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
    const reportMessage = await wait("Vela posts the completed mission result automatically", async () => {
      const state = await rpc("vela", { name: "state", input: {} });
      return state.conversation?.messages.find(message => message.missionReport?.jobsDone === 4);
    });
    const reportIcon = id => '[data-mission-report-link=' + quote(id) + ']';
    await click(SURFACE + ' .vela-manifestation ' + reportIcon(reportMessage.missionReport.missionId));
    const rendered = await wait("Verified mission and tasks in Vela", () => js(`(()=>{const p=document.querySelector(${quote(RECORD + '[data-mission-outcome="verified"]')});return p?.getClientRects().length&&{id:p.dataset.missionId,title:p.querySelector('h3').textContent,tasks:[...p.querySelectorAll('[data-mission-task][data-task-state]')].map(n=>[n.dataset.missionTask,n.dataset.taskState])}})()`));
    assert.equal(rendered.title, OBJECTIVE);
    const missions = await list();
    assert.equal(missions.length, 1);
    assert.equal(missions[0].id, rendered.id);
    const mission = await read(rendered.id);
    assert.deepEqual(rendered.tasks, mission.tasks.map(task => [task.id, task.state]));
    receipt.journal = verifyJournal(mission, scope, source.hashes["prototypes/integrated-backend/src/core.mts"]);
    const firstAttempt = mission.tasks[0].attempts[0];
    const attemptDisclosure = RECORD + ' details[data-mission-disclosure=' + quote(firstAttempt.id) + ']';
    await click(attemptDisclosure + ' > summary');
    const admissionDisclosure = attemptDisclosure + ' details[data-mission-admission="attempt"]';
    await click(admissionDisclosure + ' > summary');
    receipt.admission = await wait("Vela displays the recorded admission limit and physical memory reading", () => js(`(() => {
      const disclosure = document.querySelector(${quote(admissionDisclosure)});
      const memory = disclosure?.querySelector('[data-admission-metric="availableMemoryBytes"]');
      return disclosure?.open && memory?.getClientRects().length && {
        limit: disclosure.querySelector('summary').textContent, measuredAt: memory.querySelector('time')?.dateTime,
      };
    })()`));
    assert(receipt.admission.limit.includes(String(firstAttempt.admission.workerLimit)));
    assert.equal(receipt.admission.measuredAt, firstAttempt.admission.readings.availableMemoryBytes.observedAt);
    await click(attemptDisclosure + ' > summary');
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
    assert.deepEqual(reportMessage.missionReport, { missionId: rendered.id, ...scope, jobsDone: 4 });
    await click(SURFACE + ' button[aria-label="History"]');
    await click(SURFACE + ' .vela-core-history ' + reportIcon(rendered.id));
    await wait("Vela chat opens the canonical mission", () => js(
      `document.querySelector(${quote(RECORD + '[data-mission-id=' + quote(rendered.id) + ']')})?.getClientRects().length > 0`,
    ));
    receipt.reportLink = { missionId: rendered.id, messageId: reportMessage.id };
    await click(RECORD + ' [data-mission-focus="preview-workroom"]');
    const reviewedCards = await wait("Workroom preview in Vela", () => js(`(() => {
      const apply = document.querySelector(${quote(RECORD + ' [data-mission-focus="apply-workroom"]')});
      return apply?.getClientRects().length && [...apply.closest('.vela-core-plan').querySelectorAll('ul > li')].map(row => row.textContent);
    })()`));
    for (const label of ["Mission graph", "Mission checklist", "Mission timeline", "Verification evidence", "Mission performance", "Mission Intelligence Stream"]) {
      assert(reviewedCards.some(row => row.startsWith(label + " · ")), `missing_workroom_review_${label}`);
    }
    assert.equal((await desktop()).workspaces.length, 1, "workroom_preview_changed_canonical_state");
    const originEvents = (await rpc("replay", { after: 0, limit: 1000 })).events.filter(event => event.mission?.id === rendered.id);
    assert(originEvents.some(event => event.type === "vela.mission/report-posted"), "origin_report_stream_event_missing");
    await click(RECORD + ' [data-mission-focus="apply-workroom"]');
    const workroom = await wait("Canonical mission workroom is active", async () => {
      const state = await desktop(), room = state.workspaces.find(item => item.title === "Backend performance workroom");
      if (!room || state.activeWorkspaceId !== room.id) return null;
      const projection = await read(rendered.id);
      return projection.workroom?.workspaceId === room.id && {
        id: room.id, sourceMissionId: projection.id, outcome: projection.outcome,
        placements: state.blocks.filter(block => block.workspace_id === room.id && block.resource_id).map(block => ({
          blockId: block.id, resourceId: block.resource_id, x: block.x, y: block.y, width: block.width, height: block.height,
          kind: state.resources.find(resource => resource.id === block.resource_id)?.kind,
        })),
        viewport: state.viewport,
        checklistId: projection.workroom.missionChecklistResourceId,
        timelineId: projection.workroom.missionTimelineResourceId,
        missionCards: projection.workroom.missionCards,
        conversationId: projection.workroom.missionConversationResourceId,
      };
    });
    assert.equal(workroom.outcome, "verified");
    assert.equal((await list())[0].id, rendered.id);
    const roomVela = await rpc("vela", { name: "state", input: {} });
    assert(!roomVela.conversation.messages.some(message => message.id === reportMessage.id), "mission_report_link_escaped_origin");
    const expectedKinds = { checklist: "checklist", timeline: "timeline", graph: "note", evidence: "note", performance: "note", stream: "stream" };
    const bindings = { checklist: workroom.checklistId, timeline: workroom.timelineId, ...workroom.missionCards };
    assert.deepEqual(Object.keys(bindings).sort(), Object.keys(expectedKinds).sort(), "native_workroom_card_bindings");
    assert.equal(new Set(Object.values(bindings)).size, Object.keys(bindings).length, "duplicate_workroom_resource_binding");
    assert(workroom.placements.some(placement => placement.kind === "conversation"), "workroom_chat_placement_missing");
    for (const [kind, resourceKind] of Object.entries(expectedKinds)) {
      assert(bindings[kind], `missing_${kind}_binding`);
      const placements = workroom.placements.filter(placement => placement.resourceId === bindings[kind]);
      assert.equal(placements.length, 1, `missing_or_duplicate_${kind}_placement`);
      assert.equal(placements[0].kind, resourceKind);
    }
    const linked = await read(rendered.id);
    const readCard = resourceId => rpc("missions", { name: "workroom-resource", input: { resourceId } });
    const cards = Object.fromEntries(await Promise.all(Object.entries(bindings).map(async ([kind, id]) => [kind, await readCard(id)])));
    for (const [kind, card] of Object.entries(cards)) {
      assert.equal(card?.missionId, rendered.id, `wrong_${kind}_mission`);
      assert.equal(card.revision, linked.revision);
      assert.equal(card.outcome, linked.outcome);
      if (kind !== "checklist" && kind !== "timeline") assert.equal(card.dashboard.kind, kind);
    }
    const checklist = linked.tasks.map(task => [task.id, task.state]);
    const timelineSequences = linked.events.map(event => event.seq);
    assert.deepEqual(cards.checklist.checklist.map(task => [task.taskId, task.state]), checklist);
    assert.deepEqual(cards.timeline.timeline, linked.events);
    assert.equal(cards.graph.dashboard.objective, linked.objective);
    assert.equal(cards.graph.dashboard.planRevision, linked.planRevision);
    assert.deepEqual(cards.graph.dashboard.tasks.map(({ id, title, state, dependencies, executor }) =>
      [id, title, state, dependencies, executor]), linked.tasks.map(({ id, objective, state, dependencies, executor }) =>
      [id, objective, state, dependencies, executor]));
    assert.deepEqual(cards.evidence.dashboard.criteria, linked.criteria);
    const evidenceFields = row => [row.taskId, row.criterion, row.evidenceId, row.source, row.passed];
    assert.deepEqual(cards.evidence.dashboard.rows.map(evidenceFields), linked.tasks.map(task => {
      const attempt = task.attempts.at(-1);
      return [task.id, task.criterion, attempt.evidence.id, attempt.evidence.source, attempt.verification.passed];
    }));
    assert.deepEqual(cards.performance.dashboard.profile, linked.profile);
    const streamEvents = cards.stream.dashboard.events;
    const replayFields = event => [event.eventId, event.cursor, event.receivedAt, event.type, event.status, event.classification];
    assert.deepEqual(streamEvents.filter(event => !["vela.mission/workroom", "vela.mission/conversation-receipt"].includes(event.type)).map(replayFields), originEvents.map(replayFields));
    assert.equal(streamEvents.filter(event => event.type === "vela.mission/workroom" && event.classification === "observed").length, 1);

    const appCommand = input => js(`window.__aerynth.execute(${quote(input)})`);
    const showCard = async (kind, inspect) => {
      const placement = workroom.placements.find(item => item.resourceId === bindings[kind]);
      const selector = `[data-block=${quote(placement.blockId)}] [data-mission-workroom-card=${quote(kind)}][data-mission-id=${quote(rendered.id)}]`;
      const probe = () => js(`(() => {
        const card = document.querySelector(${quote(selector)});
        if (!card || card.dataset.missionRevision !== ${quote(String(linked.revision))} || card.closest('[inert],[hidden]')) return null;
        const rect = card.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || rect.top < 0 || rect.top >= innerHeight || rect.left >= innerWidth || rect.right <= 0) return null;
        return (${inspect})(card);
      })()`);
      const visible = await probe();
      if (visible) return visible;
      await appCommand({ type: "setViewport", workspaceId: workroom.id, viewport: { x: placement.x - 60, y: placement.y - 180, zoom: 1 } });
      return wait(`Canonical ${kind} card renders in its workspace placement`, probe);
    };
    const renderedCards = {};
    renderedCards.tasks = await showCard("checklist", `card => [...card.querySelectorAll('[data-mission-task]')].map(row => [row.dataset.missionTask, row.dataset.taskState])`);
    renderedCards.timeline = await showCard("timeline", `card => [...card.querySelectorAll('[data-mission-sequence]')].map(row => Number(row.dataset.missionSequence))`);
    renderedCards.graph = await showCard("graph", `card => [...card.querySelectorAll('[data-mission-task]')].map(row => ({
      taskId: row.dataset.missionTask, state: row.dataset.taskState, dependencies: JSON.parse(row.dataset.taskDependencies), text: row.textContent
    }))`);
    renderedCards.evidence = await showCard("evidence", `card => [...card.querySelectorAll('[data-mission-evidence-id]')].map(row => ({
      taskId: row.dataset.missionTask, evidenceId: row.dataset.missionEvidenceId, text: row.textContent
    }))`);
    renderedCards.performance = await showCard("performance", `card => Object.fromEntries([...card.querySelectorAll('[data-mission-metric]')].map(row => [row.dataset.missionMetric, row.querySelector('strong')?.textContent]))`);
    renderedCards.stream = await showCard("stream", `card => [...card.querySelectorAll('[data-stream-event-id]')].map(row => ({
      eventId: row.dataset.streamEventId, cursor: Number(row.dataset.streamCursor), time: row.querySelector('time')?.dateTime,
      evidenceLabel: row.querySelector('small')?.textContent
    }))`);
    assert.deepEqual(renderedCards.tasks, checklist);
    assert.deepEqual(renderedCards.timeline, timelineSequences);
    assert.deepEqual(renderedCards.graph.map(row => [row.taskId, row.state, row.dependencies]), linked.tasks.map(task => [task.id, task.state, task.dependencies]));
    for (const [index, task] of linked.tasks.entries()) assert(renderedCards.graph[index].text.includes(task.objective));
    assert.deepEqual(renderedCards.evidence.map(row => [row.taskId, row.evidenceId]), linked.tasks.map(task => [task.id, task.attempts.at(-1).evidence.id]));
    for (const [index, task] of linked.tasks.entries()) {
      assert(renderedCards.evidence[index].text.includes("Evidence check passed"));
      assert(renderedCards.evidence[index].text.includes(task.attempts.at(-1).evidence.source));
    }
    for (const metric of ["attempts", "peakWorkers", "providerCalls"]) {
      assert.equal(renderedCards.performance[metric], String(linked.profile[metric]));
    }
    assert.equal(renderedCards.performance.reportedTotalTokens, "Unavailable");
    assert.deepEqual(renderedCards.stream.sort((a, b) => a.cursor - b.cursor).map(({ eventId, cursor, time }) => [eventId, cursor, time]),
      streamEvents.map(event => [event.eventId, event.cursor, event.receivedAt]));
    assert(renderedCards.stream.every(row => row.evidenceLabel?.split(" · ")[0] === "Observed"), "workroom_stream_evidence_class_missing");
    if (workroom.viewport) await appCommand({ type: "setViewport", workspaceId: workroom.id, viewport: workroom.viewport });
    receipt.workroom = { ...workroom, blocks: workroom.placements.map(placement => placement.resourceId), reviewedCards, renderedCards };
    await wait("Mission workroom opens without the Vela overlay", () => js(`!document.querySelector(${quote(SURFACE)})`));
    const graphBlock = workroom.placements.find(item => item.resourceId === bindings.graph).blockId;
    await wait("The leading graph is below the workspace controls", () => js(`(() => {
      const graph = document.querySelector(${quote('[data-block=' + quote(graphBlock) + ']')})?.getBoundingClientRect();
      const toolbar = document.querySelector('#workspace-manager')?.getBoundingClientRect();
      return graph && toolbar && graph.top >= toolbar.bottom && graph.bottom < innerHeight;
    })()`));
    await capture("03-linked-mission-workroom");
    const initialWindow = win.getBounds(), fullViewport = await js("[innerWidth, innerHeight]");
    win.setSize(1150, 760);
    const compactViewport = await wait("Aerynth reflows at a compact window size", () => js(
      `[innerWidth, innerHeight].every((extent, i) => extent < ${quote(fullViewport)}[i] - 100) && [innerWidth, innerHeight]`,
    ));
    assert.equal(await showCard("graph", "card => card.querySelectorAll('[data-mission-task]').length"), linked.tasks.length);
    win.setBounds(initialWindow);
    const restoredViewport = await wait("Aerynth restores the original window size", () => js(
      `[innerWidth, innerHeight].every((extent, i) => Math.abs(extent - ${quote(fullViewport)}[i]) <= 12) && [innerWidth, innerHeight]`,
    ));
    if (workroom.viewport) await appCommand({ type: "setViewport", workspaceId: workroom.id, viewport: workroom.viewport });
    const placedAfterResize = (await desktop()).blocks.filter(block => block.workspace_id === workroom.id && block.resource_id);
    for (const before of workroom.placements) {
      const after = placedAfterResize.find(block => block.id === before.blockId);
      assert.deepEqual([after?.x, after?.y, after?.width, after?.height], [before.x, before.y, before.width, before.height]);
    }
    receipt.workroom.windowSizes = { full: fullViewport, compact: compactViewport, restored: restoredViewport, savedPlacementsPreserved: true };

    const conversation = await rpc("conversation", { name: "detail", input: { resourceId: workroom.conversationId } });
    assert.equal(conversation.messages.total, 1, "mission_conversation_receipt_count");
    const handoffMessage = conversation.messages.items[0];
    assert.equal(handoffMessage.provenance, "application");
    assert(handoffMessage.content.includes(rendered.id) && handoffMessage.content.includes(OBJECTIVE), "scoped_mission_handoff_required");
    for (const task of linked.tasks) {
      const evidence = task.attempts.at(-1).evidence;
      assert(handoffMessage.content.includes(evidence.id) && handoffMessage.content.includes(evidence.observedAt), "original_evidence_provenance_required");
    }
    assert.equal(streamEvents.filter(event => event.type === "vela.mission/conversation-receipt").length, 1);
    const chatPlacement = workroom.placements.find(item => item.resourceId === workroom.conversationId);
    const chatBlock = `[data-block=${quote(chatPlacement.blockId)}]`;
    await appCommand({ type: "setViewport", workspaceId: workroom.id,
      viewport: { x: chatPlacement.x - 60, y: chatPlacement.y - 180, zoom: 1 } });
    await wait("The workroom chat renders its canonical verified handoff", () => js(`(() => {
      const message = document.querySelector(${quote(chatBlock + ' [data-message-id=' + quote(handoffMessage.id) + '] .cp-message-content')});
      return message?.getClientRects().length && message.textContent.includes(${quote(rendered.id)});
    })()`));
    await click(chatBlock + ' [aria-label="History, search and branches"]');
    const sourceMessage = '#conversation-surface [data-message-id=' + quote(handoffMessage.id) + ']';
    const actionsSelector = sourceMessage + ' summary[data-cp-control="message-actions"]';
    try { await click(actionsSelector, true); }
    catch (error) {
      receipt.conversationControlDiagnostic = await js(`(() => {
        const node=document.querySelector(${quote(actionsSelector)}),rect=node?.getBoundingClientRect();
        return {rect:rect?.toJSON(),hit:rect&&document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)?.outerHTML.slice(0,400),
          ancestry:node&&[node,...(function*(n){while(n=n.parentElement)yield n;})(node)].map(n=>({tag:n.tagName,class:n.className,hover:n.matches(':hover'),opacity:getComputedStyle(n).opacity,rect:n.getBoundingClientRect().toJSON()})).slice(0,10)};
      })()`);
      await capture("04-mission-conversation-control-diagnostic");
      throw error;
    }
    await click(sourceMessage + ' button[data-cp-control="branch"]');
    await fill('#conversation-surface input[aria-label="Branch title"]', 'Synthetic mission follow-up branch');
    await click('#conversation-surface form:has([data-cp-group="branch-source-review"]) button[data-cp-control="branch"]');
    await wait("Selected mission context is prepared for review", () => js(
      `document.querySelector('#conversation-surface .cp-secondary')?.textContent.includes('awaiting your review')`,
    ));
    await click('#conversation-surface .cp-secondary > button:nth-of-type(1)');
    const branch = await wait("The reviewed mission branch keeps its source message identity", async () => {
      const state = await desktop(), resource = state.resources.find(item => item.title === 'Synthetic mission follow-up branch');
      if (!resource) return null;
      const canonical = await rpc("snapshot", {});
      if (!Object.values(canonical.handoffs).some(item => item.resourceId === resource.id && item.state === "approved") ||
        !await js("document.querySelector('#conversation-surface .cp-chat-identity h3')?.textContent === 'Synthetic mission follow-up branch'")) return null;
      const detail = await rpc("conversation", { name: "detail", input: { resourceId: resource.id } });
      const source = detail.messages.items.find(item => item.id === handoffMessage.id && item.inherited);
      return source?.content === handoffMessage.content && detail.lineage.some(edge =>
        edge.parentResourceId === workroom.conversationId && edge.childResourceId === resource.id) &&
        { resourceId: resource.id, sourceMessageId: source.id, sourceResourceId: source.resourceId,
          providerId: detail.conversation.providerId, inherited: source.inherited };
    });
    assert.equal(branch.providerId, 'local');
    await capture("04-mission-conversation-branch");
    await click('#conversation-surface button[data-cp-control="close"]');
    await wait("Mission conversation history closes", () => js("!document.querySelector('#conversation-surface')"));
    receipt.workroom.conversation = { resourceId: workroom.conversationId, messageId: handoffMessage.id, branch };

    const recoveryLayout = await rpc("library", { name: "inspectWorkspace", input: { workspaceId: workroom.id } });
    const recoveryGraph = (await rpc("snapshot", {})).graph;
    await click('.aw-workspace-layout button[aria-label="Workspace actions"]');
    const recoveryControl = name => '.aw-workspace-actions [data-action=' + quote(name) + ']';
    await click(recoveryControl("creation-toggle"));
    await click(recoveryControl("undo-creation"));
    const recoveryRoot = "#workspace-creation-recovery";
    await wait("Workspace creation undo is reviewed without mutating the workspace", () => js(`(() => {
      const root=document.querySelector(${quote(recoveryRoot)}),button=root?.querySelector('[data-recovery-action="apply"]');
      return root?.dataset.workspaceRecovery===${quote(workroom.id)} && button?.textContent==='Undo creation' && !button.disabled;
    })()`));
    assert((await desktop()).workspaces.some(item => item.id === workroom.id));
    await click(recoveryRoot + ' [data-recovery-action="apply"]');
    const archivedWorkroom = await wait("Creation undo archives the workroom and preserves its canonical data", async () => {
      const state=await desktop();
      return state.archivedWorkspaces?.find(item=>item.id===workroom.id) &&
        await js(`document.querySelector(${quote(recoveryRoot)})?.dataset.state==='applied'`) && state;
    });
    assert(!archivedWorkroom.workspaces.some(item=>item.id===workroom.id));
    assert.deepEqual((await rpc("snapshot", {})).graph, recoveryGraph, "creation_undo_changed_conversation_history");
    await click(recoveryRoot + ' [data-recovery-action="review"]');
    await wait("A fresh review restores the same saved workroom", () => js(
      `document.querySelector(${quote(recoveryRoot + ' [data-recovery-action="apply"]')})?.textContent==='Restore workspace'`,
    ));
    await click(recoveryRoot + ' [data-recovery-action="apply"]');
    await wait("The original workroom identity is restored", async () => {
      const state=await desktop();
      return state.workspaces.some(item=>item.id===workroom.id) &&
        await js(`document.querySelector(${quote(recoveryRoot)})?.dataset.state==='applied'`);
    });
    await click(recoveryRoot + ' [data-recovery-action="close"]');
    const restoredWorkroom = await rpc("library", { name: "inspectWorkspace", input: { workspaceId: workroom.id } });
    assert.deepEqual(restoredWorkroom.result.blocks, recoveryLayout.result.blocks, "creation_restore_changed_saved_placements");
    assert.deepEqual((await rpc("snapshot", {})).graph, recoveryGraph, "creation_restore_changed_conversation_history");
    const recoveryEvents=(await rpc("replay", {after:0,limit:1000})).events.filter(event=>event.payload.workspaceRecovery?.workspaceId===workroom.id);
    assert.deepEqual(recoveryEvents.map(event=>event.type), ["workspace.creation-undone","workspace.creation-restored"]);
    assert(recoveryEvents.every(event=>event.classification==="observed"));
    receipt.workroom.creationRecovery={workspaceId:workroom.id,placementIds:restoredWorkroom.result.blocks.map(block=>block.blockId),
      eventIds:recoveryEvents.map(event=>event.eventId),historyPreserved:true};

    const optimizeTitle = "Synthetic layout optimization room";
    await appCommand({ type: "createWorkspace", title: optimizeTitle, projectId: null });
    const optimizeWorkspace = await wait("Layout optimization workspace is active", async () => {
      const state = await desktop();
      return state.workspaces.find(item => item.title === optimizeTitle && item.id === state.activeWorkspaceId);
    });
    for (const title of ["Synthetic movable note", "Synthetic fixed note"])
      await appCommand({ type: "createResource", kind: "note", title, workspaceId: optimizeWorkspace.id });
    const layout = () => rpc("library", { name: "inspectWorkspace", input: { workspaceId: optimizeWorkspace.id } }).then(result => result.result);
    const roomState = await desktop(), note = roomState.resources.find(resource => resource.title === "Synthetic movable note");
    const selected = roomState.blocks.find(block => block.resource_id === note.id && block.workspace_id === optimizeWorkspace.id);
    await appCommand({ type: "geometry", blockId: selected.id, expectedVersion: selected.version,
      placement: { x: -3200, y: selected.y, width: selected.width, height: selected.height, z: selected.z },
      shape: selected.shape, rotation: selected.rotation ?? 0 });
    await appCommand({ type: "setViewport", workspaceId: optimizeWorkspace.id, viewport: { x: 0, y: 0, zoom: 0.9 } });
    const geometry = plan => [plan.presence, ...plan.blocks].map(({ blockId, x, y, width, height, rotation }) => [blockId, x, y, width, height, rotation]);
    const before = await layout();
    const priorPosition = before.blocks.find(card => card.blockId === selected.id);
    assert(priorPosition.x < selected.x, "optimization_fixture_was_not_moved_left");
    const matchesPrior = card => card.x === priorPosition.x && card.y === priorPosition.y;
    await click('.aw-workspace-layout button[aria-label="Workspace actions"]');
    const control = name => '.aw-workspace-actions [data-action=' + quote(name) + ']';
    await click(control("optimize-toggle"));
    await click('.aw-workspace-actions [data-optimize-block=' + quote(selected.id) + ']');
    await click(control("optimize-preview"));
    await wait("Review displays the selected card and enables Apply", () => js(`(() => {
      const control = document.querySelector(${quote(control("optimize-apply"))});
      return control && !control.disabled && !!document.querySelector(${quote('[data-optimize-review-block=' + quote(selected.id) + ']')});
    })()`));
    assert.deepEqual(geometry(await layout()), geometry(before), "optimization_preview_changed_geometry");
    await click(control("optimize-apply"));
    const applied = await wait("Reviewed optimization moved the selected card", async () => {
      const state = await layout();
      return state.revision > before.revision && !matchesPrior(state.blocks.find(card => card.blockId === selected.id)) && state;
    });
    assert.deepEqual(geometry(applied).filter(card => card[0] !== selected.id), geometry(before).filter(card => card[0] !== selected.id));
    assert.deepEqual(applied.viewport, before.viewport);
    await click(control("history-toggle"));
    await fill(control("layout-name"), "Reviewed card arrangement");
    await click(control("save-named-layout"));
    const savedLayout = await wait("Named layout is available after saving", async () =>
      (await desktop()).savedLayouts?.find(item => item.name === "Reviewed card arrangement"));
    await click(control("undo"));
    const undone = await wait("Undo restored the manually positioned card", async () => {
      const state = await layout();
      return state.revision > applied.revision && matchesPrior(state.blocks.find(card => card.blockId === selected.id)) && state;
    });
    assert.deepEqual(geometry(undone), geometry(before));
    await click(control("saved-layout-select"));
    key("Down");
    key("Return");
    await wait("The saved arrangement is selected", () => js(
      `document.querySelector(${quote(control("saved-layout-select"))})?.value === ${quote(savedLayout.id)}`,
    ));
    await click(control("review-named-layout"));
    assert.deepEqual(geometry(await layout()), geometry(before), "named_layout_review_changed_geometry");
    await click(control("restore-named-layout"));
    const restored = await wait("Named layout restores the saved card arrangement", async () => {
      const state = await layout();
      return state.revision > undone.revision && !matchesPrior(state.blocks.find(card => card.blockId === selected.id)) && state;
    });
    assert.deepEqual(geometry(restored), geometry(applied));
    assert.deepEqual(restored.viewport, applied.viewport);
    await click(control("undo"));
    await wait("Undo restores the layout from before the named restore", async () => {
      const state = await layout();
      return state.revision > restored.revision && matchesPrior(state.blocks.find(card => card.blockId === selected.id));
    });
    receipt.namedLayout = { name: savedLayout.name, id: savedLayout.id, revision: restored.revision, undoRestored: true };
    receipt.optimization = { selectedId: selected.id, revisions: [before.revision, applied.revision, undone.revision], undoRestored: true };

    if (!await js(`document.querySelector(${quote(composer)})?.getClientRects().length > 0`)) await click("#vela");
    const historyControl = SURFACE + ' button[aria-label="History"]';
    if (await js(`document.querySelector(${quote(historyControl)})?.getAttribute('aria-expanded') === 'true'`)) await click(historyControl);
    await fillNative({ click, key, js, wait, insertText: text => operation(() => win.webContents.insertText(text), "mission_text_input_deadline") }, composer, "Measure CPU and RAM");
    await click(SURFACE + ' button[aria-label="Send to Vela"]');
    await click(PREVIEW + ' [data-mission-focus="start-mission"]');
    const answerMessage = await wait("CPU and RAM report appears automatically in Vela chat", async () => {
      const state = await rpc("vela", { name: "state", input: {} });
      return state.conversation?.messages.find(message => message.missionReport?.jobsDone === 2);
    });
    const reply = SURFACE + ' [data-current-message-id=' + quote(answerMessage.id) + ']';
    const pill = await wait("Vela shows the reply and a scoped job count with its plan closed", () => js(`(() => {
      const node = document.querySelector(${quote(reply)});
      const surface = document.querySelector(${quote(SURFACE)});
      return node?.getClientRects().length && node.closest('.vela-core')?.dataset.context === 'none' &&
        surface?.getBoundingClientRect().height < 350 && node.querySelector('.vela-mission-jobs-done')?.textContent;
    })()`));
    assert.equal(pill, "2 jobs done");
    await capture("05-compact-measurement-reply");
    await click(reply + ' ' + reportIcon(answerMessage.missionReport.missionId));
    await wait("Plan icon opens the mission with the workspace option", () => js(
      `document.querySelector(${quote(RECORD + ' [data-mission-focus="preview-workroom"]')})?.getClientRects().length > 0`,
    ));
    const measured = await wait("Vela displays the actual CPU and RAM answer", () => js(`(() => {
      const answer = document.querySelector(${quote(RECORD + '[data-mission-outcome="verified"] [data-mission-answer]')});
      return answer?.getClientRects().length && {
        id: answer.dataset.missionAnswer, text: Array.from(answer.querySelectorAll('p'), node => node.textContent)
      };
    })()`));
    assert.match(measured.text[0], /^CPU [\d.]+% \(\d+ ms sample\)\.$/u);
    assert.match(measured.text[1], /^RAM [\d.]+% \([\d.]+\/[\d.]+ GiB used, [\d.]+ GiB available\)\.$/u);
    const measurementMission = await read(measured.id);
    assert.deepEqual(measured.text, measurementMission.answer);
    assert.equal(answerMessage.content, measured.text.join("\n"));
    await click(SURFACE + ' button[aria-label="Close Vela controls"]');
    await wait("The normal Vela reply shows the measured values", () => js(`(() => {
      const node = document.querySelector(${quote(reply)});
      return node?.getClientRects().length && ${quote(measured.text)}.every(line => node.textContent.includes(line));
    })()`));
    await click("#application-stream");
    const stream = '[data-surface-id="intelligence-stream"]';
    const eventRows = stream + ' [data-stream-mission-id=' + quote(measured.id) + ']';
    const shown = await wait("Intelligence Stream displays observed CPU and RAM attempt events", () => js(`(() => {
      const rows = [...document.querySelectorAll(${quote(eventRows)})].filter(row => row.getClientRects().length);
      const found = rows.map(row => ({ kind:row.dataset.streamMissionEvent, task:row.dataset.streamTaskId, status:row.dataset.eventStatus, label:row.textContent }));
      return ['cpu','ram'].every(task => found.some(row => row.task === task && row.kind === 'started' && row.status === 'running') &&
        found.some(row => row.task === task && row.kind === 'settled' && row.status === 'verified')) && found;
    })()`));
    assert(shown.some(row => row.task === "cpu" && row.label.includes("CPU utilization")));
    assert(shown.some(row => row.task === "ram" && row.label.includes("RAM utilization")));
    receipt.measurementAnswer = { missionId: measured.id, lines: measured.text, messageId: answerMessage.id, pill, streamEvents: shown };

    const revisionObjective = "Measure RAM and CPU";
    const revisionPreview = await rpc("missions", { name: "preview", input: { objective: revisionObjective } });
    const revisionMission = await rpc("missions", { name: "start", input: {
      objective: revisionObjective, fingerprint: revisionPreview.fingerprint, requestId: randomUUID(),
    } });
    const controlMission = (mission, type) => rpc("missions", { name: "control", input: {
      id: mission.id, revision: mission.revision, control: { type },
    } });
    let pausing = revisionMission;
    for (let attempt = 0; attempt < 6; attempt++) {
      try { pausing = await controlMission(pausing, "pause"); break; }
      catch (error) {
        if (!String(error.message).includes("mission_revision_changed")) throw error;
        pausing = await read(revisionMission.id);
      }
    }
    await wait("Paused mission is idle and its report remains queued", async () => {
      const mission = await read(revisionMission.id);
      return mission.outcome === "paused" && mission.tasks.find(task => task.id === "report")?.state === "queued";
    });
    await click("#application-stream");
    await wait("Intelligence Stream closes before returning to Vela", () => js(`!document.querySelector(${quote(stream)})`));
    if (await js(`document.querySelector('#vela')?.getAttribute('aria-expanded') !== 'true'`)) await click("#vela");
    await click(SURFACE + ' button[aria-label="Missions"]');
    await click(missionControl(revisionMission.id));
    await click(missionControl("report-revision"));
    await click(missionControl("report-revision-preview"));
    await click(missionControl("revision-apply"));
    const amended = await wait("Reviewed replacement commits and keeps the original report record", async () => {
      const mission = await read(revisionMission.id);
      return mission.planRevision === 2 && mission.retiredTasks?.some(task => task.id === "report") && mission;
    });
    assert.equal(amended.outcome, "paused");
    await click(missionControl("pause-resume"));
    const revisedResult = await wait("The replacement report verifies after Resume", async () => {
      const mission = await read(revisionMission.id);
      return mission.outcome === "verified" && mission;
    });
    const replacement = revisedResult.tasks.find(task => task.executor === "join.samples");
    assert(replacement.id.startsWith("replacement-") && replacement.state === "verified");
    receipt.reviewedRevision = { missionId: revisedResult.id, retiredTaskId: "report", replacementTaskId: replacement.id, planRevision: revisedResult.planRevision };

    await click("#workspace-manager");
    const environmentAction = name => '.en-navigator [data-action=' + quote(name) + ']';
    await click(environmentAction("toggle-create"));
    await click(environmentAction("create-workspace"));
    await click(environmentAction("workspace-vela"));
    const architect = '[data-surface-id="workspace-templates"]';
    const purpose = architect + " [data-workspace-purpose]";
    await wait("Ask Vela opens Workspace Architect", () => js(`document.querySelector(${quote(purpose)})?.getClientRects().length > 0`));
    const roomsBeforePlanning = (await desktop()).workspaces.length;
    const engineeringTitle = "Synthetic engineering mission workspace";
    const engineeringPurpose = 'Create a software engineering workspace called "' + engineeringTitle +
      '" with checklist, local chat and the existing note "Synthetic fixed note".';
    await fillNative({ click, key, js, wait, insertText: text => operation(() => win.webContents.insertText(text), "mission_text_input_deadline") }, purpose, engineeringPurpose);
    const proposalAction = name => architect + " [data-workspace-proposal-action=" + quote(name) + "]";
    await click(proposalAction("request"));
    await wait("Engineering workspace proposal shows an existing resource binding", () => js(
      `document.querySelector(${quote(architect)})?.textContent.includes('Reuse existing') && document.querySelector(${quote(proposalAction("save"))})?.getClientRects().length > 0`,
    ));
    assert.equal((await desktop()).workspaces.length, roomsBeforePlanning);
    await click(proposalAction("save"));
    await click(proposalAction("check"));
    await wait("Workspace preview checks current resource versions", () => js(`document.querySelector(${quote(architect)})?.textContent.includes('placements in a new')`));
    assert.equal((await desktop()).workspaces.length, roomsBeforePlanning);
    await click(proposalAction("apply"));
    const engineering = await wait("Workspace Architect applied canonical resources", async () => {
      const state = await desktop();
      const room = state.workspaces.find(item => item.title === engineeringTitle);
      return room && state.activeWorkspaceId === room.id && {
        id: room.id, resources: state.blocks.filter(block => block.workspace_id === room.id).map(block => {
          const resource = state.resources.find(item => item.id === block.resource_id);
          return resource && { id: resource.id, kind: resource.kind, title: resource.title };
        }).filter(Boolean),
      };
    });
    const fixedNote = roomState.resources.find(resource => resource.title === "Synthetic fixed note");
    assert(engineering.resources.some(resource => resource.id === fixedNote.id && resource.kind === "note"));
    assert(engineering.resources.some(resource => resource.kind === "checklist"));
    assert(engineering.resources.some(resource => resource.kind === "conversation"));
    assert.deepEqual(geometry(await layout()), geometry(undone), "workspace_architect_changed_original_layout");
    receipt.architect = { workspaceId: engineering.id, reusedResourceId: fixedNote.id, kinds: engineering.resources.map(resource => resource.kind) };

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
    if((argv.includes('--missions-weather-product-only')||argv.includes('--missions-folders-only'))&&owned&&admitted&&!win.isDestroyed()&&receipt.captures.length<3){
      try{const image=await bounded(win.webContents.capturePage(),1000,'weather_owned_failure_capture_deadline'),png=image.toPNG();assert(png.length>0&&png.length<=8*MiB,'weather_failure_capture_bound');await fs.writeFile(path.join(out,'failure-owned-application.png'),png,{flag:'wx'});receipt.captures.push({file:'failure-owned-application.png',bytes:png.length});}catch{receipt.failureCapture='unavailable within owned window/deadline';}
    }
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
