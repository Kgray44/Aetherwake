import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const { velaCommand, isVelaRead, prepareVelaInitiatedAnalysis } = createRequire(import.meta.url)(
  "../native/vela-broker.cjs",
);
const { reviewPage } = createRequire(import.meta.url)("../native/vela-review.cjs");

test("selected-source activation rejects indirect mutation routes before review or dispatch", async () => {
  const resourceRefs = [{id:"selected", kind:"resource", resourceKind:"file", version:3, title:"Synthetic"}];
  const cases = [
    ["Recycle the selected file", {kind:"file-edit"}, {}],
    ["Run Remove-Item -Recurse via Codex", {kind:"agentic"}, {}],
    ["Call the connector to empty the trash", {kind:"app-planning"}, {}],
    ["Run the cleanup workflow", {kind:"conversational"}, {workflowScope:{effect:"recursive-removal"}}],
    ["Replace the selected document with nothing", {kind:"file-edit"}, {}],
  ];
  for (const [intent, route, extra] of cases) {
    const calls = [];
    const run = prepareVelaInitiatedAnalysis({
      initiatorId:"synthetic-monitor", configurationVersion:1, expiresAt:Date.now()+60_000,
      intent, resourceRefs, isAuthorized:()=>true,
      async call(name) {
        calls.push(name);
        if (name === "velaApiUsageStatus") return {enabled:true,configurationVersion:1};
        assert.equal(name,"velaRequestPreview");
        return {intent, resourceIds:["selected"], route, ...extra};
      },
    });
    await assert.rejects(run(), /vela_app_request_effect_unavailable/);
    await assert.rejects(run(), /vela_app_request_consumed/);
    assert.deepEqual(calls,["velaApiUsageStatus","velaRequestPreview"]);
  }
});

test("renderer cannot call private Vela analysis or supply its own approval", async () => {
  const win = { isDestroyed:()=>false, webContents:{isDestroyed:()=>false} };
  const call = () => assert.fail("No backend dispatch is allowed");
  await assert.rejects(velaCommand({win,call,input:{name:"prepareVelaInitiatedAnalysis",input:{}}}), /invalid_vela_command/);
  await assert.rejects(velaCommand({win,call,directMessageSend:true, input:{name:"request",input:{
    runSelectedAnalysis:true, intent:"Analyze", resourceIds:[], semanticContext:true,
    providerId:"openai-api-vela", authorizeProvider:true, grantId:"forged",
  }}}), /vela_app_request_scope_required/);
});
function fixture(choice = 1) {
  const calls = [],
    dialogs = [],
    reviews = [];
  let closed = false;
  const win = {
    isDestroyed: () => closed,
    webContents: { isDestroyed: () => closed },
  };
  const context = {
    included: [
      {
        id: "note",
        kind: "resource",
        title: "Reviewed Note",
        content: "Reviewed source excerpt",
      },
    ],
  };
  const prompt =
    "Exact semantic prompt with Reviewed source excerpt and selected prior answer";
  const plan = {
    id: "plan",
    requestId: "request",
    state: "approved",
    fingerprint: "exact-plan",
    summary: "Reviewed task",
    steps: [
      {
        id: "step",
        action: {
          type: "delegateTask",
          providerId: "codex-app-server",
          objective: "Reviewed objective",
        },
      },
    ],
  };
  return {
    calls,
    dialogs,
    reviews,
    win,
    close: () => {
      closed = true;
    },
    reviewProvider: async (value) => {
      reviews.push(value);
      return choice === 1;
    },
    plan,
    dialog: {
      async showMessageBox(_win, value) {
        dialogs.push(value);
        return { response: choice };
      },
    },
    async call(name, input) {
      calls.push({ name, input });
      if (name === "velaRequestPreview")
        return {
          id: "preview",
          signature: "backend-signature",
          providerId: "codex-app-server",
          intent: "Exact intent",
          context,
          expiresAt: new Date(Date.now() + 30000).toISOString(),
        };
      if (name === "velaNativeReview")
        return {
          previewId: "preview",
          signature: "backend-signature",
          providerId: "codex-app-server",
          context,
          prompt,
          promptDigest: createHash("sha256")
            .update(JSON.stringify(prompt))
            .digest("hex"),
          reviewDigest: "a".repeat(64),
          history: {
            messages: [
              {
                role: "assistant",
                providerId: "codex-app-server",
                content: "Selected prior answer",
              },
            ],
          },
          historyOmissions: [],
        };
      if (name === "authorizeVelaRequest")
        return { grantId: "private-native-grant" };
      if (name === "vela" && input.name === "state")
        return {
          plans: [plan],
          requests: [
            {
              id: "request",
              context: { included: ["Reviewed source excerpt"] },
            },
          ],
        };
      return { id: "result" };
    },
  };
}
const request = (authorizeProvider) => ({
  name: "request",
  input: {
    intent: "Exact intent",
    resourceIds: ["note"],
    authorizeProvider,
    previewId: "forged",
    grantId: "forged",
  },
});
test("ordinary Vela Send uses the connected ChatGPT plan without opening a second dialog", async () => {
  const f = fixture();
  const input = request(true);
  input.input.resourceIds = [];
  await velaCommand({
    ...f,
    input,
    offerPlanningByDefault: true,
    directMessageSend: true,
    async call(name, data) {
      if (name === "velaRouteNative") return { matched: false };
      assert(!["capabilities", "ordinaryProviderStatus"].includes(name));
      const result = await f.call(name, data);
      if (name === "velaRequestPreview") {
        assert.equal(data.adaptive, true);
        assert.equal(data.providerId, undefined);
        return { ...result, providerId: "chatgpt-plan-responses", resourceIds: [], route: { kind: "conversational" }, sendDisposition: "routine" };
      }
      if (name === "velaNativeReview") {
        const prompt = "Exact intent and workspace labels";
        return { ...result, providerId: "chatgpt-plan-responses", route: { kind: "conversational" }, context: { included: [] },
          history: { messages: [{ role: "user", content: "Previous canonical question" }, { role: "assistant", content: "Previous canonical answer" }] },
          prompt, promptDigest: createHash("sha256").update(JSON.stringify(prompt)).digest("hex") };
      }
      if (name === "authorizeVelaRequest") assert.equal(data.directSend, true);
      return result;
    },
  });
  assert.equal(f.reviews.length, 0);
  assert.equal(f.calls.at(-1).input.input.grantId, "private-native-grant");
});

