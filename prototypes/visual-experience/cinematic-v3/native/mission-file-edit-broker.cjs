"use strict";
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const { validateReview, validateFileEditReview, showVelaReview, isReviewOwnerAlive } = require("./vela-review.cjs");

// Main must exclude every one of these names from generic renderer/Core RPC.
// Only this private broker may attest a native decision; IDs confer no authority.
const PRIVATE_MISSION_FILE_EDIT_COMMANDS = Object.freeze([
  "missionFileEditPrepareNative", "missionFileEditRunNative",
  "missionFileEditReviewNative", "missionFileEditChoiceNative", "missionFileEditApplyNative",
  "missionFileEditCheckReviewNative", "missionFileEditCheckRunNative", "missionFileEditRead",
]);
const owners = new WeakSet();
const uuid = value => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(value);
const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const opaque = value => typeof value === "string" && /^[a-z0-9][a-z0-9_.:-]{0,127}$/iu.test(value);
const keys = (value, required, optional = []) => value && typeof value === "object" && !Array.isArray(value) &&
  required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => [...required, ...optional].includes(key));
const text = value => typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\x00-\x1f\x7f]|\p{Bidi_Control}/u.test(value);
const fail = code => { throw Error(code); };
const phases = new Set(["awaiting-native-review", "approved", "applying", "applied", "unchanged", "conflict", "unknown", "cancelled", "compensated"]);
const checks = new Set(["not-run", "awaiting-native-review", "approved", "running", "passed", "failed", "blocked", "unknown"]);

function safeView(value, operationId) {
  const owner = value?.owner, source = value?.source, check = value?.verification, barrier = value?.barrier;
  const validOwner = owner?.kind === "api-mission"
    ? keys(owner, ["kind", "missionId", "taskId", "attemptId", "planRevision"]) && [owner.missionId, owner.taskId, owner.attemptId].every(opaque) && Number.isSafeInteger(owner.planRevision) && owner.planRevision >= 1
    : owner?.kind === "api-selected-file-intent" && keys(owner, ["kind", "requestId"]) && opaque(owner.requestId);
  if (!keys(value, ["id", "owner", "source", "title", "phase", "patchDigest", "verification", "barrier", "updatedAt"], ["compensationOf","apiProvenance"]) ||
      value.id !== operationId || !validOwner || !keys(source, ["resourceId", "version"]) || !opaque(source.resourceId) || !Number.isSafeInteger(source.version) || source.version < 1 ||
      !text(value.title) || /[:\\/]/u.test(value.title) || !phases.has(value.phase) || !hash(value.patchDigest) ||
      !keys(check, ["state", "criterion"], ["reason"]) || !checks.has(check.state) || check.criterion !== "reviewed-selected-node-test" ||
      check.reason !== undefined && !/^[a-z][a-z-]{0,127}$/u.test(check.reason) ||
      barrier !== null && (!(barrier?.kind === "native-patch-review" && keys(barrier, ["kind", "operationId", "patchDigest"]) ||
        barrier?.kind === "native-check-review" && keys(barrier, ["kind", "operationId", "patchDigest", "checkDigest"]) && hash(barrier.checkDigest)) ||
        barrier.operationId !== operationId || barrier.patchDigest !== value.patchDigest) ||
      value.apiProvenance!==undefined&&(!keys(value.apiProvenance,['providerId','executionId','responseId','model'])||value.apiProvenance.providerId!=='openai-api-vela'||![value.apiProvenance.executionId,value.apiProvenance.responseId,value.apiProvenance.model].every(opaque)) ||
      value.compensationOf !== undefined && !uuid(value.compensationOf) || !Number.isFinite(Date.parse(value.updatedAt)) || Buffer.byteLength(JSON.stringify(value)) > 8192)
    fail("invalid_mission_file_edit_metadata");
  return structuredClone(value);
}

/** Native-only factory. Main supplies its immutable local document URL and exact
 * owned BrowserWindow. No renderer-supplied focus, path, review or Yes is accepted. */
