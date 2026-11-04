import { createInterface } from "node:readline";
import { Backend } from "./service.mts";
import {createNativeHostClient,isNativeHostEnvelope} from './native-host.mts';
const [path, privateRoot, cwd,...flags] = process.argv.slice(2);
const write = (v: unknown) => process.stdout.write(JSON.stringify(v) + "\n");
if (flags.some(flag => !["--native-secrets", "--native-media"].includes(flag)) || new Set(flags).size !== flags.length)
  throw Error("invalid_native_host_flags");
const nativeClient=flags.includes('--native-secrets')?createNativeHostClient(write):undefined;
const backend = new Backend({
  path,
  privateRoot,
  cwd,
  contentPolicy: "local-private",
  provider: "codex",
  nativeMedia: flags.includes("--native-media"),
  retention: { maxEvents: 10000 },
},nativeClient?.services);
let closeTask:Promise<void>|null=null;
const closeBackend=()=>{
  if(closeTask)return closeTask;
  const task=backend.close().then(()=>{nativeClient?.close();});closeTask=task;
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
    if(isNativeHostEnvelope(request)){nativeClient?.handle(request);return;}
    id = request.id;
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
        "mediaReadChunk",
        "mediaExternalTarget",
        "providerConnection",
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
        "timelines",
        "taskObjectives",
        "missions",
        "missionStartReviewed",
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
      .catch(async()=>{nativeClient?.close();await backend.terminate().catch(()=>{});process.exit(1);});},
);