test('project document discovery uses only the owned native folder choice and never opens a provider request',async()=>{
  const f=fixture(),input=request(true),calls=[];input.input.intent='Can you add the "Synthetic Library" project docs to this workspace?';input.input.resourceIds=[];input.input.selectedDirectory='C:\\FORGED_RENDERER_PATH';
  const prepared={id:'canonical-question',nativeResponse:{schemaVersion:1,classification:'observed'}};
  const result=await velaCommand({...f,input,directMessageSend:true,routeNative:true,
    dialog:{showOpenDialog:async()=>({canceled:false,filePaths:['C:\\OWNED_NATIVE_SELECTION']})},
    call:async(name,value)=>{calls.push({name,value});if(name==='velaRouteNative')return {matched:false,fileDiscovery:{projectName:'Synthetic Library'}};
      assert.equal(name,'velaFileProposalPrepareNative');assert.deepEqual(value,{intent:input.input.intent,selectedDirectory:'C:\\OWNED_NATIVE_SELECTION'});return prepared;}});
  assert.equal(result,prepared);assert.deepEqual(calls.map(call=>call.name),['velaRouteNative','velaFileProposalPrepareNative']);assert.equal(f.reviews.length,0);
});

test('explicit document requests pass selected canonical folder IDs to Core without selecting another root or probing a provider',async()=>{
  const f=fixture(),input=request(true),calls=[];input.input.intent='Add project docs to this workspace';input.input.resourceIds=['canonical-folder'];const prepared={id:'bound-folder-question'};
  const result=await velaCommand({...f,input,directMessageSend:true,routeNative:true,dialog:{showOpenDialog:async()=>assert.fail('The connected folder already grants root metadata access')},
    call:async(name,value)=>{calls.push({name,value});assert.equal(name,'velaRouteNative');assert.deepEqual(value.resourceIds,['canonical-folder']);return {matched:true,request:prepared};}});
  assert.equal(result,prepared);assert.equal(calls.length,1);assert.equal(f.reviews.length,0);
});

test('selected source Add and selected-folder listing forward exact ref versions directly to native Core without provider or picker review',async()=>{
  for(const intent of ['Add this folder to this workspace','What files are in this folder?']){const f=fixture(),input=request(true),ref={id:'canonical-folder',kind:'resource',resourceKind:'folder',title:'Selected folder',version:7,projectId:null},calls=[];input.input.intent=intent;input.input.resourceIds=[ref.id];input.input.resourceRefs=[ref];
    await velaCommand({...f,input,directMessageSend:true,routeNative:true,dialog:{showOpenDialog:async()=>assert.fail('Already selected source must not be rediscovered')},call:async(name,value)=>{calls.push({name,value});assert.equal(name,'velaRouteNative');assert.deepEqual(value.resourceRefs,[ref]);return {matched:true,request:{id:'native-observed'}};}});
    assert.equal(calls.length,1);assert.equal(f.reviews.length,0);
  }
});