function createMissionFileEditBroker({ win, trustedDocumentUrl, call, runtime, nodeExecutable, reviewGate = work => work() }) {
  let url;
  try { url = new URL(trustedDocumentUrl); } catch { fail("invalid_mission_file_edit_host"); }
  if (typeof trustedDocumentUrl !== "string" || typeof call !== "function" || !win || !["file:", "http:"].includes(url.protocol) || url.username || url.password ||
      url.protocol === "file:" && !["", "localhost"].includes(url.hostname) ||
      url.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) fail("invalid_mission_file_edit_host");
  const nativeRuntime = () => runtime ?? require("electron");
  const guard = event => {
    try {
      if (!isReviewOwnerAlive(win) || !win.isVisible() || win.isMinimized() || !win.isFocused() ||
          event?.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame ||
          event.senderFrame.url !== trustedDocumentUrl || win.webContents.getURL() !== trustedDocumentUrl) fail("mission_file_edit_owner_unavailable");
    } catch { fail("mission_file_edit_owner_unavailable"); }
  };
  const privateCall = async (name, input) => {
    try { return await call(name, input); }
    catch (error) {
      const code = error?.code ?? error?.message;
      fail(typeof code === "string" && /^mission_edit_[a-z_]{1,80}$/u.test(code) ? code : "mission_file_edit_private_command_failed");
    }
  };
  const choice = async (review, purpose, decision) => {
    const authority = await privateCall("missionFileEditChoiceNative", { operationId: review.operationId, reviewId: review.reviewId,
      reviewDigest: review.reviewDigest, purpose, decision, nativeChoiceId: randomUUID() });
    if (decision === "no") { if (authority !== null) fail("invalid_mission_file_edit_authority"); return null; }
    if (!keys(authority, ["authority", "expiresAt"]) || !uuid(authority.authority) || !Number.isFinite(authority.expiresAt) ||
        authority.expiresAt <= Date.now() || authority.expiresAt > review.expiresAt) fail("invalid_mission_file_edit_authority");
    return authority.authority;
  };
  const patch = async (event, operationId) => {
    const raw = structuredClone(await privateCall("missionFileEditReviewNative", { operationId })); guard(event);
    if (!keys(raw, ["operationId", "reviewId", "reviewDigest", "expiresAt", "path", "before", "after", "beforeDigest", "afterDigest"]) ||
        raw.operationId !== operationId || !hash(raw.reviewDigest) || !Number.isFinite(raw.expiresAt) || raw.expiresAt > Date.now() + 180000 ||
        typeof raw.before !== "string" || !text(raw.path) || path.win32.extname(raw.path).toLowerCase() !== ".mjs")
      fail("invalid_mission_file_edit_review");
    // Reuse the exact existing validator and isolated read-only native surface.
    const review = validateFileEditReview(operationId, { requestId: operationId, reviewId: raw.reviewId, expiresAt: new Date(raw.expiresAt).toISOString(),
      files: [{ path: raw.path, before: raw.before, after: raw.after, beforeDigest: raw.beforeDigest, afterDigest: raw.afterDigest }] });
    const approved = await reviewGate(()=>showVelaReview({ parent: win, review, expiresAt: review.expiresAt, experience: "file-edit", runtime: nativeRuntime() }));
    guard(event);
    // The unchanged review API conflates Cancel/close/timeout into false. It is
    // absence of approval, never proof of an explicit user No. Preserve waiting.
    if (approved !== true) return privateCall("missionFileEditRead", { operationId });
    if (Date.now() >= raw.expiresAt) fail("mission_edit_native_choice_required");
    const authority = await choice(raw, "patch", "yes"); guard(event);
    return privateCall("missionFileEditApplyNative", { operationId, authority });
  };
  const verify = async (event, operationId) => {
    const { dialog } = nativeRuntime();
    if (!dialog || typeof dialog.showOpenDialog !== "function" || typeof dialog.showMessageBox !== "function" || !text(nodeExecutable) || !/^[CD]:[\\/]/iu.test(nodeExecutable))
      fail("mission_file_edit_check_unavailable");
    const selected = await reviewGate(()=>dialog.showOpenDialog(win, { title: "Choose the independent Node test file", buttonLabel: "Select test",
      filters: [{ name: "Node test", extensions: ["mjs"] }], properties: ["openFile", "dontAddToRecent"] }));
    guard(event);
    if (selected?.canceled === true) return privateCall("missionFileEditRead", { operationId });
    const selectedPath = selected?.filePaths?.[0];
    if (selected?.canceled !== false || !Array.isArray(selected.filePaths) || selected.filePaths.length !== 1 || !text(selectedPath) || !/^[CD]:[\\/]/iu.test(selectedPath) || !/\.(?:test|spec)\.mjs$/iu.test(selectedPath))
      fail("invalid_mission_file_edit_check_selection");
    const raw = structuredClone(await privateCall("missionFileEditCheckReviewNative", { operationId, selectedTestPath: selectedPath })); guard(event);
    const input = raw?.inputs?.[0], expected = [nodeExecutable, "--test", "--test-isolation=none", "--test-reporter=tap", "--", "./" + input];
    if (!keys(raw, ["operationId", "reviewId", "reviewDigest", "expiresAt", "cwd", "argv", "inputs"]) || raw.operationId !== operationId || !uuid(raw.reviewId) || !hash(raw.reviewDigest) ||
        !Number.isFinite(raw.expiresAt) || raw.expiresAt <= Date.now() || raw.expiresAt > Date.now() + 180000 || !text(raw.cwd) || !/^[CD]:[\\/]/iu.test(raw.cwd) ||
        !Array.isArray(raw.inputs) || raw.inputs.length !== 1 || !text(input) || path.win32.isAbsolute(input) || input.split(/[\\/]/u).includes("..") ||
        path.win32.resolve(raw.cwd, input).toLowerCase() !== path.win32.resolve(selectedPath).toLowerCase() ||
        !Array.isArray(raw.argv) || JSON.stringify(raw.argv) !== JSON.stringify(expected)) fail("invalid_mission_file_edit_check_review");
    const result = await reviewGate(()=>dialog.showMessageBox(win, { type: "question", title: "Vela · Review selected-file check", message: "Run the selected independent Node test?",
      detail: "Working directory\n" + raw.cwd + "\n\nCommand arguments\n" + raw.argv.map(part => JSON.stringify(part)).join(" ") +
        "\n\nUses the existing restricted Codex command runner. An unconfirmed outcome remains unverified.",
      buttons: ["Cancel", "Run reviewed check"], defaultId: 0, cancelId: 0, noLink: true }));
    guard(event); if (Date.now() >= raw.expiresAt) fail("mission_edit_native_choice_required");
    if (!result || ![0, 1].includes(result.response)) fail("mission_edit_native_choice_required");
    const authority = await choice(raw, "check", result.response === 1 ? "yes" : "no"); guard(event);
    return authority ? privateCall("missionFileEditCheckRunNative", { operationId, authority }) : privateCall("missionFileEditRead", { operationId });
  };
  return Object.freeze({ async prepare(event,input){
    if(!keys(input,['intent','resourceIds'],['resourceRefs','settings'])||typeof input.intent!=='string'||!input.intent.trim()||input.intent.length>16000||!Array.isArray(input.resourceIds)||input.resourceIds.length!==1||!input.resourceIds.every(opaque))fail('invalid_mission_file_edit_command');
    guard(event);if(owners.has(win))fail('mission_file_edit_review_busy');owners.add(win);
    try{const prepared=structuredClone(await privateCall('missionFileEditPrepareNative',input));guard(event);
      if(!keys(prepared,['requestId','reviewId','expiresAt','preview','review'])||!uuid(prepared.requestId)||!uuid(prepared.reviewId)||prepared.preview?.id!==prepared.requestId||
        prepared.preview.providerId!=='openai-api-vela'||!Number.isFinite(Date.parse(prepared.expiresAt))||Date.parse(prepared.expiresAt)<=Date.now())fail('invalid_mission_file_edit_review');
      const review=validateReview(prepared.preview,prepared.review);
      const approved=await reviewGate(()=>showVelaReview({parent:win,review,expiresAt:prepared.expiresAt,runtime:nativeRuntime()}));guard(event);
      if(approved!==true)fail('authorization_cancelled');
      return await privateCall('missionFileEditRunNative',{requestId:prepared.requestId,reviewId:prepared.reviewId,reviewDigest:review.reviewDigest});
    }finally{owners.delete(win);}
  },async command(event, input) {
    if (!keys(input, ["type", "operationId"]) || !["apply", "verify"].includes(input.type) || !uuid(input.operationId)) fail("invalid_mission_file_edit_command");
    guard(event); if (owners.has(win)) fail("mission_file_edit_review_busy"); owners.add(win);
    try { return safeView(await (input.type === "apply" ? patch(event, input.operationId) : verify(event, input.operationId)), input.operationId); }
    catch (error) {
      const code = error?.code ?? error?.message;
      fail(typeof code === "string" && /^(?:mission_edit_|mission_file_edit_|invalid_mission_file_edit_|invalid_vela_edit_review)[a-z_]*$/u.test(code) ? code : "mission_file_edit_review_failed");
    } finally { owners.delete(win); }
  } });
}
module.exports = { createMissionFileEditBroker, PRIVATE_MISSION_FILE_EDIT_COMMANDS };
