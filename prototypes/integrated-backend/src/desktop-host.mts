import { createInterface } from "node:readline";
import { timingSafeEqual } from "node:crypto";
import { basename } from "node:path";
import { Backend } from "./service.mts";
import type { Options } from "./contracts.mts";
import type { MemoryFixtureDescriptor } from "./core.mts";
import type { ReviewedFact } from "../../personal-context/src/contracts.ts";
import {createNativeHostClient,isNativeHostEnvelope} from './native-host.mts';
import {createNativeLiveHostClient,isNativeLiveHostEnvelope} from './live-media-host.mts';
import {createSystemFactsClient,isSystemFactsEnvelope} from './system-facts-host.mts';
import {createDocumentTextClient,isDocumentTextEnvelope} from './document-text-host.mts';
import {createNativeWakeCaptureClient,isNativeWakeCaptureMessage} from './wake-capture-host.mts';
import {createWindowsMaintenanceClient,isWindowsMaintenanceEnvelope} from './windows-maintenance-host.mts';
import {createWindowsComputerClient,isWindowsComputerEnvelope} from './windows-computer-host.mts';
const argv = process.argv.slice(2);
const [path, privateRoot, cwd,...flags] = argv;
const fixtureFlag = '--memory-fixture-bootstrap-v1';
const fixtureRestart = path === '--memory-fixture-restart-v1';
const fixtureLaunch = path === fixtureFlag || fixtureRestart;
let fixtureStartup: { descriptor: MemoryFixtureDescriptor; options: Options } | undefined;
if (fixtureLaunch) {
  if (argv.length !== 2 || Buffer.byteLength(privateRoot) > 8192) throw Error('memory_fixture_bootstrap_invalid');
  try {
    const descriptor: MemoryFixtureDescriptor = JSON.parse(privateRoot);
    if (descriptor?.contract !== (fixtureRestart ? 'aerynth.memory-fixture-restart@1' : 'aerynth.memory-fixture-bootstrap@1'))
      throw Error('memory_fixture_bootstrap_invalid');
    const { memoryFixtureOptions } = await import('./core.mts');
    fixtureStartup = { descriptor, options: memoryFixtureOptions(descriptor) };
  } catch { throw Error('memory_fixture_bootstrap_invalid'); }
} else if (argv.some(arg => arg.startsWith('--memory-fixture'))) {
  throw Error('memory_fixture_bootstrap_invalid');
}
const fixtureSeedMode = process.env.AERYNTH_MEMORY_FIXTURE_SEED;
delete process.env.AERYNTH_MEMORY_FIXTURE_SEED;
if (fixtureSeedMode !== undefined && (!fixtureStartup || fixtureRestart || fixtureSeedMode !== 'inspector-v1'))
  throw Error('memory_fixture_seed_invalid');

// The native acceptance parent holds this separate startup capability.
const fixturePolicyToken = fixtureStartup ? process.env.AERYNTH_MEMORY_FIXTURE_POLICY_TOKEN : undefined;
if (fixtureStartup) delete process.env.AERYNTH_MEMORY_FIXTURE_POLICY_TOKEN;
const fixtureDetailToken = process.env.AERYNTH_MEMORY_FIXTURE_DETAIL_TOKEN;
delete process.env.AERYNTH_MEMORY_FIXTURE_DETAIL_TOKEN;
const tokenPattern = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u;
function fixtureTokenAuthorized(token: unknown, expected: string | undefined): boolean {
  return typeof token === 'string' && !!expected && tokenPattern.test(token) &&
    tokenPattern.test(expected) && timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}
if (fixtureDetailToken !== undefined && (!fixtureStartup || !tokenPattern.test(fixtureDetailToken) ||
    fixtureTokenAuthorized(fixtureDetailToken, fixturePolicyToken)))
  throw Error('memory_fixture_detail_invalid');
let detailOpenGeneration = 0;
let detailSelection: { resourceId: string; messageId: string } | undefined;

function exactFields(value: unknown, fields: readonly string[]): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
}
const write = (v: unknown) => process.stdout.write(JSON.stringify(v) + "\n");
const profilerFlags = flags.filter(flag => flag.startsWith('--mission-profiler-benchmark='));
const profilerMode = profilerFlags[0]?.slice('--mission-profiler-benchmark='.length);
if (profilerFlags.length && (profilerFlags.length !== 1 || !/^review-vela-missions-\d+$/u.test(basename(privateRoot)) ||
  (profilerMode !== 'off' && profilerMode !== 'minimal' && profilerMode !== 'full')))
  throw Error('invalid_mission_profiler_benchmark');