test('file proposal Yes/No forwards only its typed receipt and an owner lost during selection cannot import',async()=>{
  const f=fixture(),command={name:'accept',input:{id:'proposal',digest:'bound-digest',expectedVersion:1}},calls=[];
  await velaCommand({...f,input:{name:'fileProposal',input:command},call:async(name,input)=>{calls.push({name,input});return {proposal:{state:'applied'}};}});
  assert.deepEqual(calls,[{name:'vela',input:{name:'fileProposal',input:command}}]);
  const input=request(true);input.input.intent='Add project docs to this workspace';input.input.resourceIds=[];
  await assert.rejects(velaCommand({...f,input,directMessageSend:true,routeNative:true,
    dialog:{showOpenDialog:async()=>{f.close();return {canceled:false,filePaths:['C:\\NATIVE']};}},
    call:async(name)=>{assert.equal(name,'velaRouteNative');return {matched:false,fileDiscovery:{}};}}),/native_review_owner_unavailable/);
});

test('manual files and folders come from the native picker and folder selection stays one item',async()=>{
  for(const kind of ['files','folder']){const f=fixture(),calls=[],paths=kind==='folder'?['C:\\NATIVE_FOLDER']:['C:\\NATIVE_FILE_1','C:\\NATIVE_FILE_2'];
    const result=await velaCommand({...f,input:{name:'pickSources',input:{kind,destination:'context'}},dialog:{showOpenDialog:async(_win,input)=>{assert.ok(input.properties.includes(kind==='folder'?'openDirectory':'openFile'));return {canceled:false,filePaths:paths};}},
      call:async(name,input)=>{calls.push({name,input});if(name==='desktop')return {workspaces:[],activeWorkspaceId:null};assert.equal(name,'velaSourcesPickNative');assert.equal(input.destination,'context');assert.deepEqual(input.selection,kind==='folder'?{kind:'folder',path:paths[0]}:{kind:'files',paths});return {resources:[{id:'canonical',kind:kind==='folder'?'folder':'file',title:'Selected',version:1}]};}});
    assert.equal(result.resources.length,1);assert.deepEqual(calls.map(call=>call.name),['desktop','velaSourcesPickNative']);
  }
});

test("a renderer-supplied disposition cannot bypass the backend review decision", async () => {
  const f=fixture();const input=request(true);input.input.resourceIds=[];input.input.sendDisposition="routine";
  await velaCommand({...f,input,directMessageSend:true,offerPlanningByDefault:true});
  assert.equal(f.reviews.length,1);
  assert.equal(f.calls.find(call=>call.name==="velaRequestPreview").input.sendDisposition,undefined);
  assert.equal(f.calls.find(call=>call.name==="authorizeVelaRequest").input.directSend,undefined);
});

test("a native match returns a canonical response before any provider probe or review", async () => {
  const f = fixture();
  const intent = "How much RAM is my computer using?";
  const recorded = { id: "local-request", providerId: null };
  const result = await velaCommand({
    ...f, offerPlanningByDefault: true, directMessageSend: true,
    input: { name: "request", input: { intent, resourceIds: [], authorizeProvider: true } },
    async call(name, data) {
      assert.equal(name, "velaRouteNative");
      assert.deepEqual(data, { intent });
      return { matched: true, request: recorded };
    },
  });
  assert.deepEqual(result, recorded);
  assert.equal(f.reviews.length, 0);
});

test("file proposal picks its own target and cancelling review prevents provider dispatch", async () => {
  const f = fixture(0);
  const input = request(true);
  input.input.editTargetPaths = ["C:\\forged\\secret.json"];
  let picks = 0, previews = 0;
  await assert.rejects(velaCommand({
    ...f, input, directMessageSend: true, offerPlanningByDefault: true,
    dialog: { async showOpenDialog(_win, options) {
      picks++;
      assert(options.properties.includes("multiSelections"));
      return { canceled: false, filePaths: ["C:\\chosen\\sample.json", "C:\\chosen\\second.json"] };
    } },
    async call(name, data) {
      if (name === "velaRequestPreview") {
        if (++previews === 1) {
          assert.equal(data.editTargetPaths, undefined);
          throw Error("vela_codex_edit_target_required");
        }
        assert.deepEqual(data.editTargetPaths, ["C:\\chosen\\sample.json", "C:\\chosen\\second.json"]);
      }
      const result = await f.call(name, data);
      return ["velaRequestPreview", "velaNativeReview"].includes(name)
        ? { ...result, route: { kind: "file-edit" } } : result;
    },
  }), /authorization_cancelled/);
  assert.equal(picks, 1);
  assert.equal(f.reviews.length, 1);
  assert.deepEqual(f.calls.map(call => call.name), ["velaRequestPreview", "velaNativeReview"]);
});

