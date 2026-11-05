import { createInterface } from "node:readline";
import { Backend } from "./service.mts";
import {createNativeHostClient,isNativeHostEnvelope} from './native-host.mts';
import {createNativeLiveHostClient,isNativeLiveHostEnvelope} from './live-media-host.mts';
import {createSystemFactsClient,isSystemFactsEnvelope} from './system-facts-host.mts';
import {createDocumentTextClient,isDocumentTextEnvelope} from './document-text-host.mts';
import {createNativeWakeCaptureClient,isNativeWakeCaptureMessage} from './wake-capture-host.mts';
import {createWindowsMaintenanceClient,isWindowsMaintenanceEnvelope} from './windows-maintenance-host.mts';
import {createWindowsComputerClient,isWindowsComputerEnvelope} from './windows-computer-host.mts';
const [path, privateRoot, cwd,...flags] = process.argv.slice(2);
const write = (v: unknown) => process.stdout.write(JSON.stringify(v) + "\n");
if (flags.some(flag => !["--native-secrets", "--native-media", "--native-system-facts", "--native-wake-capture","--native-documents","--native-maintenance","--native-computer"].includes(flag)) || new Set(flags).size !== flags.length)
  throw Error("invalid_native_host_flags");
const nativeClient=flags.includes('--native-secrets')?createNativeHostClient(write):undefined;
const liveClient=flags.includes('--native-media')?createNativeLiveHostClient(write):undefined;
const systemClient=flags.includes('--native-system-facts')?createSystemFactsClient(write):undefined;
const documentClient=flags.includes('--native-documents')?createDocumentTextClient(write):undefined;
const wakeClient=flags.includes('--native-wake-capture')?createNativeWakeCaptureClient(write):undefined;
const maintenanceClient=flags.includes('--native-maintenance')?createWindowsMaintenanceClient(write):undefined;
const computerClient=flags.includes('--native-computer')?createWindowsComputerClient(write):undefined;
const backend = new Backend({
  path,
  privateRoot,
  cwd,
  contentPolicy: "local-private",
  provider: "codex",
  nativeMedia: flags.includes("--native-media"),
  retention: { maxEvents: 10000 },
},nativeClient?{...nativeClient.services,...(liveClient?{liveMedia:liveClient.services}:{}),...(systemClient?{systemFacts:systemClient.services}:{}),...(wakeClient?{wakeCapture:wakeClient.services}:{}),...(documentClient?{documents:documentClient.services}:{}),...(maintenanceClient?{maintenance:maintenanceClient.services}:{}),...(computerClient?{computer:computerClient.services}:{})}:undefined);
let closeTask:Promise<void>|null=null;
const closeBackend=()=>{
  if(closeTask)return closeTask;
  const task=backend.close().then(()=>{computerClient?.close();maintenanceClient?.close();documentClient?.close();wakeClient?.dispose();systemClient?.close();liveClient?.close();nativeClient?.close();});closeTask=task;
  void task.catch(()=>{if(closeTask===task)closeTask=null;});
  return task;
};
backend.subscribe((event) => write({ event }));
const lines = createInterface({ input: process.stdin });
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
    if(isNativeHostEnvelope(request)){nativeClient?.handle(request);return;}
    if (request && Object.hasOwn(request, 'missionHostSignal')) {
      if (nativeClient && Object.keys(request).length === 1)
        backend.observeMissionHostSignal(request.missionHostSignal);
      return;
    }
    id = request.id;
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
      .then(()=>process.exit())
      .catch(async()=>{computerClient?.close();maintenanceClient?.close();documentClient?.close();wakeClient?.dispose();systemClient?.close();liveClient?.close();nativeClient?.close();await backend.terminate().catch(()=>{});process.exit(1);});},
);