if (flags.some(flag => !profilerFlags.includes(flag) && !["--native-secrets", "--native-media", "--native-system-facts", "--native-wake-capture","--native-documents","--native-maintenance","--native-computer"].includes(flag)) || new Set(flags).size !== flags.length)
  throw Error("invalid_native_host_flags");
const fixtureCustody = fixtureStartup ? createNativeHostClient(write) : undefined;
const nativeClient=flags.includes('--native-secrets')?createNativeHostClient(write):undefined;
const liveClient=flags.includes('--native-media')?createNativeLiveHostClient(write):undefined;
const systemClient=flags.includes('--native-system-facts')?createSystemFactsClient(write):undefined;
const documentClient=flags.includes('--native-documents')?createDocumentTextClient(write):undefined;
const wakeClient=flags.includes('--native-wake-capture')?createNativeWakeCaptureClient(write):undefined;
const maintenanceClient=flags.includes('--native-maintenance')?createWindowsMaintenanceClient(write):undefined;
const computerClient=flags.includes('--native-computer')?createWindowsComputerClient(write):undefined;
const backend = fixtureStartup
  ? new Backend(fixtureStartup.options, undefined, {
      descriptor: fixtureStartup.descriptor, protector: fixtureCustody!.services.secrets,
    })
  : new Backend({
  path,
  privateRoot,
  cwd,
  contentPolicy: "local-private",
  provider: "codex",
  nativeMedia: flags.includes("--native-media"),
  retention: { maxEvents: 10000 },
  rendererEventTransport: true,
  ...(profilerMode === 'off' || profilerMode === 'minimal' || profilerMode === 'full' ? { missionProfilerMode: profilerMode } : {}),
},nativeClient?{...nativeClient.services,...(liveClient?{liveMedia:liveClient.services}:{}),...(systemClient?{systemFacts:systemClient.services}:{}),...(wakeClient?{wakeCapture:wakeClient.services}:{}),...(documentClient?{documents:documentClient.services}:{}),...(maintenanceClient?{maintenance:maintenanceClient.services}:{}),...(computerClient?{computer:computerClient.services}:{})}:undefined);
let closeTask:Promise<void>|null=null;
const closeBackend=()=>{
  if(closeTask)return closeTask;
  const task=backend.close().then(()=>{computerClient?.close();maintenanceClient?.close();documentClient?.close();wakeClient?.dispose();systemClient?.close();liveClient?.close();nativeClient?.close();fixtureCustody?.close();});closeTask=task;
  void task.catch(()=>{if(closeTask===task)closeTask=null;});
  return task;
};
backend.subscribe((event) => write({ event }));
const lines = createInterface({ input: process.stdin });

// Bootstrap-owned synthetic data. Keep the seed outside the RPC command map
// and route each mutation through its existing canonical owner.
const inspectorFactText = 'I prefer numbered lists.';
async function seedFixtureInspector() {
  const conversation = await backend.call('createConversation', {
    title: 'Synthetic memory source', providerId: 'local', commandId: 'fixture-inspector-conversation',
  });
  const text = inspectorFactText;
  const message = await backend.call('addMessage', {
    resourceId: conversation.resourceId, expectedRevision: conversation.revision,
    commandId: 'fixture-inspector-message', role: 'user', content: text,
  });
  const review = await backend.call('personalMemoryCapturePreviewNative', {
    conversationId: conversation.resourceId, messageId: message.id,
    scope: 'conversation', category: 'preferences', text, keywords: ['lists'],
  });
  const fact = await backend.call('personalMemoryCaptureCommitNative', review);
  write({ fixtureSeed: { contract: 'aerynth.memory-fixture-seed@1',
    conversationId: conversation.resourceId, messageId: message.id, factId: fact.id } });
}

async function readRestartedFixtureInspector() {
  const listing = await backend.call('personalMemoryManagementNative', { type: 'list', after: null }) as
    { records: { id: string }[] };
  if (listing.records.length !== 1) throw Error('memory_fixture_restart_failed');
  const fact = await backend.call('personalMemoryManagementNative', { type: 'read', id: listing.records[0].id }) as ReviewedFact;
  if (fact.text !== inspectorFactText || fact.provenance.kind !== 'conversation-message')
    throw Error('memory_fixture_restart_failed');
  const { conversationId, messageId } = fact.provenance;
  const validated = await backend.call('personalMemoryManagementNative', {
    type: 'previewSourceRevocation', id: fact.id, version: fact.version,
  }) as { binding: { conversationId: string; messageId: string }; sourceText: string };
  if (validated.binding.conversationId !== conversationId || validated.binding.messageId !== messageId ||
      validated.sourceText !== inspectorFactText)
    throw Error('memory_fixture_restart_failed');
  write({ fixtureRestart: { contract: 'aerynth.memory-fixture-restart-ready@1',
    conversationId, messageId, factId: fact.id } });
}