test("new-file proposal uses only the native Save dialog destination", async () => {
  const f = fixture(0);
  const input = request(true);
  input.input.intent = "Create created.json";
  input.input.editCreatePaths = ["C:\\forged\\secret.json"];
  for (const canceled of [true, false]) {
    let previews = 0, saves = 0;
    await assert.rejects(velaCommand({
      ...f, input, directMessageSend: true, offerPlanningByDefault: true,
      dialog: { async showSaveDialog(parent, options) {
        assert.equal(parent, f.win);
        assert.equal(options.buttonLabel, "Select destination");
        saves++;
        return canceled ? { canceled } : { canceled, filePath: "C:\\chosen\\created.json" };
      } },
      async call(name, data) {
        if (name === "velaRequestPreview") {
          if (++previews === 1) {
            assert.equal(data.editCreatePaths, undefined);
            throw Error("vela_codex_create_target_required");
          }
          assert.deepEqual(data.editCreatePaths, ["C:\\chosen\\created.json"]);
          assert.equal(data.editTargetPaths, undefined);
        }
        const result = await f.call(name, data);
        return ["velaRequestPreview", "velaNativeReview"].includes(name)
          ? { ...result, route: { kind: "file-edit" } } : result;
      },
    }), /authorization_cancelled/);
    assert.equal(previews, canceled ? 1 : 2);
    assert.equal(saves, 1);
  }
  assert.equal(f.reviews.length, 1);
});

test("file replacement validates native review bytes and never forwards a renderer review token", async () => {
  const f = fixture();
  const requestId = "11111111-1111-4111-8111-111111111111";
  const before = "old", after = "new";
  const sha = text => createHash("sha256").update(text).digest("hex");
  const files = ["sample.txt", "second.txt"].map(file => ({
    path: "C:\\chosen\\" + file, before, after, beforeDigest: sha(before), afterDigest: sha(after),
  }));
  const review = { requestId, reviewId: "22222222-2222-4222-8222-222222222222",
    expiresAt: new Date(Date.now() + 60000).toISOString(), files };
  const input = { name: "applyFileEdit", input: { requestId, reviewId: "forged", replacement: "forged" } };
  for (const valid of [false, true]) {
    const seen = [];
    const running = velaCommand({
      ...f, input,
      async call(name, data) {
        seen.push({ name, data });
        return name === "velaFileEditReview" ? (valid ? review : { ...review, files: [files[0], { ...files[1], after: "tampered" }] }) : { state: "applied" };
      },
    });
    if (valid) {
      assert.deepEqual(await running, { state: "applied" });
      assert.deepEqual(seen.at(-1), { name: "velaFileEditApply", data: { requestId, reviewId: review.reviewId } });
    } else {
      await assert.rejects(running, /invalid_vela_edit_review/);
      assert.equal(seen.length, 1);
    }
  }
  assert.equal(f.reviews.length, 1);
  assert.equal(f.reviews[0].experience, "file-edit");
  const html = reviewPage({ ...review, files: [{ ...files[0], before: "<script>alert(1)</script>\r\n" }, files[1]] }, "", "file-edit");
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /1 CRLF · 0 LF/);
  assert.match(html, /Apply 2 replacements/);
  assert.match(html, /Apply reviewed files/);
  assert.doesNotMatch(html, /<script>/);

  const create = { ...files[0], before: null, beforeDigest: null };
  const createReview = { ...review, files: [create, files[1]] };
  const createHtml = reviewPage(createReview, "", "file-edit");
  assert.match(createHtml, /Apply 2 file changes/);
  assert.match(createHtml, /The destination is absent/);
  assert.match(createHtml, /Proposed new contents/);
  await assert.rejects(velaCommand({
    ...f, input,
    async call(name) {
      assert.equal(name, "velaFileEditReview");
      return { ...createReview, files: [{ ...create, before: "" }] };
    },
  }), /invalid_vela_edit_review/);
  assert.deepEqual(await velaCommand({
    ...f, input,
    async call(name, data) {
      if (name === "velaFileEditReview") return createReview;
      assert.equal(name, "velaFileEditApply");
      assert.equal(data.reviewId, createReview.reviewId);
      return { state: "applied" };
    },
  }), { state: "applied" });
});

test("ordinary Vela Send still requires review when the prompt includes attached sources", async () => {
  const f = fixture(0);
  await assert.rejects(velaCommand({
    ...f, input: request(true), directMessageSend: true,
    async call(name, data) {
      const result = await f.call(name, data);
      return name === "velaRequestPreview" ? { ...result, resourceIds: data.resourceIds } : result;
    },
  }), /authorization_cancelled/);
  assert.equal(f.reviews.length, 1);
  assert.equal(f.calls.at(-1).name, "velaNativeReview");
});

test("project check uses a native test picker and review before dispatching its private token", async () => {
  const f = fixture();
  const requestId = "11111111-1111-4111-8111-111111111111";
  const reviewId = "22222222-2222-4222-8222-222222222222";
  const chosen = "C:\\chosen\\sample.test.mjs";
  const input = { name: "verifyFileEdit", input: {
    requestId, kind: "node-test", paths: ["C:\\forged\\test.mjs"], reviewId: "forged", argv: ["forged"],
  } };
  for (const response of [1, 0]) {
    const seen = [];
    const run = velaCommand({ ...f, input, dialog: {
      async showOpenDialog(parent, options) {
        assert.equal(parent, f.win);
        assert(options.properties.includes("multiSelections"));
        return { canceled: false, filePaths: [chosen] };
      },
      async showMessageBox(parent, options) {
        assert.equal(parent, f.win);
        assert.match(options.detail, /read-only sandbox/);
        assert.match(options.detail, /sample\.test\.mjs/);
        assert.doesNotMatch(options.detail, /forged/);
        assert.equal(options.defaultId, 1);
        return { response };
      },
    }, async call(name, data) {
      seen.push({ name, data });
      if (name === "velaProjectCheckReview") {
        assert.deepEqual(data, { requestId, kind: "node-test", paths: [chosen] });
        return { requestId, reviewId, expiresAt: new Date(Date.now() + 10000).toISOString(), kind: "node-test",
          cwd: "C:\\chosen", argv: ["C:\\node.exe", "--test", "--", "./sample.test.mjs"] };
      }
      assert.equal(name, "velaProjectCheckRun");
      assert.deepEqual(data, { requestId, reviewId });
      return { state: "applied" };
    } });
    if (response === 0) assert.deepEqual(await run, { state: "applied" });
    else await assert.rejects(run, /authorization_cancelled/);
    assert.equal(seen.length, response === 0 ? 2 : 1);
  }
});

test("Fix it and run the tests only when I approve both steps", async () => {
  const f = fixture();
  const requestId = "11111111-1111-4111-8111-111111111111";
  const reviewId = "22222222-2222-4222-8222-222222222222";
  const expiresAt = new Date(Date.now() + 60000).toISOString();
  const path = "C:\\chosen\\sample.test.mjs";
  const after = "test contents";
  const files = [{ path, before: null, beforeDigest: null, after, afterDigest: createHash("sha256").update(after).digest("hex") }];
  for (const [state, response] of [["partial", 0], ["applied", 1], ["applied", 0]]) {
    const seen = [];
    const applied = { requestId, state, followUpCheck: "node-test", projectChecksAvailable: true };
    const passed = { ...applied, projectChecks: [{ kind: "node-test", state: "passed" }] };
    const actual = await velaCommand({ ...f, input: { name: "applyFileEdit", input: { requestId, kind: "typescript" } },
      dialog: {
        async showOpenDialog() { seen.push("pick"); return { canceled: false, filePaths: [path] }; },
        async showMessageBox() { seen.push("approve check"); return { response }; },
      },
      async reviewProvider() { seen.push("approve edit"); return true; },
      async call(name, data) {
        seen.push(name);
        if (name === "velaFileEditReview") return { requestId, reviewId, expiresAt, files };
        if (name === "velaFileEditApply") return applied;
        if (name === "velaProjectCheckReview") {
          assert.deepEqual(data, { requestId, kind: "node-test", paths: [path] });
          return { requestId, reviewId, expiresAt, kind: "node-test", cwd: "C:\\chosen", argv: ["C:\\node.exe", "--test", path] };
        }
        assert.equal(name, "velaProjectCheckRun");
        return passed;
      },
    });
    const expected = ["velaFileEditReview", "approve edit", "velaFileEditApply"];
    if (state === "applied") expected.push("pick", "velaProjectCheckReview", "approve check");
    if (state === "applied" && response === 0) expected.push("velaProjectCheckRun");
    assert.deepEqual(seen, expected);
    assert.equal(actual, expected.at(-1) === "velaProjectCheckRun" ? passed : applied);
  }
});