const startup = fixtureRestart ? readRestartedFixtureInspector()
  : fixtureSeedMode === 'inspector-v1' ? seedFixtureInspector() : undefined;
const startupReady = startup?.then(() => true, () => {
  write({ startupError: fixtureRestart ? 'memory_fixture_restart_failed' : 'memory_fixture_seed_failed' });
  process.exitCode = 1;
  lines.close();
  return false;
});
lines.on("line", async (line) => {
  let id: unknown;
  try {
    if (Buffer.byteLength(line) > 2 * 1024 * 1024 + 2048)
      throw new Error("command_too_large");
    const request = JSON.parse(line);
    if(isWindowsMaintenanceEnvelope(request)){maintenanceClient?.handle(request);return;}
    if(isWindowsComputerEnvelope(request)){computerClient?.handle(request);return;}
    if(isNativeWakeCaptureMessage(request)){wakeClient?.handle(request);return;}
    if(isSystemFactsEnvelope(request)){systemClient?.handle(request);return;}
    if(isDocumentTextEnvelope(request)){documentClient?.handle(request);return;}
    if(isNativeLiveHostEnvelope(request)){liveClient?.handle(request);return;}
    if(isNativeHostEnvelope(request)){(fixtureCustody ?? nativeClient)?.handle(request);return;}
    if (request && Object.hasOwn(request, 'missionHostSignal')) {
      if (nativeClient && Object.keys(request).length === 1)
        backend.observeMissionHostSignal(request.missionHostSignal);
      return;
    }
    id = request.id;
    // Custody replies above must be serviced while startup awaits the protector.
    if (startupReady && !await startupReady)
      throw Error(fixtureRestart ? 'memory_fixture_restart_failed' : 'memory_fixture_seed_failed');
    if (fixtureStartup && request.command === 'personalMemoryPolicyNative' &&
        Object.hasOwn(request, 'fixturePolicyToken')) {
      if (Object.keys(request).length !== 4 ||
          !Object.keys(request).every(key => ['id', 'command', 'input', 'fixturePolicyToken'].includes(key)) ||
          !fixtureTokenAuthorized(request.fixturePolicyToken, fixturePolicyToken))
        throw Error('memory_fixture_command_denied');
      write({ id, result: await backend.call('personalMemoryPolicyNative', request.input, true) });
      return;
    }
    if (Object.hasOwn(request, 'fixtureDetailToken') ||
        fixtureStartup && request.command === 'conversation' && request.input?.name === 'detail') {
      if (!exactFields(request, ['id', 'command', 'input', 'fixtureDetailToken']) ||
          !fixtureTokenAuthorized(request.fixtureDetailToken, fixtureDetailToken))
        throw Error('memory_fixture_command_denied');
      if (request.command === 'openResource') {
        const generation = ++detailOpenGeneration;
        detailSelection = undefined;
        const result = await backend.call('openResource', request.input);
        if (generation !== detailOpenGeneration) throw Error('memory_fixture_command_denied');
        if (result.status === 'ready' && result.presentation.kind === 'conversation' && result.selection)
          detailSelection = { resourceId: result.resourceId, messageId: result.selection.messageId };
        write({ id, result });
        return;
      }
      const input = request.input?.input;
      const selection = detailSelection;
      if (request.command !== 'conversation' || request.input?.name !== 'detail' ||
          !exactFields(request.input, ['name', 'input']) || !exactFields(input, ['resourceId', 'aroundMessageId']) ||
          !selection || input.resourceId !== selection.resourceId || input.aroundMessageId !== selection.messageId)
        throw Error('memory_fixture_command_denied');
      const result = await backend.call('conversation', request.input, false, true);
      if (detailSelection !== selection) throw Error('memory_fixture_command_denied');
      write({ id, result });
      return;
    }
    if (['personalMemoryCapturePreviewNative', 'personalMemoryCaptureCommitNative', 'personalMemoryCaptureCancelNative',
      'personalMemoryManagementNative', 'personalMemoryPolicyNative', 'personalMemoryRevokeSourceNative'].includes(request.command)) {
      if ((!nativeClient && !fixtureCustody) || Object.keys(request).some(key => !['id', 'command', 'input'].includes(key)))
        throw new Error('personal_memory_native_required');
      write({ id, result: await backend.call(request.command, request.input) });
      return;
    }
    if (request.command === 'aepExperimentNative') {
      if (!nativeClient || Object.keys(request).some(key => !['id', 'command', 'input'].includes(key)))
        throw new Error('native_aep_experiment_required');
      write({ id, result: await backend.call('aepExperimentNative', request.input) });
      return;
    }
    if (request.command === 'resourcePolicyNative') {
      if (!nativeClient || Object.keys(request).some(key => !['id', 'command', 'input'].includes(key)))
        throw new Error('native_resource_policy_required');
      write({ id, result: await backend.call('resourcePolicyNative', request.input) });
      return;
    }
    if (request.command === 'gpuReadbackNative') {
      if (!nativeClient || Object.keys(request).some(key => !['id', 'command', 'input'].includes(key)))
        throw new Error('native_gpu_readback_required');
      write({ id, result: await backend.call('gpuReadbackNative', request.input) });
      return;
    }
    if (['velaApiConfigure', 'velaApiUsageAuthorize', 'velaApiUsageStatus','velaVoiceNative','velaWeatherPermissionNative','velaWakeNative','velaWakeFrame','velaWakeCaptureState','velaFileProposalPrepareNative','velaSourcesPickNative','folderOpenNative',
      'hostOperationReviewNative','hostOperationDispatchNative','hostOperationResultNative',
      'missionFileEditPrepareNative','missionFileEditRunNative','missionFileEditReviewNative','missionFileEditChoiceNative','missionFileEditApplyNative','missionFileEditCheckReviewNative','missionFileEditCheckRunNative','missionFileEditRead'].includes(request.command)) {
      if (!nativeClient || Object.keys(request).some(key => !['id', 'command', 'input'].includes(key)))
        throw new Error('native_api_configuration_required');
      write({ id, result: await backend.call(request.command, request.input) });
      return;
    }
    if (request.command === 'timerHostResume') {
      if (!nativeClient || !request.input || typeof request.input !== 'object' || Array.isArray(request.input) ||
          Object.keys(request.input).length !== 0 || Object.keys(request).some(key => !['id', 'command', 'input'].includes(key)))
        throw new Error('native_timer_resume_required');
      write({ id, result: await backend.call('timerHostResume', {}) });
      return;
    }
    if (fixtureStartup && request.command === 'createConversation') {
      write({ id, result: await backend.call('createConversation', request.input) });
      return;
    }
    if (request.command === "metrics") {
      write({ id, result: process.memoryUsage() });
      return;
    }
    if (
      ![
        "desktop",
        "snapshot",
        "providerActivity",
        "addMessage",
        "execute",
        "interrupt",
        "capabilities",
        "replay",
        "rendererEventPage",
        "rendererVelaOutput",
        "close",
        "viewState",
        "branch",
        "conversation",
        "conversationActivity",
        "reconcileConversationTurn",
        "openResource",
        "mediaImportTrusted",
        "mediaDescribe",
        "folders",
        "mediaReadChunk",
        "mediaExternalTarget",
        "providerConnection",
        "velaApiConnection",
        "velaVoice",
        "velaWake",
        "providerAuth",
        "ordinaryProviderStatus",
        "ordinaryProviderCheck",
        "conversationCitation",
        "conversationClock",
        "conversationSendPreview",
        "authorizeConversationSend",
        "conversationSend",
        "vela",
        "library",
        "notes",
        "agents",
        "checklists",
        "clockTimers",
        "timelines",
        "taskObjectives",
        "missions",
        "workspaceRecovery",
        "missionStartReviewed",
        "missionRevisionReviewed",
        "missionCheckReview",
        "missionPlanReviewed",
        "missionPlanningReview",
        "missionExecutiveReview",
        "missionExecutiveReviewed",
        "velaRequestPreview",
        "velaNextWorkflowStage",
        "velaWorkflowReview",
        "velaWorkflowRun",
        "velaRouteNative",
        "velaNativeReview",
        "velaFileEditReview",
        "velaFileEditApply",
        "velaProjectCheckReview",
        "velaProjectCheckRun",
        "velaStandaloneCheckReview",
        "velaStandaloneCheckRun",
        "authorizeVelaRequest",
        "authorizeVelaDelegation",
      ].includes(request.command)
    )
      throw new Error("unsupported_command");
    const result = request.command==='close'?(await closeBackend(),null):await backend.call(request.command, request.input);
    write({ id, result });
    if (request.command === "close") {
      lines.close();
      process.exitCode = 0;
    }
  } catch (e) {
    write({
      id,
      error: /^[a-zA-Z_-]{1,80}$/.test((e as any).code ?? (e as any).message)
        ? ((e as any).code ?? (e as any).message)
        : "operation_failed",
    });
  }
});
lines.on(
  "close",
  () =>
    {void closeBackend()
      .then(()=>process.exit(process.exitCode ?? 0))
      .catch(async()=>{computerClient?.close();maintenanceClient?.close();documentClient?.close();wakeClient?.dispose();systemClient?.close();liveClient?.close();nativeClient?.close();fixtureCustody?.close();await backend.terminate().catch(()=>{});process.exit(1);});},
);