test("Build this project and let me review the output before saving it", async () => {
  const f = fixture();
  const intent = "Build this project", script = "C:\\chosen\\sample.build.mjs", output = "C:\\chosen\\generated.json";
  const reviewId = "22222222-2222-4222-8222-222222222222";
  const calls = [];
  const actual = await velaCommand({ ...f, directMessageSend: true,
    input: { name: "request", input: { intent, resourceIds: [], authorizeProvider: true, artifactPath: "C:\\forged.json" } },
    dialog: {
      async showOpenDialog() { return { canceled: false, filePaths: [script] }; },
      async showSaveDialog() { return { canceled: false, filePath: output }; },
      async showMessageBox(parent, options) {
        assert.equal(parent, f.win);
        assert(options.detail.includes(output));
        assert.match(options.detail, /requires a separate review/u);
        return { response: 0 };
      },
    }, async call(name, data) {
      calls.push(name);
      if (name === "velaRouteNative") return { matched: false, projectCheck: "node-build" };
      if (name === "velaStandaloneCheckReview") {
        assert.deepEqual(data, { intent, paths: [script], artifactPath: output });
        return { requestId: null, reviewId, expiresAt: new Date(Date.now() + 10000).toISOString(), kind: "node-build",
          cwd: "C:\\chosen", argv: ["C:\\node.exe", "--", script], artifactPath: output };
      }
      assert.equal(name, "velaStandaloneCheckRun");
      assert.deepEqual(data, { reviewId });
      return { state: "responded" };
    },
  });
  assert.equal(actual.state, "responded");
  assert.deepEqual(calls, ["velaRouteNative", "velaStandaloneCheckReview", "velaStandaloneCheckRun"]);
});

test("standalone project check uses Send and a native review without a model preview", async () => {
  const f = fixture();
  const reviewId = "22222222-2222-4222-8222-222222222222";
  const intent = "Type-check this project";
  const chosen = "C:\\chosen\\tsconfig.json";
  const input = { name: "request", input: {
    intent, resourceIds: [], authorizeProvider: true, mode: "codex", budgetLimit: 0,
    paths: ["C:\\forged\\tsconfig.json"], reviewId: "forged",
  } };
  for (const response of [1, 0]) {
    const seen = [];
    const run = velaCommand({ ...f, input, directMessageSend: true, offerPlanningByDefault: true, dialog: {
      async showOpenDialog(parent, options) {
        assert.equal(parent, f.win);
        assert.equal(options.properties.includes("multiSelections"), false);
        return { canceled: false, filePaths: [chosen] };
      },
      async showMessageBox(parent, options) {
        assert.equal(parent, f.win);
        assert.match(options.message, /Type-check/);
        assert.match(options.detail, /tsconfig\.json/);
        return { response };
      },
    }, async call(name, data) {
      seen.push(name);
      const settings = { mode: "codex", budgetLimit: 0 };
      if (name === "velaRouteNative") {
        assert.deepEqual(data, { intent, settings });
        return { matched: false, projectCheck: "typescript" };
      }
      if (name === "velaStandaloneCheckReview") {
        assert.deepEqual(data, { intent, settings, paths: [chosen] });
        return { requestId: null, reviewId, expiresAt: new Date(Date.now() + 10000).toISOString(), kind: "typescript",
          cwd: "C:\\chosen", argv: ["C:\\node.exe", "./node_modules/typescript/lib/tsc.js", "--noEmit", "--project", "./tsconfig.json"] };
      }
      assert.equal(name, "velaStandaloneCheckRun");
      assert.deepEqual(data, { reviewId });
      return { id: "standalone-check", state: "responded" };
    } });
    if (response === 0) assert.deepEqual(await run, { id: "standalone-check", state: "responded" });
    else await assert.rejects(run, /authorization_cancelled/);
    assert.deepEqual(seen, ["velaRouteNative", "velaStandaloneCheckReview", ...(response === 0 ? ["velaStandaloneCheckRun"] : [])]);
  }
});

test("ordinary Vela Send discovers the installed provider and opens the exact native review before planning", async () => {
  const f = fixture(0);
  const probes = [];
  await assert.rejects(velaCommand({
    ...f,
    input: request(false),
    offerPlanningByDefault: true,
    call(name, input) {
      if (name === "capabilities") {
        probes.push(name);
        return Promise.resolve({ providerId: "codex-app-server", mock: false, authentication: "available" });
      }
      return f.call(name, input);
    },
  }), /authorization_cancelled/);
  assert.deepEqual(probes, ["capabilities"]);
  assert.deepEqual(f.calls.map(call => call.name), ["velaRequestPreview", "velaNativeReview"]);
  assert.equal(f.reviews.length, 1);
});
test("unapproved Vela requests cannot smuggle renderer grants or contact a provider", async () => {
  const f = fixture();
  await velaCommand({ ...f, input: request(false) });
  assert.equal(f.dialogs.length, 0);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0], {
    name: "vela",
    input: {
      name: "request",
      input: {
        intent: "Exact intent",
        resourceIds: ["note"],
        authorizeProvider: false,
      },
    },
  });
  assert.equal(isVelaRead({ name: "state" }), true);
  assert.equal(isVelaRead({ name: "open" }), false);
  assert.equal(isVelaRead({ name: "local" }), false, "Canonical local replies still require storage admission");
});

test("desktop Vela Send stops before recording a request when the AI could not start", async () => {
  for (const [status, code] of [
    [new Error("missing-executable"), "vela_planner_unavailable"],
    [new Error("execution_busy"), "vela_planner_busy"],
    [{ providerId: "codex-app-server", mock: false, authentication: "required" }, "vela_planner_sign_in_required"],
  ]) {
    const f = fixture();
    await assert.rejects(velaCommand({
      ...f, input: request(false), offerPlanningByDefault: true,
      async call(name, input) {
        if (name !== "capabilities") return f.call(name, input);
        if (status instanceof Error) throw status;
        return status;
      },
    }), { message: code });
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.reviews, []);
  }
});

test("a former clock shortcut uses the same consent and request path as other free text", async () => {
  const f = fixture(), intent = "What time is it?";
  await velaCommand({
    ...f,
    input: { name: "request", input: { intent, resourceIds: [], authorizeProvider: true } },
  });
  assert.equal(f.reviews.length, 1);
  assert.deepEqual(f.calls.map(call => call.name), ["velaRequestPreview", "velaNativeReview", "authorizeVelaRequest", "vela"]);
  assert.equal(f.calls.at(-1).input.input.intent, intent);
  await assert.rejects(velaCommand({ ...f, input: { name: "local", input: { intent } } }), /invalid_vela_command/);
});

test("Vela planning reviews backend context then uses only a newly issued native grant", async () => {
  const f = fixture();
  const input = request(true);
  input.input.activeCard = { workspaceId: "workspace", blockId: "placement" };
  await velaCommand({ ...f, input });
  assert.deepEqual(
    f.calls.map((c) => c.name),
    ["velaRequestPreview", "velaNativeReview", "authorizeVelaRequest", "vela"],
  );
  assert.equal(f.dialogs.length, 0, "no oversized OS text dialog");
  assert.equal(
    f.reviews[0].review.context.included[0].content,
    "Reviewed source excerpt",
  );
  assert.equal(
    f.reviews[0].review.history.messages[0].content,
    "Selected prior answer",
  );
  assert.deepEqual(f.calls[2].input, {
    previewId: "preview",
    signature: "backend-signature",
    reviewDigest: "a".repeat(64),
  });
  assert.equal(f.calls[3].input.input.grantId, "private-native-grant");
  assert.deepEqual(f.calls[0].input.activeCard, input.input.activeCard);
  assert.equal(f.calls[3].input.input.activeCard, undefined, "only the reviewed manifest can carry selection");
});
test("cancelled planning consent never grants or dispatches", async () => {
  const f = fixture(0);
  await assert.rejects(
    velaCommand({ ...f, input: request(true) }),
    /authorization_cancelled/,
  );
  assert.deepEqual(
    f.calls.map((c) => c.name),
    ["velaRequestPreview", "velaNativeReview"],
  );
});
test("revoked or stale planning context fails at native grant creation without dispatch", async () => {
  const f = fixture(),
    original = f.call;
  f.call = async (name, input) => {
    if (name === "authorizeVelaRequest") throw Error("stale_context");
    return original(name, input);
  };
  await assert.rejects(
    velaCommand({ ...f, input: request(true) }),
    /stale_context/,
  );
  assert.equal(
    f.calls.some((c) => c.name === "vela"),
    false,
  );
});
test("delegation receives its own native review bound to canonical plan and step", async () => {
  const f = fixture();
  await velaCommand({ ...f, input: { name: "apply", input: "plan" } });
  assert.equal(f.dialogs.length, 1);
  assert.match(f.dialogs[0].detail, /Reviewed objective/);
  assert.deepEqual(f.calls[1], {
    name: "authorizeVelaDelegation",
    input: { planId: "plan", stepId: "step", fingerprint: "exact-plan" },
  });
  assert.deepEqual(f.calls[2], {
    name: "vela",
    input: { name: "apply", input: "plan" },
  });
});
test("cancelled delegation cannot authorize a task or apply the plan", async () => {
  const f = fixture(0);
  await assert.rejects(
    velaCommand({ ...f, input: { name: "apply", input: "plan" } }),
    /authorization_cancelled/,
  );
  assert.equal(f.calls.length, 1);
});
test("private grants and reflective method names are not renderer commands", async () => {
  for (const name of [
    "authorizeVelaRequest",
    "velaNativeReview",
    "authorizeVelaDelegation",
    "constructor",
    "__proto__",
  ]) {
    const f = fixture();
    await assert.rejects(
      velaCommand({ ...f, input: { name, input: {} } }),
      /invalid_vela_command/,
    );
    assert.equal(f.calls.length, 0);
  }
});

test("native review failures or substituted prompts cannot fall back to legacy consent or dispatch", async () => {
  for (const mismatch of [false, true]) {
    const f = fixture(),
      original = f.call;
    f.call = async (name, input) => {
      if (name !== "velaNativeReview") return original(name, input);
      if (!mismatch) throw Error("native_review_unavailable");
      return {
        ...(await original(name, input)),
        prompt: "Unreviewed replacement",
      };
    };
    await assert.rejects(
      velaCommand({ ...f, input: request(true) }),
      /native_review_unavailable|invalid_native_vela_review/,
    );
    assert.equal(f.dialogs.length, 0);
    assert.equal(f.reviews.length, 0);
    assert(
      !f.calls.some(
        (c) => c.name === "authorizeVelaRequest" || c.name === "vela",
      ),
    );
  }
});

test("closing the owner during review or grant creation cannot dispatch a provider request", async () => {
  for (const closeAt of ["review", "grant"]) {
    const f = fixture(),
      original = f.call;
    if (closeAt === "review")
      f.reviewProvider = async () => {
        f.close();
        return true;
      };
    else
      f.call = async (name, input) => {
        const value = await original(name, input);
        if (name === "authorizeVelaRequest") f.close();
        return value;
      };
    await assert.rejects(
      velaCommand({ ...f, input: request(true) }),
      /native_review_owner_unavailable/,
    );
    assert(!f.calls.some((c) => c.name === "vela"));
  }
});

test("native request failure diagnostics disclose only the failed stage and a safe code before consent", async () => {
  for (const message of [
    "vela_prompt_too_large",
    "Private source body: do not disclose",
  ]) {
    const f = fixture(),
      observations = [], original = f.call;
    f.call = async (name, input) => {
      throw Error(message);
    };
    await assert.rejects(
      velaCommand({
        ...f,
        input: request(true),
        observeNativeRequest: (event) => observations.push(event),
      }),
      (error) => error.message === message,
    );
    assert.deepEqual(observations, [
      { stage: "preview", state: "started" },
      {
        stage: "preview",
        state: "failed",
        code:
          message === "vela_prompt_too_large" ? message : "operation_failed",
      },
    ]);
    assert.equal(f.reviews.length, 0);
    assert(observations.every(Object.isFrozen));
    assert(!JSON.stringify(observations).includes("Private source body"));
  }
});

test("diagnostic callbacks cannot approve, alter or fail the native request", async () => {
  const baseline = fixture(),
    observed = fixture(),
    failingObserver = fixture(),
    events = [];
  await velaCommand({ ...baseline, input: request(true) });
  await velaCommand({
    ...observed,
    input: request(true),
    observeNativeRequest: (event) => {
      events.push(event);
      return false;
    },
  });
  await velaCommand({
    ...failingObserver,
    input: request(true),
    observeNativeRequest: () => {
      throw Error("observer failed");
    },
  });
  assert.deepEqual(
    observed.calls.map((c) => c.name),
    baseline.calls.map((c) => c.name),
  );
  assert.deepEqual(
    failingObserver.calls.map((c) => c.name),
    baseline.calls.map((c) => c.name),
  );
  assert.equal(observed.reviews.length, 1);
  assert.equal(failingObserver.reviews.length, 1);
  assert.deepEqual(
    events.map((e) => [e.stage, e.state]),
    ["preview", "review", "grant", "request"].flatMap((stage) => [
      [stage, "started"],
      [stage, "completed"],
    ]),
  );
  assert(
    events.every((e) =>
      Object.keys(e).every((key) => ["stage", "state", "code"].includes(key)),
    ),
  );
  const local = fixture();
  await velaCommand({
    ...local,
    input: request(false),
    observeNativeRequest: () =>
      assert.fail("Local-only input has no provider stages"),
  });
  assert.equal(local.calls.length, 1);
});
